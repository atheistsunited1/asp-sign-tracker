// Report form state: fields, validation, the existing-pin selection, the
// coordinate field (edit lock, parsing, locale label), the per-open snapshot
// for Reset / dirty-check, and open/close/reset. Submission lives in
// useSubmitReport; staged photos in usePhotoStaging.
import { ref, reactive, computed } from 'vue'
import { parseCoordsFlexible, parseLatLng, formatCoords } from '@/shared/lib/coords'
import { googleMapsLink } from '@/shared/lib/links'
import { useCoordLocale } from '@/shared/domain/useCoordLocale'

/**
 * @param {object} deps
 * @param {Ref} deps.user                 injected session user
 * @param {Ref} deps.supabasePins         injected pins ref (friendly id / selected pin lookup)
 * @param {Function} deps.showToast  @param {Function} deps.confirm  @param {Function} deps.log
 * @param {{ stagedPhotos: Ref, MAX_PHOTOS: number, clearStagedPhotos: Function }} deps.photos
 * @param {Function} [deps.onForgetTransient]   hook for page-owned transient UI (e.g. close the autosuggest list)
 */
export function useReportForm({ user, supabasePins, showToast, confirm, log, photos, onForgetTransient }) {
  // ---- fields ----
  const visible = ref(false)
  const updateNote = ref('')   // quick-update note, appended to the pin description
  const reportType = ref('')
  const signText = ref('')
  const signType = ref('')
  const coords = ref('')
  const locationDescription = ref('')
  const invalid = reactive({ signText: false, signType: false, coords: false })
  const signInput = ref(null)

  // ---- existing-pin selection (nearby selector) ----
  const showPinSelector = ref(false)
  const nearbyPins = ref([])
  const selectedPinId = ref(null)
  const mergePendingExistingFromNearby = ref(false)
  const friendlyIdOverride = ref(null)
  const selectedPin = computed(() => (supabasePins?.value || []).find(p => p.id === selectedPinId.value) || null)
  const selectedPinFriendlyId = computed(() => selectedPin.value?.friendly_id || friendlyIdOverride.value || null)

  const isExistingQuickAction = computed(() =>
    !!selectedPinId.value && (reportType.value === 'plundered' || reportType.value === 'krakened')
  )
  const formTitle = computed(() => {
    if (isExistingQuickAction.value) {
      return reportType.value === 'plundered' ? 'Report Plundered' : 'Report Krakened'
    }
    return selectedPinId.value ? 'Report Sign' : 'Report New Sign'
  })

  // ---- coordinates: locale label, edit lock, parsing ----
  const locale = useCoordLocale()
  const coordPlace = locale.coordPlace
  const coordLabel = computed(() =>
    coordPlace.value === undefined ? 'Coordinates' : `Coordinates (${coordPlace.value || 'unknown'})`
  )
  function updateCoordLocale() {
    const { lat, lng } = parseLatLng(coords.value)
    return locale.updateCoordLocale(lat, lng)
  }

  const coordsEditable = ref(false)
  function toggleCoordsEdit() {
    coordsEditable.value = !coordsEditable.value
    if (coordsEditable.value) {
      // focus the field when unlocked
      requestAnimationFrame(() => { document.getElementById('report-coords')?.focus() })
    }
  }

  function openInMaps() {
    const { lat, lng } = parseLatLng(coords.value)
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      window.open(googleMapsLink(lat, lng), '_blank', 'noopener,noreferrer')
    } else {
      showToast('❌ Invalid coordinates', 'error')
    }
  }

  function onCoordsChange(e) {
    const raw = (e?.target?.value ?? coords.value ?? '').trim()
    const parsed = parseCoordsFlexible(raw)
    if (parsed) {
      coords.value = formatCoords(parsed.lat, parsed.lng)
    } else {
      const { lat, lng } = parseLatLng(raw)
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        coords.value = formatCoords(lat, lng)
      } else {
        showToast('⚠️ Couldn’t parse coordinates', 'warn')
      }
    }
    updateCoordLocale()   // keep the label in sync
  }

  function copyCoords() {
    try {
      navigator.clipboard.writeText(coords.value)
      showToast('📋 Coordinates copied!', 'success')
    } catch (e) {
      showToast('❌ Could not copy coordinates', 'error')
    }
  }

  // ---- snapshot for dirty check + per-open reset ----
  const initialSnapshot = ref(null)
  function takeSnapshot() {
    initialSnapshot.value = {
      reportType: reportType.value || '',
      signText: signText.value || '',
      signType: signType.value || '',
      locationDescription: locationDescription.value || '',
      updateNote: updateNote.value || '',
      coords: coords.value || '',
      selectedPinId: selectedPinId.value || null,
      stagedPhotoCount: photos.stagedPhotos.value.length,
    }
  }
  const isDirty = computed(() => {
    const s = initialSnapshot.value
    if (!s) return false
    return (
      s.reportType !== (reportType.value || '') ||
      s.signText !== (signText.value || '') ||
      s.signType !== (signType.value || '') ||
      s.locationDescription !== (locationDescription.value || '') ||
      s.updateNote !== (updateNote.value || '') ||
      s.coords !== (coords.value || '') ||
      s.selectedPinId !== (selectedPinId.value || null) ||
      s.stagedPhotoCount !== photos.stagedPhotos.value.length
    )
  })
  function resetToSnapshot() {
    const s = initialSnapshot.value
    if (!s) return
    reportType.value = s.reportType
    signText.value = s.signText
    signType.value = s.signType
    locationDescription.value = s.locationDescription
    updateNote.value = s.updateNote || ''
    coords.value = s.coords
    selectedPinId.value = s.selectedPinId
    // trim staged photos back to the original count
    if (photos.stagedPhotos.value.length > s.stagedPhotoCount) {
      photos.stagedPhotos.value.splice(s.stagedPhotoCount)
    }
  }

  // ---- validation ----
  async function validateForm() {
    const quick = isExistingQuickAction.value
    // reset each attempt
    invalid.signText = invalid.signType = invalid.coords = false

    if (!quick) {
      if (!user?.value?.id) {
        showToast('Please sign in to submit a report.', 'error')
        return false
      }
      if (!signText.value.trim()) {
        invalid.signText = true
        showToast('⚠️ Please enter sign text', 'error')
        signInput.value?.focus()
        return false
      }
      if (!reportType.value) {
        showToast('⚠️ Please choose an activity type', 'error')
        return false
      }
      if (!signType.value) {
        invalid.signType = true
        showToast('⚠️ Please choose a sign type', 'error')
        return false
      }
      const { lat, lng } = parseLatLng(coords.value)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        invalid.coords = true
        showToast('⚠️ Please provide valid coordinates', 'error')
        return false
      }
    } else {
      if (!reportType.value) {
        showToast('⚠️ Please choose an activity type', 'error')
        return false
      }
    }

    if (photos.stagedPhotos.value.length > photos.MAX_PHOTOS) {
      const extra = photos.stagedPhotos.value.length - photos.MAX_PHOTOS
      const ok = await confirm({
        title: 'Too many photos selected',
        message:
          `You selected ${photos.stagedPhotos.value.length} photos.\n` +
          `Only the first ${photos.MAX_PHOTOS} will be uploaded and ${extra} will be ignored.\n\n` +
          'Continue?',
        confirmText: 'Continue',
        cancelText: 'Cancel',
        tone: 'primary',
      })
      if (!ok) return false
    }
    return true
  }

  // ---- open / reset / close ----
  let submission = null   // useSubmitReport, bound by the page (closeForm/openWithPrefill reset it)
  function bindSubmission(s) { submission = s }

  function forgetTransientState() {
    locale.resetCoordLocale()          // cancel any in-flight reverse geocode & clear the label
    initialSnapshot.value = null       // Reset never points to a previous session
    coordsEditable.value = false
    showPinSelector.value = false
    nearbyPins.value = []
    selectedPinId.value = null
    mergePendingExistingFromNearby.value = false
    friendlyIdOverride.value = null
    try { onForgetTransient?.() } catch {}
  }

  function resetForm() {
    log('resetForm')
    reportType.value = ''
    signText.value = ''
    signType.value = ''
    updateNote.value = ''
    selectedPinId.value = null
    nearbyPins.value = []
    showPinSelector.value = false
    invalid.signText = invalid.signType = invalid.coords = false
    photos.clearStagedPhotos()
    locationDescription.value = ''
    selectedPinId.value = null
    mergePendingExistingFromNearby.value = false
  }

  function closeForm() {
    visible.value = false
    submission?.resetSubmissionState()
    resetForm()
    forgetTransientState()
  }

  // open + prefill in one, snapshot-friendly
  function openWithPrefill(input = {}) {
    submission?.resetSubmissionState()
    mergePendingExistingFromNearby.value = false
    visible.value = true   // the "visible" watcher takes the snapshot after prefill
    if (typeof input.coords === 'string')                coords.value = input.coords
    if (typeof input.reportType === 'string')            reportType.value = input.reportType
    if (typeof input.signText === 'string')              signText.value = input.signText
    if (typeof input.signType === 'string')              signType.value = input.signType
    if (typeof input.locationDescription === 'string')   locationDescription.value = input.locationDescription
    if (input.selectedPinId)                             selectedPinId.value = input.selectedPinId
  }

  return {
    visible, updateNote, reportType, signText, signType, coords, locationDescription, invalid, signInput,
    showPinSelector, nearbyPins, selectedPinId, mergePendingExistingFromNearby, friendlyIdOverride,
    selectedPin, selectedPinFriendlyId, isExistingQuickAction, formTitle,
    coordPlace, coordLabel, updateCoordLocale, coordsEditable, toggleCoordsEdit, openInMaps, onCoordsChange, copyCoords,
    takeSnapshot, isDirty, resetToSnapshot, validateForm,
    bindSubmission, forgetTransientState, resetForm, closeForm, openWithPrefill,
  }
}
