// Bulk photos submission: nearby-pin check → pin/report workflow (shared
// activitySubmissionService) → photo upload + row (shared photoUploadService,
// retryable) → notification; and the post-submit update.
import { ref } from 'vue'
import { parseCoords } from '@/shared/lib/coords'
import { withTimeout } from '@/shared/lib/withTimeout'
import { errorToUserMessage } from '@/shared/lib/errors'
import { logger } from '@/shared/lib/logger'
import { toPublicUrl } from '@/shared/data/photoStorage'
import { isPendingPin, deriveSubmissionVisuals } from '@/shared/domain/activitySubmission'
import { submitActivity, updatePinById, updateReportById, resolveSubmitterName } from '@/shared/domain/activitySubmissionService'
import { uploadAndAttachPhotos } from '@/shared/domain/photoUploadService'
import { notifySubmission } from '@/shared/domain/activityNotificationService'
import { findNearbyPinsForSubmission } from '@/shared/domain/nearbyPinsService'

const MAX_UPLOAD_MS = 15000

/**
 * @param {{ bulk: ReturnType<import('./useBulkItems').useBulkItems>, user: Ref, showToast: Function, logClient: Function }} deps
 */
export function useBulkSubmit({ bulk, user, showToast, logClient }) {
  const submitting = ref(false)

  // Nearby-pin selector state (submit-time check, same flow as ReportForm)
  const showPinSelector = ref(false)
  const nearbyPins = ref([])
  const pendingSubmit = ref(null) // { item, lat, lng } awaiting selector resolution

  async function handleSubmit() {
    const it = bulk.current.value
    if (!it || it.submitted) return
    if (!user?.value?.id) { showToast('Please sign in to submit.', 'error'); return }

    const d = it.draft
    const parsed = parseCoords(d.coords)
    if (!parsed) { showToast('Invalid coordinates', 'error'); return }
    if (!d.signText.trim()) { showToast('Enter sign text', 'error'); return }
    if (!d.signType) { showToast('Choose a sign type', 'error'); return }
    if (!d.reportType) { showToast('Choose an activity type', 'error'); return }

    // Nearby-pin check against fresh data. Never blocks submission on failure.
    submitting.value = true
    const nearby = await findNearbyPinsForSubmission(parsed.lat, parsed.lng, { source: 'BulkPhotoReports' })
    if (nearby.length) {
      nearbyPins.value = nearby
      pendingSubmit.value = { item: it, lat: parsed.lat, lng: parsed.lng }
      showPinSelector.value = true
      submitting.value = false
      return
    }
    await performSubmit(it, { lat: parsed.lat, lng: parsed.lng, existingPin: null })
  }

  function onConfirmNewPin() {
    const ctx = pendingSubmit.value
    closeSelector()
    if (ctx) performSubmit(ctx.item, { lat: ctx.lat, lng: ctx.lng, existingPin: null })
  }
  function onSelectExistingPin(pin) {
    const ctx = pendingSubmit.value
    closeSelector()
    if (ctx) performSubmit(ctx.item, { lat: ctx.lat, lng: ctx.lng, existingPin: pin })
  }
  function onSelectorCancel() {
    // Skip: leave the item as an editable draft (user may adjust or remove it).
    closeSelector()
  }
  function closeSelector() {
    showPinSelector.value = false
    nearbyPins.value = []
  }

  async function performSubmit(it, { lat, lng, existingPin }) {
    submitting.value = true
    const d = it.draft
    try {
      const submitter = user?.value?.id || null
      const result = await submitActivity({
        lat, lng, submitter,
        fields: { reportType: d.reportType, signText: d.signText, signType: d.signType, locationDescription: d.locationDescription },
        existingPin,
        mergeIntoPending: true,   // bulk always merges into a still-pending existing pin
      })

      // Mark submitted before the photo step: pin/report exist regardless of
      // whether the photo attaches (photo failure is retryable, never blocking).
      it.submitted = true
      it.pinId = result.pinId
      it.reportId = result.reportId
      it.pinEditable = !existingPin || isPendingPin(existingPin)
      it.isMajor = result.visuals.isMajor

      try {
        await attachPhoto(it)
      } catch (e) {
        logger.warn('BulkPhotoReports photo attach failed (retryable)', e)
        it.photoPending = true
      }

      await notifySubmission({
        isExistingPin: !!existingPin,
        reportType: d.reportType,
        signType: d.signType,
        signText: d.signText,
        locationDescription: d.locationDescription || existingPin?.description || '',
        submitterName: await resolveSubmitterName({ user }),
        lat, lng,
        state: result.state || existingPin?.state || '',
        photoUrls: it.photoPath ? [toPublicUrl(it.photoPath)] : [],
        source: 'BulkPhotoReports',
      })

      showToast('Submitted for admin review.', 'success')
      bulk.markSaved(it)
    } catch (e) {
      logger.error('BulkPhotoReports submit failed', e)
      showToast(errorToUserMessage(e, 'Submission failed.'), 'error')
    } finally {
      submitting.value = false
    }
  }

  // Compress (photoUtils defaults) → upload → photos row, via the shared pipeline.
  // Throws on any step failing; caller decides how to surface it.
  async function attachPhoto(it) {
    const res = await uploadAndAttachPhotos({
      items: [{ file: it.file, rotation: it.rotation }],
      pinId: it.pinId, reportId: it.reportId,
      timeouts: { compress: MAX_UPLOAD_MS, upload: MAX_UPLOAD_MS },
      onEvent: (event, dd) => {
        if (event === 'compress_failed') logClient('photo_compress_failed', dd.message, { name: it.file?.name, size: it.file?.size })
        if (event === 'upload_failed') logClient('photo_upload_failed', dd.message, { path: dd.path, size: dd.size })
      },
    })
    if (!res.urls.length) {
      const failed = res.failed[0], rejected = res.rejected[0]
      if (failed?.reason === 'upload_failed') throw failed.error || new Error('upload_failed')
      const reason = failed?.reason || rejected?.reason || 'unknown'
      logClient('photo_compress_failed', reason, { name: it.file?.name, size: it.file?.size })
      throw new Error(`compress_failed:${reason}`)
    }
    if (res.attachError) {
      logClient('photo_upload_failed', String(res.attachError?.message || res.attachError), { path: res.keys[0], size: it.file?.size })
      throw res.attachError
    }
    it.photoPath = res.keys[0]
    it.photoPending = false
  }

  async function retryPhoto() {
    const it = bulk.current.value
    if (!it || !it.submitted || !it.reportId || !it.photoPending) return
    submitting.value = true
    try {
      await attachPhoto(it)
      showToast('Photo attached.', 'success')
    } catch (e) {
      logger.warn('BulkPhotoReports photo retry failed (retryable)', e)
    } finally {
      submitting.value = false
    }
  }

  async function handleUpdate() {
    const it = bulk.current.value
    if (!it || !it.submitted || !it.pinId || !it.reportId) return
    if (!user?.value?.id) { showToast('Please sign in to update.', 'error'); return }

    const d = it.draft
    const parsed = parseCoords(d.coords)
    if (!parsed) { showToast('Invalid coordinates', 'error'); return }

    submitting.value = true
    try {
      if (it.pinEditable) {
        const visuals = deriveSubmissionVisuals({ reportType: d.reportType, signType: d.signType, existingPin: it.isMajor ? { is_major_campaign: true } : null })
        const { error: pinErr } = await withTimeout(
          updatePinById(it.pinId, {
            lat: parsed.lat, lng: parsed.lng,
            description: d.locationDescription || null,
            sign_text: d.signText || null,
            sign_type: d.signType || null,
            icon_type: visuals.iconType,
            icon_color: visuals.iconColor,
            updated_at: new Date().toISOString(),
          }),
          12000, 'update:pin',
        )
        if (pinErr) throw pinErr
      }

      const { error: repErr } = await withTimeout(
        updateReportById(it.reportId, { report_type: d.reportType || 'sighting', updated_at: new Date().toISOString() }),
        12000, 'update:report',
      )
      if (repErr) throw repErr

      bulk.markSaved(it)
      showToast('Updated.', 'success')
    } catch (e) {
      logger.error('BulkPhotoReports update failed', e)
      showToast(errorToUserMessage(e, 'Update failed.'), 'error')
    } finally {
      submitting.value = false
    }
  }

  return {
    submitting, showPinSelector, nearbyPins, pendingSubmit,
    handleSubmit, onConfirmNewPin, onSelectExistingPin, onSelectorCancel, closeSelector,
    performSubmit, attachPhoto, retryPhoto, handleUpdate,
  }
}
