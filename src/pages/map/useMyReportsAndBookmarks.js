// "My reports" pin set and bookmarks (load, toggle, availability).
// Extracted verbatim from MapPage.vue. Shared map state is on
// `ctx` (see mapContext.js): other composables' members are referenced as
// `ctx.<name>`; mutable shared lets live on `ctx.state`.
import { ref, watch } from 'vue'
import { errorToUserMessage } from '@/shared/lib/errors'
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

export function useMyReportsAndBookmarks(ctx) {
  const S = ctx.state

  const myReportsReady = ref(false)   // becomes true when myReportedPinIds has been filled

  const bookmarkedPinIds = ref(new Set())

  const bookmarksReady = ref(false)

  const bookmarksAvailable = ref(true)

  let bookmarkWarnedMissing = false

  try {
    const saved = localStorage.getItem('map.majorCampaignOnly')
    if (saved != null) ctx.majorCampaignOnly.value = (saved === 'true')
  } catch {}

  // IDs populated for the current logged-in user:
  const myReportedPinIds = new Set()  // approved pins with an approved report by me

  async function loadMyReports() {
    myReportsReady.value = false
    myReportedPinIds.clear()
    const uid = ctx.currentUser?.value?.id

    logger.debug('Map my-reports load start', { uid })
    if (!uid) {
      myReportsReady.value = true
      ctx.redrawPins(S.map, { filtersChanged: true })
      ctx.recomputeCountsAndBanner()
      return
    }

    if (!uid) return

    // server row cap is ~1000 → paginate
    const PAGE = 1000
    let from = 0
    let pageNum = 0

    while (true) {
      pageNum += 1
      // order by pin_id to keep a stable window
      const q = fetchReportedPinIdsByUser(uid, { from, to: from + PAGE - 1 })

      let rows
      try {
        // fast timeout; on failure we warm & retry once longer
        const fast = await withTimeout(q, 2500, `my:reports:page:${pageNum}`)
        if (fast.error) throw fast.error
        rows = fast.data ?? []
      } catch {
        try { await ctx.warmSupabase?.() } catch {}
        const slow = await withTimeout(q, 6500, `my:reports:page(retry):${pageNum}`)
        rows = slow.data ?? []
      }

      for (const r of rows) if (r.pin_id) myReportedPinIds.add(r.pin_id)

      logger.debug('Map my-reports page loaded', { page: pageNum, fetched: rows.length, totalSoFar: myReportedPinIds.size })

      if (rows.length < PAGE) break
      from += PAGE
    }

    myReportsReady.value = true
    logger.debug('Map my-reports ready', { size: myReportedPinIds.size, sample: [...myReportedPinIds].slice(0,5) })

    // refresh view now that the set is complete
    ctx.redrawPins(S.map, { filtersChanged: true })
    ctx.recomputeCountsAndBanner()
  }

  function isMissingRelationError(err) {
    const code = String(err?.code || '')
    const msg = String(err?.message || '').toLowerCase()
    return code === '42P01' || msg.includes('does not exist') || msg.includes('relation')
  }

  async function loadBookmarks() {
    const userId = ctx.currentUser?.value?.id
    bookmarksReady.value = false
    bookmarkedPinIds.value = new Set()
    if (!userId) {
      bookmarksReady.value = true
      ctx.redrawPins(S.map, { filtersChanged: true })
      return
    }

    try {
      const { data, error } = await withTimeout(fetchBookmarksForUser(userId), 4500, 'bookmarks:load')
      if (error) throw error
      bookmarkedPinIds.value = new Set((data || []).map((r) => r.pin_id).filter(Boolean))
      bookmarksAvailable.value = true
    } catch (err) {
      if (isMissingRelationError(err)) {
        bookmarksAvailable.value = false
        if (!bookmarkWarnedMissing) {
          bookmarkWarnedMissing = true
          ctx.showToast('Bookmarks are unavailable right now.', 'info')
        }
      } else {
        logger.warn('Map failed to load bookmarks', err)
        ctx.showToast(errorToUserMessage(err, 'Failed to load bookmarks.'), 'error')
      }
    } finally {
      bookmarksReady.value = true
      ctx.redrawPins(S.map, { filtersChanged: true })
      ctx.recomputeCountsAndBanner()
    }
  }

  function isPinBookmarked(pinId) {
    return bookmarkedPinIds.value.has(pinId)
  }

  async function toggleBookmarkForPin(pinId) {
    const userId = ctx.currentUser?.value?.id
    if (!userId) {
      ctx.showToast('Sign in to save bookmarks.', 'info')
      return
    }
    if (!bookmarksAvailable.value) {
      ctx.showToast('Bookmarks are unavailable right now.', 'info')
      return
    }

    const next = new Set(bookmarkedPinIds.value)
    const has = next.has(pinId)
    try {
      if (has) {
        const { error } = await deleteBookmarkForUser(userId, pinId)
        if (error) throw error
        next.delete(pinId)
        ctx.showToast('Bookmark removed.', 'success')
      } else {
        const { error } = await upsertBookmarkForUser(userId, pinId)
        if (error) throw error
        next.add(pinId)
        ctx.showToast('Bookmark saved.', 'success')
      }
      bookmarkedPinIds.value = next
      ctx.redrawPins(S.map, { filtersChanged: true })
      ctx.recomputeCountsAndBanner()
    } catch (err) {
      if (isMissingRelationError(err)) {
        bookmarksAvailable.value = false
        ctx.showToast('Bookmarks are unavailable right now.', 'info')
        return
      }
      logger.error('Map bookmark toggle failed', err)
      ctx.showToast(errorToUserMessage(err, 'Failed to update bookmark.'), 'error')
    }
  }

  // Keep in sync if the logged-in user changes
  watch(ctx.currentUser, () => {
    loadMyReports().catch(() => {})
    loadBookmarks().catch(() => {})
  })

  Object.assign(ctx, { bookmarkedPinIds, bookmarksAvailable, bookmarksReady, isMissingRelationError, isPinBookmarked, loadBookmarks, loadMyReports, myReportedPinIds, myReportsReady, toggleBookmarkForPin })
  return { bookmarkedPinIds, bookmarksAvailable, bookmarksReady, isMissingRelationError, isPinBookmarked, loadBookmarks, loadMyReports, myReportedPinIds, myReportsReady, toggleBookmarkForPin }
}
