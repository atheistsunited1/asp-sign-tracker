// Report form submission: UI lock/abort/watchdog, the nearby-pin check, photo
// upload (shared pipeline), the pin/report workflow (activitySubmissionService),
// notifications, and the iOS "went to background mid-submit" guard.
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { clampLat, normalizeLng, parseLatLng } from '@/shared/lib/coords'
import { withTimeout } from '@/shared/lib/withTimeout'
import { errorToUserMessage } from '@/shared/lib/errors'
import { logger } from '@/shared/lib/logger'
import { expectEvent } from '@/shared/lib/debug'
import { getSession, refreshSession } from '@/shared/auth/authService'
import { findNearbyPinsForSubmission } from '@/shared/domain/nearbyPinsService'
import { uploadActivityPhotos } from '@/shared/domain/photoUploadService'
import { submitActivity, attachPhotoUrls, resolveSubmitterName, warmSupabaseLite } from '@/shared/domain/activitySubmissionService'
import { notifySubmission } from '@/shared/domain/activityNotificationService'

/**
 * @param {object} deps
 * @param {ReturnType<import('./useReportForm').useReportForm>} deps.form
 * @param {ReturnType<import('./usePhotoStaging').usePhotoStaging>} deps.photos
 * @param {Ref} deps.user  @param {Ref} deps.userProfile
 * @param {Function} deps.showToast  @param {Function} deps.log  @param {Function} deps.logClient
 * @param {Function} deps.emit   component emit ('refreshPins' | 'submitted')
 */
