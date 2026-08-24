// Popup photo strip (cached) and the full-screen image viewer.
// Extracted verbatim from MapPage.vue (issue #97 step 2). Shared map state is on
// `ctx` (see mapContext.js): other composables' members are referenced as
// `ctx.<name>`; mutable shared lets live on `ctx.state`.
import { ref } from 'vue'
import { logger } from '@/shared/lib/logger'
import { withTimeout } from '@/shared/lib/withTimeout'
import {
  deleteBookmarkForUser,
  fetchBookmarksForUser,
  fetchPinById,
  fetchPinsPage,
  fetchPhotoRowsForReportIds,
  fetchReportIdsForPin,
  fetchReportedPinIdsByUser,
  fetchReportsForPin as fetchReportsForPinSvc,
  insertReports,
  upsertBookmarkForUser,
  updatePinById,
  warmSupabaseConnection,
} from '@/pages/map/mapService'

export function usePopupPhotos(ctx) {

  const photoStripCache = new Map()     // `${pinId}:all` -> { ts, sig, urls }

  const PHOTO_CACHE_TTL_MS = 30_000

  // ——— Safe image URL whitelist (http(s) or data:image/*) ———
  function sanitizeImageUrl(u) {
    try {
      const s = String(u || '');
      if (/^(https?:\/\/|data:image\/)/i.test(s)) return s;
    } catch {}
    return null; // skip anything else
  }

  // ——— Render a photo strip safely (no string HTML) ———
  function renderPhotoStrip(containerEl, galleryKey, urls) {
    containerEl.classList.add('pp-photos');
    containerEl.textContent = ''; // clear safely

    const frag = document.createDocumentFragment();

    urls.forEach((raw, i) => {
      const safe = sanitizeImageUrl(raw);
      if (!safe) return; // skip suspicious URLs

      const a = document.createElement('a');
      a.href = '#';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        try { openImageAt(galleryKey, i) } catch {}
      });

      const img = document.createElement('img');
      img.alt = `photo ${i + 1}`;
      // Setting .src directly avoids attribute-injection risks
      img.src = safe;

      a.appendChild(img);
      frag.appendChild(a);
    });

    containerEl.appendChild(frag);
    try { ctx.enableHorizontalWheel(containerEl) } catch {}
  }

  // 🔍 Image lightbox state
  const imageModal = ref({ visible: false, items: [], idx: 0 })

  const photoGalleries = Object.create(null)

  function openImageAt(galleryKey, idx = 0) {
    const list = photoGalleries[galleryKey] || []
    if (!list.length) return
    imageModal.value.items = list
    imageModal.value.idx = Math.max(0, Math.min(idx, list.length - 1))
    imageModal.value.visible = true
    try { document.body.style.overflow = 'hidden' } catch {}
  }

  function closeImageModal() {
    imageModal.value.visible = false
    try { document.body.style.overflow = '' } catch {}
  }

  function nextImage() {
    if (!imageModal.value.items.length) return
    imageModal.value.idx = (imageModal.value.idx + 1) % imageModal.value.items.length
  }

  function prevImage() {
    if (!imageModal.value.items.length) return
    imageModal.value.idx =
      (imageModal.value.idx - 1 + imageModal.value.items.length) % imageModal.value.items.length
  }

  function photoCacheKeyForPin(pinId) {
    return `${pinId}:all`
  }

  function reportIdsSignature(reportIds) {
    if (!Array.isArray(reportIds) || reportIds.length === 0) return ''
    return reportIds.map((id) => String(id)).sort().join('|')
  }

  function tryRenderCachedPhotoStrip({ pinId, cacheKey, expectedSig, hostEl }) {
    const cached = photoStripCache.get(cacheKey)
    if (!cached) return false
    if ((Date.now() - cached.ts) > PHOTO_CACHE_TTL_MS) return false
    if (expectedSig && cached.sig !== expectedSig) return false
    if (!Array.isArray(cached.urls) || cached.urls.length === 0) return false

    photoGalleries[pinId] = cached.urls
    renderPhotoStrip(hostEl, pinId, cached.urls)
    return true
  }

  // Loading all photos with timeout, auto-retry after wake
  async function showAllPhotosForPin (pinId, knownReportIds = null) {
    const el = document.getElementById(`photos-${pinId}`)
    if (!el) return
    
    const elAlive = () => document.getElementById(`photos-${pinId}`) === el;
    const cacheKey = photoCacheKeyForPin(pinId)
    const knownSig = reportIdsSignature(knownReportIds)

    const renderRetry = (msg = '⚠️ Failed to load photos.') => {
      el.classList.remove('pp-photos')
      el.innerHTML = ''
      const row = document.createElement('div')
      row.style.display = 'flex'
      row.style.gap = '8px'
      row.style.alignItems = 'center'

      const label = document.createElement('span')
      label.textContent = msg

      const retryBtn = document.createElement('button')
      retryBtn.className = 'pp-iconbtn'
      retryBtn.textContent = 'Retry'
      retryBtn.addEventListener('click', () => {
        showAllPhotosForPin(pinId, knownReportIds).catch(() => {})
      })

      row.appendChild(label)
      row.appendChild(retryBtn)
      el.appendChild(row)
    }

    if (tryRenderCachedPhotoStrip({ pinId, cacheKey, expectedSig: knownSig, hostEl: el })) return

    if (navigator.onLine === false) {
      renderRetry('📡 You are offline.')
      return
    }

    el.innerHTML = '⏳ Loading all photos…'

    // helper to run the photos query with a selectable timeout
    const fetchPhotos = async (reportIds, ms) => {
      const p = await withTimeout(
        fetchPhotoRowsForReportIds(reportIds),
        ms,
        `photos:images ${pinId}`
      )
      if (p.error) throw p.error
      return (p.data ?? []).map(x => x.image_url).filter(Boolean)
    }

    try {
      // 1) Get report IDs (use what the popup already loaded if provided)
      let reportIds = Array.isArray(knownReportIds) ? knownReportIds : null
      if (!reportIds || reportIds.length === 0) {
        const res = await withTimeout(
          fetchReportIdsForPin(pinId),
          3500,                       // a little more generous here
          `photos:reports ${pinId}`
        )
        if (!elAlive()) return;
        if (res.error) throw res.error
        reportIds = (res.data ?? []).map(r => r.id)
      }

      if (!reportIds.length) {
        el.classList.remove('pp-photos')
        el.innerHTML = '📭 No photos found.'
        photoStripCache.delete(cacheKey)
        return
      }

      const reportSig = reportIdsSignature(reportIds)
      if (tryRenderCachedPhotoStrip({ pinId, cacheKey, expectedSig: reportSig, hostEl: el })) return

      // 2) Try fast path first, then warm + retry longer if it timed out
      let urls
      try {
        urls = await fetchPhotos(reportIds, 2500)       // fast attempt
        if (!elAlive()) return;
      } catch (e) {
        if (e?.name !== 'TimeoutError' && e?.message !== 'timeout') throw e
        await ctx.warmSupabase()                             // wake network/auth
        if (!elAlive()) return;
        urls = await fetchPhotos(reportIds, 6500)       // second shot
      }

      if (!urls.length) {
        el.classList.remove('pp-photos')
        el.innerHTML = '📭 No photos found.'
        photoStripCache.set(cacheKey, { ts: Date.now(), sig: reportSig, urls: [] })
        return
      }

      photoStripCache.set(cacheKey, { ts: Date.now(), sig: reportSig, urls })
      photoGalleries[pinId] = urls;
      renderPhotoStrip(el, pinId, urls);
    } catch (e) {
      if (e?.code === '42501' || /permission denied/i.test(e?.message || '')) {
        el.classList.remove('pp-photos')
        el.innerHTML = '🔒 Sign in to see activity and photos.'
        return
      }
      logger.warn('Map popup photo load failed', e)
      const msg = (e?.name === 'TimeoutError' || e?.message === 'timeout')
        ? '⏱️ Photos timed out, please refresh page.'
        : '⚠️ Failed to load photos.'
      renderRetry(msg)
    }
  }

  Object.assign(ctx, { PHOTO_CACHE_TTL_MS, closeImageModal, imageModal, nextImage, openImageAt, photoCacheKeyForPin, photoGalleries, photoStripCache, prevImage, renderPhotoStrip, reportIdsSignature, sanitizeImageUrl, showAllPhotosForPin, tryRenderCachedPhotoStrip })
  return { PHOTO_CACHE_TTL_MS, closeImageModal, imageModal, nextImage, openImageAt, photoCacheKeyForPin, photoGalleries, photoStripCache, prevImage, renderPhotoStrip, reportIdsSignature, sanitizeImageUrl, showAllPhotosForPin, tryRenderCachedPhotoStrip }
}
