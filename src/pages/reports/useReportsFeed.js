// The review feed: tabs (pending · approved · deleted), paged lists with
// infinite scroll, the pending count, selection per tab, and the responsive
// list/detail behaviour (< 800px). Selecting a row hands off to the detail
// composables through `onSelected`.
import { ref, reactive, computed, watch } from 'vue'
import { toPublicUrl } from '@/shared/data/photoStorage'
import { logger } from '@/shared/lib/logger'
import { fetchSubmittedCount, fetchSubmittedPage, fetchApprovedPage } from '@/pages/reports/reportsService'

export const PAGE = 100
const MOBILE_MQ = '(max-width: 799.98px)'

/** Flatten a joined feed row (pins/submitter/approver/photos) into the list shape. */
export function normalizeRows(data = []) {
  return data.map((row) => {
    const pinRel = row.pins && !Array.isArray(row.pins) ? row.pins : (Array.isArray(row.pins) ? row.pins[0] : null)
    const photos = Array.isArray(row.photos) ? row.photos : []
    const lat0 = pinRel?.lat, lng0 = pinRel?.lng
    return {
      ...row,
      submitter_username: row.submitter?.username ?? null,
      submitter_initials: row.submitter?.initials ?? null,
      approver_username: row.approver?.username ?? null,
      approved_by: row.approved_by ?? null,
      lat: Number.isFinite(lat0) ? lat0 : null,
      lng: Number.isFinite(lng0) ? lng0 : null,
      __origLat: Number.isFinite(lat0) ? lat0 : null,
      __origLng: Number.isFinite(lng0) ? lng0 : null,
      pin_description: pinRel?.description ?? '',
      pin_lat: pinRel?.lat ?? null,
      pin_lng: pinRel?.lng ?? null,
      pin_friendly_id: pinRel?.friendly_id ?? null,
      pin_sign_text: pinRel?.sign_text ?? '',
      pin_sign_type: pinRel?.sign_type ?? '',
      pin_icon_type: pinRel?.icon_type ?? null,
      pin_icon_color: pinRel?.icon_color ?? null,
      pin_is_approved: !!pinRel?.is_approved,
      city: pinRel?.city ?? '',
      state: pinRel?.state ?? '',
      pin_gsv_date: pinRel?.gsv_date ?? null,
      pin_is_major_campaign: !!pinRel?.is_major_campaign,
      sign_text_edit: pinRel?.sign_text ?? '',
      sign_type_edit: pinRel?.sign_type ?? '',
      displayPhotos: photos.map((p) => toPublicUrl(p.image_url)).filter(Boolean),
      __submissionPhotoRows: photos,
    }
  })
}

/** Neighbour to select after `removedId` leaves the list. */
export function nextIdAfter(list, removedId) {
  const i = list.findIndex((r) => r.id === removedId)
  if (i === -1) return list[0]?.id ?? null
  return list[i + 1]?.id ?? list[i - 1]?.id ?? null
}

/**
 * @param {object} deps
 * @param {Ref} deps.user            injected user ref
 * @param {Ref<boolean>} deps.isMapmasterOrHigher
 * @param {object} deps.filters      reactive filters (useReportFilters)
 * @param {object} deps.deleted      useDeletedPins instance (the Deleted tab)
 * @param {(row) => void} deps.onSelected        detail/photos/map side effects for a selected row
 * @param {(rows) => void} deps.onRowsLoaded     photo cache seeding
 */
