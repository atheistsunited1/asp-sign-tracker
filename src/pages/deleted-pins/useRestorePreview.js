// Per-activity restore on the Deleted pins page: the editable pin form, which
// deleted activities to include (with type overrides), the reverse-geocode of
// edited coordinates, the preview modal, and the confirm that restores (and
// optionally purges what was left out).
import { ref, reactive, computed, watch, onBeforeUnmount } from 'vue'
import { reverseGeocodeCityState } from '@/shared/domain/geocode'
import { parseLatLng, formatCoords } from '@/shared/lib/coords'
import { formatDateTime } from '@/shared/lib/date'
import { removePhotoKeys } from '@/shared/data/photoStorage'
import { restoreDeletedPin, forceDeleteReportNow } from '@/shared/domain/activityLifecycleService'
import { isAuditType, validateRestoreOrder } from '@/shared/domain/activityLifecycle'
import { errorToUserMessage } from '@/shared/lib/errors'
import { logger } from '@/shared/lib/logger'

/**
 * @param {object} deps
 * @param {Ref} deps.selectedPin        useDeletedPins.selectedDeleted
 * @param {Ref} deps.deletedReports     useDeletedPins.deletedReports (raw rows)
 * @param {() => string|null} deps.actorId
 * @param {Function} deps.showToast
 * @param {() => Promise<void>} deps.afterRestore   reload the list etc.
 */