export function useSubmitReport({ form, photos, user, userProfile, showToast, log, logClient, emit }) {
  const submitting = ref(false)
  let submitAbortCtrl = null
  let submitWatchdog = null
  let resolveSubmitExpectation = null

  function resetSubmissionState() {
    submitting.value = false
    if (submitAbortCtrl) { try { submitAbortCtrl.abort() } catch {} }
    submitAbortCtrl = null
    if (submitWatchdog) { clearTimeout(submitWatchdog) }
    submitWatchdog = null
  }

  function preventUnload(e) {
    // Avoid accidental nav mid-submit (mobile Safari back/close, etc.)
    e.preventDefault()
    e.returnValue = ''
  }

  async function lockUI() {
    submitting.value = true
    window.addEventListener('beforeunload', preventUnload)
    try { await logClient('rf_submit_lock', 'Form locked for submission', {}, 'info') } catch {}
  }

  async function unlockUI() {
    window.removeEventListener('beforeunload', preventUnload)
    resetSubmissionState()   // guarantee nothing stays stuck
    try { await logClient('rf_submit_unlock', 'Form unlocked after submission', {}, 'info') } catch {}
  }

  // ---- background / visibility guard (iOS suspends timers mid-submit) ----
  const cleanupFns = []
  onMounted(() => {
    const onVis = async () => {
      log(`visibilitychange: ${document.visibilityState}`)
      if (document.visibilityState === 'visible') {
        try { await warmSupabaseLite() } catch {}
        return
      }
      if (document.visibilityState === 'hidden' && submitting.value) {
        try {
          submitAbortCtrl?.abort()
          await logClient('rf_submit_abort_hidden', 'Submission aborted because page went to background (avoid iOS freeze)', {}, 'warn')
          showToast('⏸️ Submission cancelled because the app went to background. Please try again.', 'info')
        } finally {
          await unlockUI()
        }
      }
    }
    const onShow = (e) => log(`pageshow (persisted=${!!e.persisted})`)
    const onHide = (e) => log(`pagehide (persisted=${!!e.persisted})`)
    window.addEventListener('visibilitychange', onVis)
    window.addEventListener('pageshow', onShow)
    window.addEventListener('pagehide', onHide)
    cleanupFns.push(() => {
      window.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pageshow', onShow)
      window.removeEventListener('pagehide', onHide)
    })
  })
  onBeforeUnmount(() => {
    try { window.removeEventListener('beforeunload', preventUnload) } catch {}
    cleanupFns.forEach(fn => { try { fn() } catch {} })
  })

  // ---- entry points ----
  async function onSubmitClick() {
    log('Submit button clicked')
    try {
      if (!(await form.validateForm())) return
    } catch (e) {
      showToast('A client error occurred before submission started.', 'error')
      logger.error('ReportForm validate-before-submit failed', e)
      return
    }
    resolveSubmitExpectation = expectEvent('ReportForm checkNearbyAndSubmit fired', 2500)
    checkNearbyAndSubmit()
  }

  async function checkNearbyAndSubmit() {
    log('checkNearbyAndSubmit() invoked', { coords: form.coords.value, reportType: form.reportType.value })
    if (resolveSubmitExpectation) { resolveSubmitExpectation(); resolveSubmitExpectation = null }

    // If the user already chose an existing pin (via the selector), go straight to submission.
    if (form.selectedPinId.value) {
      log('submitting for EXISTING pin', { pinId: form.selectedPinId.value })
      // Prefer typed coords; if missing/invalid, fall back to the pin’s coords.
      let { lat, lng } = parseLatLng(form.coords.value)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        lat = form.selectedPin.value?.lat ?? NaN
        lng = form.selectedPin.value?.lng ?? NaN
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) { showToast('❌ Invalid coordinates', 'error'); return }
      await submitSubmission(lat, lng)
      return
    }

    // NEW pin flow: must have valid coords to search nearby / submit
    const parsed = parseLatLng(form.coords.value)
    if (!Number.isFinite(parsed.lat) || !Number.isFinite(parsed.lng)) {
      log('coords invalid … FAILED', { coords: form.coords.value })
      showToast('❌ Invalid coordinates', 'error')
      return
    }

    // Nearby-pin check against fresh data (never blocks submission).
    const nearby = await findNearbyPinsForSubmission(parsed.lat, parsed.lng, { source: 'ReportForm' })
    if (nearby.length) {
      form.nearbyPins.value = nearby
      form.showPinSelector.value = true
      return
    }
    form.nearbyPins.value = []
    form.showPinSelector.value = false
    await submitSubmission(parsed.lat, parsed.lng)
  }

  async function handleSelectExistingPin(pin) {
    form.selectedPinId.value = pin.id
    form.mergePendingExistingFromNearby.value = true
    form.showPinSelector.value = false
    let { lat, lng } = parseLatLng(form.coords.value)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { lat = pin.lat; lng = pin.lng }
    await submitSubmission(lat, lng)
  }

  async function submitNewFromSelector() {
    form.showPinSelector.value = false
    form.selectedPinId.value = null       // ensure NEW-pin path
    form.mergePendingExistingFromNearby.value = false
    const { lat, lng } = parseLatLng(form.coords.value)
    await submitSubmission(lat, lng)
  }

  // ---- photos ----
  // Upload staged photos under {pin}/{report}/{photo}.{ext} and return public URLs.
  // The pin/report ids are minted before upload so keys mirror ownership.
  async function uploadStagedPhotos({ signal, pinId, reportId } = {}) {
    const items = photos.stagedPhotos.value.slice(0, photos.MAX_PHOTOS)
    if (!items.length) return []
    if (!user?.value) {
      showToast('You must be logged in to attach photos. The report will be submitted without photos.', 'error')
      return []
    }
    const res = await uploadActivityPhotos({
      items, pinId, reportId, signal,
      onEvent: async (event, d) => {
        switch (event) {
          case 'compress_failed':
            await logClient('photo_compress_failed', d.message, { count: d.count, timeout_ms: d.timeout_ms, aborted: d.aborted })
            showToast('⚠️ Photo compression failed.', 'warn')
            break
          case 'upload_failed':
            await logClient('photo_upload_failed', d.message, { path: d.path, size: d.size, type: d.type, timeout_ms: d.timeout_ms })
            logger.error('ReportForm photo upload failed', d.message)
            showToast('Failed to upload a photo.', 'error')
            break
          case 'public_url_missing':
            await logClient('photo_public_url_missing', 'getPublicUrl returned no URL', { path: d.path })
            break
          case 'upload_aborted':
            await logClient('photo_upload_aborted', 'Upload aborted by user or signal', { aborted: true })
            break
        }
      },
    })
    if (res.rejected.length) showToast(`⚠️ Skipped ${res.rejected.length} non-image file(s).`, 'warn')
    const compressFailed = res.failed.filter(f => f.reason === 'compress_failed').length
    if (compressFailed) showToast(`⚠️ ${compressFailed} photo(s) failed to compress.`, 'warn')
    return res.urls
  }

  async function formatSubmitError(err) {
    const parts = [errorToUserMessage(err, 'Submission failed. Please try again.')]
    // 1) Offline?
    try { if (navigator.onLine === false) parts.push('You appear to be offline.') } catch {}
    // 2) Common “AFK wake” issues: expired/invalid session
    const m = String(err?.message || '').toLowerCase()
    if (m.includes('jwt') || m.includes('token') || m.includes('auth') || m.includes('session')) {
      parts.push('Your session may have expired. Try opening the app menu and signing in again, or refresh the page.')
    }
    // 3) Check if we actually have a session
    try {
      const { data } = await getSession()
      if (!data?.session) parts.push('No active session detected.')
    } catch {}
    return parts.join(' ')
  }

  // ---- the submission ----
  // Create (pending) pin if needed, then a (pending) report; attach photos; notify.
  async function submitSubmission(lat, lng) {
    // After AFK, warm auth/db first. Race with a short delay so healthy paths don't slow down.
    try { await Promise.race([warmSupabaseLite(), new Promise(r => setTimeout(r, 500))]) } catch {}

    lat = clampLat(lat)
    lng = normalizeLng(lng)

    log('submitSubmission start', {
      lat, lng,
      isExistingPin: !!form.selectedPinId.value,
      reportType: form.reportType.value,
      hasUser: !!user?.value,
      photos: photos.stagedPhotos.value.length,
    })

    if (!form.reportType.value) { showToast('⚠️ Please choose an activity type.', 'error'); return }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { showToast('❌ Invalid coordinates', 'error'); return }
    if (submitting.value) return
    await lockUI()
    // Ensure fresh auth after AFK
    try { await withTimeout(refreshSession(), 5000, 'submit:refresh') } catch {}

    // one controller for the whole submission
    submitAbortCtrl = new AbortController()
    const { signal } = submitAbortCtrl

    // last-ditch safeguard so the UI never bricks
    submitWatchdog = setTimeout(() => {
      if (submitting.value) {
        unlockUI()
        try { showToast('⏱️ Submission took too long. Please try again.', 'error') } catch {}
      }
    }, 20000)

    try {
      const isExistingPin = !!form.selectedPinId.value
      const targetPin = form.selectedPin.value || form.nearbyPins.value.find(p => p.id === form.selectedPinId.value) || null

      const session = (await getSession()).data?.session
      if (!session?.user?.id) {
        showToast('Please sign in to submit a report.', 'error')
        return
      }

      // Rows first: the pin/report must exist before photos upload, so storage
      // keys reference real, owned ids (storage RLS validates path ownership,
      // DB patch 6). This matches the Bulk Photos flow.
      const result = await submitActivity({
        lat, lng,
        submitter: session.user.id,
        fields: {
          reportType: form.reportType.value,
          signText: form.signText.value,
          signType: form.signType.value,
          locationDescription: form.locationDescription.value,
        },
        existingPinId: form.selectedPinId.value,
        existingPin: targetPin,
        mergeIntoPending: form.mergePendingExistingFromNearby.value,
        updateNote: isExistingPin ? form.updateNote.value : '',
        signal,
      })
      lat = result.lat; lng = result.lng
      // stash the friendly id for this session so the computed stays in sync
      if (result.pinRow?.friendly_id) form.friendlyIdOverride.value = result.pinRow.friendly_id
      if (result.noteError) {
        logger.warn('ReportForm append note failed', result.noteError)
        showToast('Submitted, but the note could not be saved.', 'error')
      }

      // Then upload photos under the real {pin}/{report}/ key and attach them.
      // The report is already saved; a photo failure is non-fatal (the submitter
      // can add photos afterward from the Reports page).
      let photoUrls = []
      if (result.reportId) {
        photoUrls = await withTimeout(
          uploadStagedPhotos({ signal, pinId: result.pinId, reportId: result.reportId }),
          15000, 'submit:uploads',
        )
        if (photoUrls.length) {
          const { error } = await attachPhotoUrls(result.reportId, photoUrls, signal).catch((e) => ({ error: e }))
          if (error) {
            logger.warn('ReportForm attach photos failed after submit', error)
            showToast('Submitted, but attaching photos failed. You can add photos from Reports.', 'error')
          }
        }
      }

      // Notify channels (fire-and-forget; never throws)
      const submitterName = await resolveSubmitterName({ user, userProfile })
      await notifySubmission({
        isExistingPin,
        reportType: form.reportType.value,
        signType: form.signType.value,
        signText: form.signText.value,
        // Prefer the user-entered description; fall back to the existing pin's saved description
        locationDescription: form.locationDescription.value || form.selectedPin.value?.description || '',
        submitterName, lat, lng,
        state: result.state || form.selectedPin.value?.state || '',
        country: result.country || '',
        photoUrls,
        source: 'ReportForm',
      })

      // Ask parent to refresh pins so the new pending pin/report shows up
      emit('refreshPins')
      emit('submitted', { pinId: result.pinId, reportType: form.reportType.value, isExistingPin, lat, lng })

      showToast('✅ Submitted for admin review!', 'success')
      log('submitSubmission … SUCCESSFUL')
      form.closeForm()
    } catch (e) {
      if (e?.name === 'AbortError') {
        showToast('Submission cancelled.', 'info')
      } else {
        showToast(await formatSubmitError(e), 'error')
        await logClient('submit_failed', String(e?.message || e), {
          stage: 'submitSubmission',
          reportType: form.reportType.value, hasPhotos: photos.stagedPhotos.value.length > 0,
        })
        logger.error('ReportForm submitSubmission failed', e)
      }
    } finally {
      await unlockUI()
    }
  }

  return {
    submitting, resetSubmissionState,
    onSubmitClick, checkNearbyAndSubmit, handleSelectExistingPin, submitNewFromSelector, submitSubmission,
  }
}