export function useReportsFeed({ user, isMapmasterOrHigher, filters, deleted, onSelected, onRowsLoaded }) {
  const activeTab = ref('submitted')          // 'submitted' | 'approved' | 'deleted'
  const submitted = ref([])
  const approved = ref([])
  const lastSelectedByTab = reactive({ submitted: null, approved: null, deleted: null })
  const selected = ref(null)
  const selectedId = computed(() => selected.value?.id ?? null)
  const currentUid = computed(() => user?.value?.id ?? null)
  const isOwner = computed(() => !!(selected.value && currentUid.value && selected.value.submitted_by === currentUid.value))

  const submittedTotal = ref(null)
  const submittedOffset = ref(0), approvedOffset = ref(0)
  const submittedHasMore = ref(true), approvedHasMore = ref(true)
  const loadingSubmitted = ref(true), loadingApproved = ref(false)
  const loadingMoreSubmitted = ref(false), loadingMoreApproved = ref(false)
  const submittedListEl = ref(null), approvedListEl = ref(null)
  const loading = computed(() => loadingSubmitted.value || loadingApproved.value || loadingMoreSubmitted.value || loadingMoreApproved.value)

  // Responsive list/detail: the list pane fills the screen until a card is picked.
  const isMobile = ref(typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(MOBILE_MQ).matches : false)
  const listExpanded = ref(true)
  if (typeof window !== 'undefined' && window.matchMedia) {
    const mq = window.matchMedia(MOBILE_MQ)
    const onMq = (e) => { isMobile.value = e.matches; if (!e.matches) listExpanded.value = true }
    if (mq.addEventListener) mq.addEventListener('change', onMq); else mq.addListener?.(onMq)
  }
  const expandList = () => { listExpanded.value = true }
  const collapseList = () => { listExpanded.value = false }
  const activeTabLabel = computed(() => activeTab.value === 'approved' ? 'Approved' : activeTab.value === 'deleted' ? 'Deleted' : 'Pending')

  async function refreshCounts() {
    const uid = user?.value?.id
    submittedTotal.value = null
    try {
      if (filters.myOnly && !uid) { submittedTotal.value = 0; return }
      const { count, error } = await fetchSubmittedCount({ filters, myOnlyUserId: filters.myOnly ? uid : null })
      if (error) throw error
      submittedTotal.value = count ?? 0
    } catch (e) {
      logger.warn('Reports submitted count failed', e)
      submittedTotal.value = 0
    }
  }

  async function loadSubmittedPage(reset = false) {
    const uid = user?.value?.id
    if (reset) { submitted.value = []; submittedOffset.value = 0; submittedHasMore.value = true }
    if (!submittedHasMore.value || loadingMoreSubmitted.value) return
    loadingMoreSubmitted.value = true
    if (submittedOffset.value === 0) loadingSubmitted.value = true
    try {
      if (filters.myOnly && !uid) { submittedHasMore.value = false; return }
      const { data, error } = await fetchSubmittedPage({ filters, from: submittedOffset.value, to: submittedOffset.value + PAGE - 1, myOnlyUserId: filters.myOnly ? uid : null })
      if (error) throw error
      const rows = normalizeRows(data || [])
      submitted.value.push(...rows)
      onRowsLoaded?.(rows)
      submittedOffset.value += rows.length
      if (rows.length < PAGE) submittedHasMore.value = false
    } catch (e) {
      logger.error('Reports loadSubmittedPage failed', e)
      submittedHasMore.value = false
      submitted.value = []
      selected.value = null
    } finally {
      loadingMoreSubmitted.value = false
      loadingSubmitted.value = false
    }
  }

  async function loadApprovedPage(reset = false) {
    const uid = user?.value?.id
    if (reset) { approved.value = []; approvedOffset.value = 0; approvedHasMore.value = true; selected.value = null }
    if (!approvedHasMore.value || loadingMoreApproved.value) return
    loadingMoreApproved.value = true
    if (approvedOffset.value === 0) loadingApproved.value = true
    try {
      if (filters.myOnly && !uid) { approvedHasMore.value = false; return }
      const { data, error } = await fetchApprovedPage({ filters, from: approvedOffset.value, to: approvedOffset.value + PAGE - 1, myOnlyUserId: filters.myOnly ? uid : null })
      if (error) throw error
      const rows = normalizeRows(data || [])
      approved.value.push(...rows)
      onRowsLoaded?.(rows)
      approvedOffset.value += rows.length
      if (rows.length < PAGE) approvedHasMore.value = false
    } catch (e) {
      logger.error('Reports loadApprovedPage failed', e)
      approvedHasMore.value = false
    } finally {
      loadingMoreApproved.value = false
      loadingApproved.value = false
    }
  }

  function onListScroll(which) {
    const el = which === 'submitted' ? submittedListEl.value : which === 'approved' ? approvedListEl.value : deleted.deletedListEl.value
    if (!el) return
    if (el.scrollTop + el.clientHeight < el.scrollHeight - 24) return
    if (which === 'submitted') loadSubmittedPage(false)
    else if (which === 'approved') loadApprovedPage(false)
    else deleted.loadDeletedPage(false)
  }

  function selectReport(r) {
    selected.value = r
    deleted.clearDeletedSelection()
    onSelected?.(r)
    lastSelectedByTab[activeTab.value] = r?.id ?? null
    if (isMobile.value) listExpanded.value = false
  }

  function selectDeletedPin(pin) {
    selected.value = null
    lastSelectedByTab.deleted = pin?.id ?? null
    if (isMobile.value) listExpanded.value = false
    return deleted.selectDeletedPin(pin)
  }

  const listFor = (tab) => (tab === 'approved' ? approved.value : submitted.value)

  /** Reload the current list, keeping the selection when the row still exists. */
  async function reloadActiveTab() {
    const keepId = selected.value?.id ?? null
    await refreshCounts()
    if (activeTab.value === 'approved') await loadApprovedPage(true)
    else await loadSubmittedPage(true)
    const list = listFor(activeTab.value)
    const keep = list.find((x) => x.id === keepId)
    if (keep) selectReport(keep)
    else if (list[0]) selectReport(list[0])
    else selected.value = null
  }

  async function switchTab(tab) {
    if (activeTab.value === tab) return
    lastSelectedByTab[activeTab.value] = activeTab.value === 'deleted' ? (deleted.selectedDeleted.value?.id ?? null) : (selected.value?.id ?? null)
    activeTab.value = tab
    if (isMobile.value) listExpanded.value = true
    await refreshCounts()

    if (tab === 'deleted') {
      selected.value = null
      await deleted.loadDeletedPage(deleted.deletedPins.value.length === 0)
      const want = lastSelectedByTab.deleted
      const next = want ? deleted.deletedPins.value.find((p) => p.id === want) : (isMobile.value ? null : deleted.deletedPins.value[0])
      if (next) selectDeletedPin(next); else deleted.clearDeletedSelection()
      return
    }
    deleted.clearDeletedSelection()
    if (tab === 'approved') await loadApprovedPage(approved.value.length === 0)
    else await loadSubmittedPage(submitted.value.length === 0)
    const list = listFor(tab)
    const want = lastSelectedByTab[tab]
    const next = want ? list.find((r) => r.id === want) : (isMobile.value ? null : list[0])
    if (next) selectReport(next); else selected.value = null
  }

  /** Full reload after filters change. */
  async function reloadForCurrentTab() {
    selected.value = null
    deleted.clearDeletedSelection()
    submitted.value = []; approved.value = []; deleted.deletedPins.value = []
    submittedOffset.value = approvedOffset.value = deleted.deletedOffset.value = 0
    submittedHasMore.value = approvedHasMore.value = deleted.deletedHasMore.value = true
    await refreshCounts()
    if (activeTab.value === 'deleted') {
      await deleted.loadDeletedPage(true)
      const next = isMobile.value ? null : (deleted.deletedPins.value[0] || null)
      if (next) selectDeletedPin(next)
      return
    }
    if (activeTab.value === 'approved') await loadApprovedPage(true); else await loadSubmittedPage(true)
    const next = isMobile.value ? null : (listFor(activeTab.value)[0] || null)
    selected.value = next
    if (next) selectReport(next)
  }

  /** After a deleted-tab restore/purge: refresh and re-select the first deleted pin. */
  async function afterDeletedMutation() {
    await refreshCounts()
    await deleted.loadDeletedPage(true)
    const next = isMobile.value ? null : (deleted.deletedPins.value[0] || null)
    if (next) selectDeletedPin(next)
    else if (isMobile.value) listExpanded.value = true
  }

  /** Initial load: start in Pending, fall back to Approved when nothing is pending. */
  async function mount() {
    await refreshCounts()
    await loadSubmittedPage(true)
    activeTab.value = submitted.value.length ? 'submitted' : 'approved'
    if (activeTab.value === 'approved' && approved.value.length === 0) await loadApprovedPage(true)
    const first = isMobile.value ? null : ((activeTab.value === 'submitted' ? submitted.value[0] : approved.value[0]) || null)
    if (first) selectReport(first)
  }

  // Signed-in user changed → reset everything and reload Pending.
  watch(() => user?.value?.id, async (n, o) => {
    if (n === o) return
    selected.value = null
    activeTab.value = 'submitted'
    submitted.value = []; approved.value = []
    submittedOffset.value = 0; approvedOffset.value = 0
    submittedHasMore.value = true; approvedHasMore.value = true
    deleted.clearDeletedSelection()
    deleted.deletedPins.value = []; deleted.deletedOffset.value = 0; deleted.deletedHasMore.value = true
    await refreshCounts()
    await loadSubmittedPage(true)
    const first = isMobile.value ? null : (submitted.value[0] || null)
    if (first) selectReport(first)
  })

  return {
    PAGE, activeTab, submitted, approved, lastSelectedByTab, selected, selectedId, currentUid, isOwner,
    submittedTotal, submittedOffset, approvedOffset, submittedHasMore, approvedHasMore,
    loadingSubmitted, loadingApproved, loadingMoreSubmitted, loadingMoreApproved, submittedListEl, approvedListEl, loading,
    isMobile, listExpanded, expandList, collapseList, activeTabLabel,
    refreshCounts, loadSubmittedPage, loadApprovedPage, onListScroll, selectReport, selectDeletedPin,
    reloadActiveTab, switchTab, reloadForCurrentTab, afterDeletedMutation, mount, listFor,
  }
}