export function useRestorePreview({ selectedPin, deletedReports, actorId, showToast, afterRestore }) {
  const form = reactive({ sign_type: '', sign_text: '', description: '', city: '', state: '', coords: '', is_major_campaign: false })
  const selectedReportIds = ref([])
  const selectedReportIdSet = computed(() => new Set(selectedReportIds.value))
  const reportEditOpen = reactive({})
  const reportDrafts = reactive({})
  const busyRestore = ref(false)
  const lastGeocodedCoords = ref('')

  const restorePreview = reactive({
    open: false, summary: '', pinDetails: null, rows: [], expandedReportId: null,
    included: [], excluded: [], purgeUnselected: false, payload: null,
  })

  const geoSummaryText = computed(() => {
    const city = String(form.city || '').trim(), state = String(form.state || '').trim()
    const zip = String(selectedPin.value?.zip || '').trim(), country = String(selectedPin.value?.country || '').trim()
    const parts = [city, state, zip, country].filter(Boolean)
    return parts.length ? parts.join(', ') : 'No city/state/zip/country available.'
  })

  const fmtCoord = (lat, lng) => (Number.isFinite(lat) && Number.isFinite(lng) ? formatCoords(lat, lng) : '')

  function clearReportEditorState() {
    Object.keys(reportEditOpen).forEach((k) => delete reportEditOpen[k])
    Object.keys(reportDrafts).forEach((k) => delete reportDrafts[k])
  }
  /** Seed the form from a freshly selected pin. */
  function resetFormFromPin(pin) {
    form.sign_type = pin?.sign_type || ''
    form.sign_text = pin?.sign_text || ''
    form.description = pin?.description || ''
    form.city = pin?.city || ''
    form.state = pin?.state || ''
    form.coords = fmtCoord(pin?.lat, pin?.lng)
    lastGeocodedCoords.value = String(form.coords || '').trim()
    form.is_major_campaign = !!pin?.is_major_campaign
    selectedReportIds.value = []
    clearReportEditorState()
  }

  function toggleReportSelection(reportId) {
    if (!reportId) return
    const set = new Set(selectedReportIds.value)
    if (set.has(reportId)) set.delete(reportId); else set.add(reportId)
    selectedReportIds.value = [...set]
  }
  function resetReportDraft(report) {
    if (!report?.id) return
    reportDrafts[report.id] = { report_type: String(report.report_type || 'sighting') }
  }
  function toggleReportEdit(report) {
    if (!report?.id || isAuditType(report.report_type)) return
    if (!reportEditOpen[report.id]) { resetReportDraft(report); reportEditOpen[report.id] = true; return }
    reportEditOpen[report.id] = false
  }
  const isEditingReport = (reportId) => !!reportEditOpen[reportId]
  function isReportDirty(report) {
    if (!report?.id) return false
    const d = reportDrafts[report.id]
    if (!d) return false
    return d.report_type !== String(report.report_type || 'sighting')
  }

  // ---- coordinates → city/state ---------------------------------------------------
  let coordsDebounceHandle = null
  async function reverseGeocodeFromCoords({ silentInvalid = false, notifySuccess = false } = {}) {
    const { lat, lng } = parseLatLng(form.coords)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { if (!silentInvalid) showToast('Enter valid coordinates first.', 'error'); return }
    try {
      const cs = await reverseGeocodeCityState(lat, lng)
      if (!cs?.city && !cs?.state) { if (!silentInvalid) showToast('No city/state found for those coordinates.', 'warn'); return }
      const newCity = cs.city || '', newState = cs.state || ''
      const changed = newCity !== String(form.city || '') || newState !== String(form.state || '')
      form.city = newCity || form.city
      form.state = newState || form.state
      lastGeocodedCoords.value = String(form.coords || '').trim()
      if (notifySuccess && changed) showToast('City/state updated from coordinates.', 'success')
    } catch (e) {
      logger.warn('DeletedPins reverse geocode failed', e)
      if (!silentInvalid) showToast(errorToUserMessage(e, 'Reverse geocode failed.'), 'error')
    }
  }
  watch(() => form.coords, (coords) => {
    const raw = String(coords || '').trim()
    if (!raw || raw === lastGeocodedCoords.value) return
    if (coordsDebounceHandle) clearTimeout(coordsDebounceHandle)
    coordsDebounceHandle = setTimeout(() => { reverseGeocodeFromCoords({ silentInvalid: true, notifySuccess: false }).catch(() => {}) }, 500)
  })
  onBeforeUnmount(() => { if (coordsDebounceHandle) clearTimeout(coordsDebounceHandle) })

  // ---- preview → confirm ------------------------------------------------------------
  const formatPreviewCollapsed = (row) => `${formatDateTime(row?.occurred_on || row?.created_at)} - ${String(row?.report_type || 'report')}`
  function togglePreviewExpand(reportId) {
    if (!reportId) return
    restorePreview.expandedReportId = restorePreview.expandedReportId === reportId ? null : reportId
  }

  function runRestore() {
    if (!selectedPin.value?.id) return
    const actor = actorId()
    if (!actor) { showToast('Session missing. Please sign in again.', 'error'); return }
    const pickedIds = selectedReportIds.value.slice()
    const { lat, lng } = parseLatLng(form.coords)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { showToast('Please provide valid coordinates.', 'error'); return }
    if (!pickedIds.length) { showToast('Select at least one existing activity to restore.', 'error'); return }

    const pinPatch = {
      lat, lng,
      sign_type: form.sign_type || null, sign_text: form.sign_text || null, description: form.description || null,
      city: form.city || null, state: form.state || null, is_major_campaign: !!form.is_major_campaign,
    }
    const selectedReportOverrides = {}
    for (const reportId of pickedIds) {
      const reportRow = deletedReports.value.find((r) => r.id === reportId)
      if (!reportRow || isAuditType(reportRow.report_type) || !isReportDirty(reportRow)) continue
      selectedReportOverrides[reportId] = { report_type: String(reportDrafts[reportId]?.report_type || reportRow.report_type || 'sighting') }
    }

    const restorableRows = deletedReports.value.filter((r) => !isAuditType(r?.report_type))
    const includeSet = new Set(pickedIds)
    restorePreview.included = restorableRows.filter((r) => includeSet.has(r.id))
    restorePreview.excluded = restorableRows.filter((r) => !includeSet.has(r.id))
    restorePreview.rows = restorableRows.map((r) => ({ ...r, report_type: selectedReportOverrides[r.id]?.report_type || r.report_type, included: includeSet.has(r.id) }))

    const order = validateRestoreOrder(restorePreview.included.map((r) => ({ ...r, report_type: selectedReportOverrides[r.id]?.report_type || r.report_type })))
    if (!order.ok) {
      showToast(`Invalid lifecycle order: ${order.terminal.report_type} (${formatDateTime(order.terminal.occurred_on || order.terminal.created_at)}) is terminal but a later activity exists (${formatDateTime(order.next.occurred_on || order.next.created_at)}).`, 'error')
      return
    }

    const editedCount = Object.keys(selectedReportOverrides).length
    restorePreview.summary = `You are about to restore this pin with ${pickedIds.length} selected historical activities.`
    if (editedCount > 0) restorePreview.summary += ` ${editedCount} selected activities include edited values.`
    restorePreview.purgeUnselected = false
    restorePreview.pinDetails = {
      sign_text: form.sign_text || null, sign_type: form.sign_type || null, description: form.description || null,
      coords: form.coords || null, geo: geoSummaryText.value || null, is_major_campaign: !!form.is_major_campaign,
    }
    restorePreview.expandedReportId = restorePreview.rows[0]?.id || null
    restorePreview.payload = { actorId: actor, pickedIds, selectedReportOverrides, pinPatch }
    restorePreview.open = true
  }

  function closeRestorePreview() {
    Object.assign(restorePreview, { open: false, summary: '', pinDetails: null, rows: [], expandedReportId: null, included: [], excluded: [], purgeUnselected: false, payload: null })
  }

  async function confirmRestoreFromPreview() {
    if (!restorePreview.payload || !selectedPin.value?.id) return
    busyRestore.value = true
    try {
      if (restorePreview.purgeUnselected && restorePreview.excluded.length) {
        const okPurge = window.confirm('Permanently delete excluded activities? This cannot be undone.')
        if (!okPurge) { busyRestore.value = false; return }
      }
      const payload = restorePreview.payload
      await restoreDeletedPin({
        pinId: selectedPin.value.id, actorUserId: payload.actorId,
        selectedDeletedReportIds: payload.pickedIds, selectedReportOverrides: payload.selectedReportOverrides, pinPatch: payload.pinPatch,
      })

      let purgeSuccess = 0, purgeFailed = 0
      if (restorePreview.purgeUnselected && restorePreview.excluded.length) {
        for (const reportRow of restorePreview.excluded) {
          try {
            const { photoPaths } = await forceDeleteReportNow(reportRow.id)
            if (photoPaths?.length) await removePhotoKeys(photoPaths).catch((e) => logger.warn('DeletedPins storage cleanup warning (restore purge unselected)', e))
            purgeSuccess++
          } catch (e) { purgeFailed++; logger.warn('DeletedPins purge unselected report failed', e) }
        }
      }
      closeRestorePreview()
      selectedReportIds.value = []
      await afterRestore()
      if (purgeSuccess || purgeFailed) {
        if (purgeFailed) showToast(`Pin restored. Purged ${purgeSuccess} unselected activities, ${purgeFailed} failed.`, 'warn')
        else showToast(`Pin restored. Purged ${purgeSuccess} unselected activities.`, 'success')
      } else showToast('Pin restored successfully.', 'success')
    } catch (e) {
      logger.error('DeletedPins restore failed', e)
      showToast(errorToUserMessage(e, 'Restore failed. Please try again.'), 'error')
    } finally {
      busyRestore.value = false
    }
  }

  return {
    form, selectedReportIds, selectedReportIdSet, reportDrafts, busyRestore, restorePreview, geoSummaryText,
    resetFormFromPin, clearReportEditorState, toggleReportSelection, resetReportDraft, toggleReportEdit, isEditingReport, isReportDirty,
    reverseGeocodeFromCoords, formatPreviewCollapsed, togglePreviewExpand, runRestore, closeRestorePreview, confirmRestoreFromPreview,
  }
}
