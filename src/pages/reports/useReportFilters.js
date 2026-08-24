// Reports feed filters: the applied set, the modal draft, and apply/reset.
import { ref, reactive, computed } from 'vue'

export function createFiltersState() {
  return {
    myOnly: false,
    q: '',
    reportTypes: [],
    signTypes: [],
    city: '',
    state: '',
    dateFrom: '',
    dateTo: '',
    username: '',
    initials: '',
    description: '',
    sign_text: '',
    majorCampaign: false,
  }
}

export function assignFiltersState(target, source) {
  target.myOnly = !!source.myOnly
  target.q = source.q || ''
  target.reportTypes = Array.isArray(source.reportTypes) ? [...source.reportTypes] : []
  target.signTypes = Array.isArray(source.signTypes) ? [...source.signTypes] : []
  target.city = source.city || ''
  target.state = source.state || ''
  target.dateFrom = source.dateFrom || ''
  target.dateTo = source.dateTo || ''
  target.username = source.username || ''
  target.initials = source.initials || ''
  target.description = source.description || ''
  target.sign_text = source.sign_text || ''
  target.majorCampaign = !!source.majorCampaign
}

/**
 * @param {{ onChange: () => Promise<void> }} deps — called after apply/reset so the feed reloads.
 */
export function useReportFilters({ onChange }) {
  const filtersOpen = ref(false)
  const filters = reactive(createFiltersState())
  const draftFilters = reactive(createFiltersState())

  const hasActiveFilters = computed(() => !!(
    filters.myOnly ||
    filters.username || filters.initials ||
    filters.description || filters.sign_text ||
    filters.majorCampaign ||
    filters.q || filters.reportTypes.length || filters.signTypes.length ||
    filters.city || filters.state || filters.dateFrom || filters.dateTo
  ))

  function openFilters() { assignFiltersState(draftFilters, filters); filtersOpen.value = true }
  function closeFilters() { assignFiltersState(draftFilters, filters); filtersOpen.value = false }
  async function applyFilters() {
    assignFiltersState(filters, draftFilters)
    filtersOpen.value = false
    await onChange()
  }
  async function resetAllFilters() {
    const defaults = createFiltersState()
    assignFiltersState(filters, defaults)
    assignFiltersState(draftFilters, defaults)
    await onChange()
  }

  return { filtersOpen, filters, draftFilters, hasActiveFilters, openFilters, closeFilters, applyFilters, resetAllFilters }
}
