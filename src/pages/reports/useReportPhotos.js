// Photos of the selected activity on the Reports page: the per-report photo
// cache, add (shared upload pipeline: compress → key → upload → row) and
// delete, and the lightbox.
import { ref, reactive, computed } from 'vue'
import { keyFromPublicUrl, toPublicUrl, removePhotoKeys } from '@/shared/data/photoStorage'
import { uploadAndAttachPhotos } from '@/shared/domain/photoUploadService'
import { logger } from '@/shared/lib/logger'
import { errorToUserMessage } from '@/shared/lib/errors'
import { fetchPhotoRowsByReportId, deletePhotoById } from '@/pages/reports/reportsService'

export const MAX_PHOTOS = 5

/**
 * @param {{ selected: Ref, activeTab: Ref, isMapmasterOrHigher: Ref, isOwner: Ref, showToast: Function, confirm: Function }} deps
 */
export function useReportPhotos({ selected, activeTab, isMapmasterOrHigher, isOwner, showToast, confirm }) {
  const submissionPhotos = reactive({})   // { [reportId]: Array<{id,image_url}> }
  const uploadingPhotos = ref(false)
  const uploadProgress = reactive({ done: 0, total: 0 })
  const lightbox = reactive({ open: false, url: '' })

  // photo perms (Approved = admin-only)
  const canAddPhotos = computed(() => {
    if (!selected.value) return false
    if (activeTab.value === 'approved') return isMapmasterOrHigher.value
    return isMapmasterOrHigher.value || isOwner.value
  })
  const canDeletePhotos = computed(() => {
    if (!selected.value) return false
    if (activeTab.value === 'approved') return isMapmasterOrHigher.value
    return isMapmasterOrHigher.value || isOwner.value
  })

  function openLightbox(url) { lightbox.open = true; lightbox.url = url }
  function closeLightbox() { lightbox.open = false; lightbox.url = '' }

  const submissionPhotoRows = (row) => submissionPhotos[row.id] || []
  const remainingSlots = (row) => Math.max(0, MAX_PHOTOS - submissionPhotoRows(row).length)
  const firstThumb = (r) => submissionPhotoRows(r)?.[0]?.image_url || r.displayPhotos?.[0] || null

  /** Seed the cache from the joined `photos` of freshly loaded rows. */
  function hydratePhotoRows(rows = []) {
    for (const row of rows) {
      const ph = Array.isArray(row.__submissionPhotoRows) ? row.__submissionPhotoRows : []
      submissionPhotos[row.id] = ph.map((p) => ({ id: p.id, image_url: toPublicUrl(p.image_url) })).filter(Boolean)
    }
  }

  async function reloadSubmissionPhotos(reportId) {
    const { data, error } = await fetchPhotoRowsByReportId(reportId, { ascending: true })
    if (!error) {
      submissionPhotos[reportId] = (data || [])
        .map((p) => ({ id: p.id, image_url: toPublicUrl(p.image_url) }))
        .filter((p) => !!p.image_url)
    }
  }

  function triggerExtraPhotos(id) {
    document.getElementById(`extra-files-${id}`)?.click()
  }

  async function onExtraPhotosChange(reportId, evt) {
    const files = Array.from(evt.target.files || [])
    evt.target.value = ''
    if (!files.length) return

    const remaining = remainingSlots({ id: reportId })
    if (remaining <= 0) { showToast('Max photos reached for this submission.', 'warn'); return }

    uploadingPhotos.value = true
    uploadProgress.done = 0
    uploadProgress.total = Math.min(remaining, files.length)

    const res = await uploadAndAttachPhotos({
      items: files.slice(0, remaining).map((file) => ({ file })),
      pinId: selected.value?.pin_id,
      reportId,
      onEvent: (event, d) => {
        if (event === 'uploaded') uploadProgress.done++
        if (event === 'upload_failed') logger.warn('Reports extra photo upload failed', d.message)
      },
    }).catch((e) => { logger.warn('Reports extra photo pipeline failed', e); return { rows: [], attachError: e } })
    if (res.attachError) logger.warn('Reports extra photo insert failed', res.attachError)

    const added = (res.rows || []).map((row) => ({ id: row.id, image_url: toPublicUrl(row.image_url) }))
    if (added.length) submissionPhotos[reportId] = [...(submissionPhotos[reportId] || []), ...added]
    const uploaded = added.length

    uploadingPhotos.value = false
    uploadProgress.done = 0
    uploadProgress.total = 0
    if (uploaded) showToast(`📷 Added ${uploaded} photo${uploaded > 1 ? 's' : ''}`, 'success')
    else showToast('No photos were added.', 'warn')
  }

  async function deleteUsrPhoto(reportId, p) {
    if (!selected.value || !canDeletePhotos.value) { showToast('You do not have permission to delete this photo.', 'error'); return }
    const ok = await confirm({ title: 'Delete photo?', message: 'This cannot be undone.', confirmText: 'Delete', cancelText: 'Cancel', tone: 'danger' })
    if (!ok) return
    try {
      const path = keyFromPublicUrl(p.image_url) || null
      if (path) await removePhotoKeys([path]).catch((e) => logger.warn('Reports storage remove error while deleting photo', e))
      await deletePhotoById(p.id)
      submissionPhotos[reportId] = (submissionPhotos[reportId] || []).filter((x) => x.id !== p.id)
      showToast('🗑️ Photo deleted', 'success')
    } catch (e) {
      logger.error('Reports delete photo failed', e)
      showToast(errorToUserMessage(e, 'Delete failed. Please try again.'), 'error')
    }
  }

  const hWheel = (e) => { e.currentTarget.scrollLeft += e.deltaY || 0 }

  return {
    MAX_PHOTOS, submissionPhotos, uploadingPhotos, uploadProgress, lightbox, canAddPhotos, canDeletePhotos,
    openLightbox, closeLightbox, submissionPhotoRows, remainingSlots, firstThumb, hydratePhotoRows,
    reloadSubmissionPhotos, triggerExtraPhotos, onExtraPhotosChange, deleteUsrPhoto, hWheel,
  }
}
