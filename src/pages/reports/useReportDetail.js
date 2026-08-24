// The detail card's editable working copy of the selected activity + its pin:
// edit mode / snapshot / dirty, GSV month-year sub-form, and the icon/colour
// defaults that follow the chosen activity type. Never written back to the
// list rows; saving happens in useReportActions.
import { ref, reactive, computed, watch } from 'vue'
import { colorOptionRowsForPin, defaultColorForPin, iconTypeForReportType, normalizeIconColorForPin } from '@/shared/domain/pinVisuals'
import { ACTIVITY_TYPE_OPTIONS, SIGN_TYPE_OPTIONS } from '@/shared/domain/activityOptions'

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const currentYear = new Date().getFullYear()
export const YEARS = Array.from({ length: currentYear - 2007 + 1 }, (_, i) => currentYear - i)   // 2007…this year desc

export const rtOpts = ACTIVITY_TYPE_OPTIONS
export const stOpts = SIGN_TYPE_OPTIONS

/** "" → null before DB writes. */
export const nz = (v) => (typeof v === 'string' && v.trim() === '' ? null : v)

/**
 * @param {{ selected: Ref, showToast: Function }} deps
 */
export function useReportDetail({ selected, showToast }) {
  const editing = reactive({
    report_type: '',
    sign_type_edit: '',
    sign_text_edit: '',
    icon_color_edit: '',
    description: '',
    lat: null,
    lng: null,
    __coordError: null,
    city: '',
    state: '',
    gsv_date: '',
    is_major_campaign: false,
  })
  const editMode = ref(false)
  const editSnapshot = ref(null)
  const editDirty = computed(() => JSON.stringify(editing) !== JSON.stringify(editSnapshot.value || {}))
  const submitting = ref(false)

  function enterEdit() { editSnapshot.value = JSON.parse(JSON.stringify(editing)); editMode.value = true }
  function resetEditForm() { if (editSnapshot.value) Object.assign(editing, JSON.parse(JSON.stringify(editSnapshot.value))) }
  function cancelEdit() { resetEditForm(); editMode.value = false }
  function rebaseline() { editSnapshot.value = JSON.parse(JSON.stringify(editing)) }

  // ---- GSV month / year -------------------------------------------------------
  const gsvMonth = ref('')   // 1..12 or ''
  const gsvYear = ref('')    // 4-digit year or ''
  const gsvError = ref('')

  function syncGsvFromEditing() {
    const s = (editing.gsv_date || '').trim()
    if (!s) { gsvMonth.value = ''; gsvYear.value = ''; gsvError.value = ''; return }
    const m = s.match(/^([A-Za-z]{3})\s+(\d{4})$/)
    if (!m) { gsvMonth.value = ''; gsvYear.value = ''; return }
    const monIdx = MONTHS.findIndex((x) => x.toLowerCase() === m[1].toLowerCase())
    if (monIdx >= 0) { gsvMonth.value = monIdx + 1; gsvYear.value = m[2] } else { gsvMonth.value = ''; gsvYear.value = '' }
    gsvError.value = ''
  }
  function validateAndSetGsvIntoEditing() {
    if (!gsvMonth.value && !gsvYear.value) { editing.gsv_date = null; gsvError.value = ''; return true }
    if (!gsvMonth.value || !gsvYear.value) {
      gsvError.value = 'Please select both Month and Year (or clear both).'
      showToast('Please select both Month and Year for GSV date.', 'error')
      return false
    }
    const monthName = MONTHS[Number(gsvMonth.value) - 1] || null
    if (!monthName) { gsvError.value = 'Invalid month.'; showToast('Invalid month for GSV date.', 'error'); return false }
    editing.gsv_date = `${monthName} ${gsvYear.value}`
    gsvError.value = ''
    return true
  }
  watch([gsvMonth, gsvYear], () => {
    if (!gsvMonth.value && !gsvYear.value) { editing.gsv_date = null; gsvError.value = ''; return }
    if (gsvMonth.value && gsvYear.value) { editing.gsv_date = `${MONTHS[Number(gsvMonth.value) - 1]} ${gsvYear.value}`; gsvError.value = '' }
  })

  // ---- visuals that follow the chosen type ------------------------------------
  const hydratingEditVisuals = ref(false)
  const editingIconType = computed(() => iconTypeForReportType(editing.report_type))
  const editingColorOptions = computed(() => colorOptionRowsForPin({
    iconType: editingIconType.value, isMajorCampaign: !!editing.is_major_campaign, signType: editing.sign_type_edit,
  }))
  function applyEditingVisualDefaults() {
    editing.icon_color_edit = normalizeIconColorForPin({
      iconType: editingIconType.value,
      isMajorCampaign: !!editing.is_major_campaign,
      signType: editing.sign_type_edit,
      requestedColor: defaultColorForPin({ iconType: editingIconType.value, isMajorCampaign: !!editing.is_major_campaign, signType: editing.sign_type_edit }),
    })
  }
  watch(() => [editing.report_type, editing.sign_type_edit, editing.is_major_campaign], () => {
    if (hydratingEditVisuals.value) return
    applyEditingVisualDefaults()
  })

  /** Hydrate the working copy from a normalized list row. */
  function loadEditingFrom(row) {
    hydratingEditVisuals.value = true
    editing.report_type = row.report_type || ''
    editing.sign_type_edit = row.sign_type_edit || row.pin_sign_type || ''
    editing.sign_text_edit = row.sign_text_edit || row.pin_sign_text || ''
    editing.icon_color_edit = row.pin_icon_color || ''
    editing.description = row.pin_description || ''
    editing.lat = Number.isFinite(row.lat) ? row.lat : row.__origLat
    editing.lng = Number.isFinite(row.lng) ? row.lng : row.__origLng
    editing.__coordError = null
    editing.city = row.city || ''
    editing.state = row.state || ''
    editing.gsv_date = row.pin_gsv_date || ''   // single source now comes from pin
    editing.is_major_campaign = !!row.pin_is_major_campaign
    if (!editing.icon_color_edit) applyEditingVisualDefaults()
    editing.icon_color_edit = normalizeIconColorForPin({
      iconType: editingIconType.value, isMajorCampaign: !!editing.is_major_campaign,
      signType: editing.sign_type_edit, requestedColor: editing.icon_color_edit,
    })
    syncGsvFromEditing()
    hydratingEditVisuals.value = false
  }

  // Coordinates differ from the saved ones → hint + "Save new coordinates" appear
  const coordsChanged = computed(() => {
    const row = selected.value
    if (!row) return false
    const eps = 1e-7
    const la = Number(editing.lat), lo = Number(editing.lng)
    const oa = Number(row.__origLat), oo = Number(row.__origLng)
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return false
    if (!Number.isFinite(oa) || !Number.isFinite(oo)) return true
    return Math.abs(la - oa) > eps || Math.abs(lo - oo) > eps
  })

  return {
    MONTHS, YEARS, rtOpts, stOpts, nz,
    editing, editMode, editSnapshot, editDirty, submitting, enterEdit, resetEditForm, cancelEdit, rebaseline,
    gsvMonth, gsvYear, gsvError, syncGsvFromEditing, validateAndSetGsvIntoEditing,
    editingIconType, editingColorOptions, applyEditingVisualDefaults, loadEditingFrom, coordsChanged,
  }
}
