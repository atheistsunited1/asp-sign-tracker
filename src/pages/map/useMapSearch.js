// Search tray: remote search (pins + activities) with local merge/scoring, result actions, left-dock state.
// Extracted verbatim from MapPage.vue (issue #97 step 2). Shared map state is on
// `ctx` (see mapContext.js): other composables' members are referenced as
// `ctx.<name>`; mutable shared lets live on `ctx.state`.
import { ref, reactive, computed, watch, nextTick } from 'vue'
import { errorToUserMessage } from '@/shared/lib/errors'
import { logger } from '@/shared/lib/logger'
import { searchPinsAndReports } from '@/pages/map/mapSearchService'

export function useMapSearch(ctx) {
  const S = ctx.state

  // Pause tracking, run a zoom action, then resume tracking.
  // Small delays give toggle/start/stop time to settle.

  const searchOpen = ref(false)

  // Left edge dock for the search entry controls (Jump-to, Search/Filter, Clear).
  const leftDockCollapsed = ref(false)
  try { leftDockCollapsed.value = localStorage.getItem(ctx.LS_KEYS.leftDockCollapsed) === 'true' } catch {}

  function toggleLeftDock() {
    leftDockCollapsed.value = !leftDockCollapsed.value
    try { localStorage.setItem(ctx.LS_KEYS.leftDockCollapsed, String(leftDockCollapsed.value)) } catch {}
  }

  const remoteSearch = reactive({
    q: '',
    page: 1,
    pageSize: 25,
    total: 0,
    cap: 100,
    loading: false,
    error: '',
    results: [],
    allRows: [],
  })

  const hasSearchState = computed(() =>
    !!String(ctx.coordInput.value || '').trim()
    || !!String(remoteSearch.q || '').trim()
    || remoteSearch.page > 1
    || !!remoteSearch.results.length
    || !!remoteSearch.total
    || ctx.hasActiveTrayFilters.value
  )

  const remoteSearchMatchedPinIds = ref(new Set())

  let remoteSearchSeq = 0

  S.remoteSearchAbortCtrl = null

  S.remoteSearchDebounceTimer = null

  function queueRemoteSearch({ resetPage = false } = {}) {
    if (S.remoteSearchDebounceTimer) clearTimeout(S.remoteSearchDebounceTimer)
    S.remoteSearchDebounceTimer = setTimeout(() => {
      runRemoteSearch({ resetPage }).catch(() => {})
    }, 220)
  }

  function searchFiltersAreEmpty() {
    return !String(remoteSearch.q || '').trim()
  }

  function refreshRemoteSearchResultsView() {
    const page = Math.max(1, Number(remoteSearch.page) || 1)
    const pageSize = Math.max(1, Number(remoteSearch.pageSize) || 25)
    const allRows = Array.isArray(remoteSearch.allRows) ? remoteSearch.allRows : []
    const end = Math.min(page * pageSize, allRows.length)
    remoteSearch.results = allRows.slice(0, end)
  }

  function setRemoteSearchMatchedPins(rows) {
    const ids = new Set()
    for (const row of (rows || [])) {
      const id = String(row?.id || '').trim()
      if (id) ids.add(id)
    }
    remoteSearchMatchedPinIds.value = ids
  }

  function searchRowTimestamp(row) {
    const ts = Date.parse(row?.updated_at || row?.created_at || '')
    return Number.isFinite(ts) ? ts : 0
  }

  function compareSearchRows(a, b) {
    const aScore = Number(a?.__searchScore || 0)
    const bScore = Number(b?.__searchScore || 0)
    if (bScore !== aScore) return bScore - aScore
    const aHits = Number(a?.__searchReportHits || 0)
    const bHits = Number(b?.__searchReportHits || 0)
    if (bHits !== aHits) return bHits - aHits
    const aTs = Number(a?.__searchTs || searchRowTimestamp(a))
    const bTs = Number(b?.__searchTs || searchRowTimestamp(b))
    if (bTs !== aTs) return bTs - aTs
    return String(a?.friendly_id || a?.id || '').localeCompare(String(b?.friendly_id || b?.id || ''))
  }

  function scoreLocalPinRow(pin, qLower) {
    const fid = ctx.normalizeFilterText(pin?.friendly_id)
    const pid = ctx.normalizeFilterText(pin?.id)
    const signText = ctx.normalizeFilterText(pin?.sign_text)
    const loc = ctx.normalizeFilterText(pin?.description)
    const city = ctx.normalizeFilterText(pin?.city)
    const state = ctx.normalizeFilterText(pin?.state)
    const zip = ctx.normalizeFilterText(pin?.zip)
    let score = 0
    if (fid && fid === qLower) score += 220
    if (pid && pid === qLower) score += 220
    if (fid.startsWith(qLower)) score += 120
    if (pid.startsWith(qLower)) score += 120
    if (fid.includes(qLower)) score += 80
    if (pid.includes(qLower)) score += 80
    if (city.includes(qLower)) score += 36
    if (state.includes(qLower)) score += 28
    if (zip.includes(qLower)) score += 32
    if (signText.includes(qLower)) score += 30
    if (loc.includes(qLower)) score += 20
    if (ctx.normalizeFilterText(pin?.__all).includes(qLower)) score += 8
    return score
  }

  function localPinRowsForSearch(queryText) {
    const qLower = ctx.normalizeFilterText(queryText)
    if (!qLower) return []
    const rows = []
    for (const pin of ctx.pinById.values()) {
      if (!pin?.id) continue
      const hay = ctx.normalizeFilterText(pin.__all || '')
      if (!hay.includes(qLower)) continue
      rows.push({
        id: pin.id,
        friendly_id: pin.friendly_id || '',
        lat: pin.lat,
        lng: pin.lng,
        city: pin.city || '',
        state: pin.state || '',
        zip: pin.zip || '',
        description: pin.description || '',
        sign_text: pin.sign_text || '',
        sign_type: pin.sign_type || '',
        icon_type: pin.icon_type,
        is_approved: pin.is_approved,
        updated_at: pin.updated_at,
        created_at: pin.created_at,
        is_major_campaign: !!pin.is_major_campaign,
        campaign_class: pin.campaign_class || null,
        __searchScore: scoreLocalPinRow(pin, qLower),
        __searchReportHits: 0,
        __searchTs: Number(pin.__searchTs || searchRowTimestamp(pin)),
      })
    }
    rows.sort(compareSearchRows)
    return rows
  }

  function mergeSearchRows(localRows, remoteRows) {
    const merged = new Map()
    for (const row of (localRows || [])) {
      if (!row?.id) continue
      merged.set(row.id, { ...row })
    }
    for (const row of (remoteRows || [])) {
      if (!row?.id) continue
      const existing = merged.get(row.id)
      if (!existing) {
        merged.set(row.id, { ...row })
        continue
      }
      const mergedRow = {
        ...existing,
        ...row,
        __searchScore: Math.max(Number(existing.__searchScore || 0), Number(row.__searchScore || 0)),
        __searchReportHits: Math.max(Number(existing.__searchReportHits || 0), Number(row.__searchReportHits || 0)),
        __searchTs: Math.max(Number(existing.__searchTs || 0), Number(row.__searchTs || 0)),
      }
      merged.set(row.id, mergedRow)
    }
    return [...merged.values()].sort(compareSearchRows)
  }

  async function runRemoteSearch({ resetPage = false } = {}) {
    if (resetPage) remoteSearch.page = 1
    if (searchFiltersAreEmpty()) {
      remoteSearch.allRows = []
      remoteSearch.results = []
      remoteSearch.total = 0
      remoteSearch.error = ''
      remoteSearch.loading = false
      remoteSearchMatchedPinIds.value = new Set()
      ctx.temporaryVisiblePinIds.clear()
      ctx.redrawPins(S.map, { filtersChanged: true })
      ctx.recomputeCountsAndBanner()
      ctx.syncSearchStateToUrl()
      return
    }

    if (S.remoteSearchAbortCtrl) {
      try { S.remoteSearchAbortCtrl.abort() } catch {}
    }
    const seq = ++remoteSearchSeq
    S.remoteSearchAbortCtrl = new AbortController()
    remoteSearch.loading = true
    remoteSearch.error = ''

    try {
      const result = await searchPinsAndReports({
        query: remoteSearch.q,
        page: 1,
        pageSize: remoteSearch.cap,
        cap: remoteSearch.cap,
        signal: S.remoteSearchAbortCtrl.signal,
      })
      if (seq !== remoteSearchSeq) return

      const remoteRows = Array.isArray(result?.rows) ? result.rows : []
      const localRows = localPinRowsForSearch(remoteSearch.q)
      const allRows = mergeSearchRows(localRows, remoteRows)
      remoteSearch.total = allRows.length
      remoteSearch.allRows = allRows

      const maxPage = Math.max(1, Math.ceil(allRows.length / Math.max(1, Number(remoteSearch.pageSize) || 25)))
      if (remoteSearch.page > maxPage) remoteSearch.page = maxPage
      refreshRemoteSearchResultsView()
      setRemoteSearchMatchedPins(allRows)
      ctx.redrawPins(S.map, { filtersChanged: true })
      ctx.recomputeCountsAndBanner()
    } catch (err) {
      if (err?.name === 'AbortError') return
      logger.warn('Map remote search failed', err)
      remoteSearch.error = errorToUserMessage(err, 'Search failed.')
      if (seq === remoteSearchSeq) {
        remoteSearch.allRows = []
        remoteSearch.results = []
        remoteSearch.total = 0
        remoteSearchMatchedPinIds.value = new Set()
        ctx.redrawPins(S.map, { filtersChanged: true })
        ctx.recomputeCountsAndBanner()
      }
    } finally {
      if (seq === remoteSearchSeq) {
        remoteSearch.loading = false
        ctx.syncSearchStateToUrl()
      }
    }
  }

  function loadMoreRemoteSearch() {
    if (remoteSearch.loading) return
    const pageSize = Math.max(1, Number(remoteSearch.pageSize) || 25)
    const maxPage = Math.max(1, Math.ceil(remoteSearch.allRows.length / pageSize))
    if (remoteSearch.page >= maxPage) return
    remoteSearch.page += 1
    refreshRemoteSearchResultsView()
  }

  function resetRemoteSearch() {
    ctx.coordInput.value = ''
    ctx.clearGoToSuggestions()
    ctx.clearGoToTemporaryPinVisibility({ redraw: false })
    remoteSearch.q = ''
    remoteSearch.page = 1
    remoteSearch.total = 0
    remoteSearch.allRows = []
    remoteSearch.results = []
    remoteSearch.error = ''
    remoteSearchMatchedPinIds.value = new Set()
    ctx.temporaryVisiblePinIds.clear()
    ctx.redrawPins(S.map, { filtersChanged: true })
    ctx.recomputeCountsAndBanner()
    ctx.syncSearchStateToUrl()
  }

  function clearSearchAndTrayFilters() {
    resetRemoteSearch()
    ctx.myReportsOnly.value = false
    ctx.bookmarkedOnly.value = false
    ctx.pinFilterCity.value = ''
    ctx.pinFilterState.value = ''
    ctx.pinFilterCountry.value = ''
  }

  function openSearchResultPin(row) {
    if (!row?.id) return
    ctx.focusPinById(row.id, { temporaryOverride: true, zoom: 18, showOverrideToast: true }).catch(() => {})
  }

  function toggleBookmarkFromResult(pinId) {
    ctx.toggleBookmarkForPin(pinId).catch(() => {})
  }

  function searchResultLocation(row) {
    const city = String(row?.city || '').trim()
    const state = String(row?.state || '').trim()
    const zip = String(row?.zip || '').trim()
    const fallback = String(row?.description || '').trim()
    const place = city && state ? `${city}, ${state}` : (city || state)
    if (place && zip) return `${place} ${zip}`
    return place || zip || fallback || 'Location unknown'
  }

  // Clipboard of current input value
  async function copyCoord(){
    const text = ctx.coordInput.value.trim()
    if (!text) return
    try { await navigator.clipboard.writeText(text) } catch {}
  }

  function mapsUrl(lat, lng, label){
    const q = label ? encodeURIComponent(label) : `${lat},${lng}`
    return `https://www.google.com/maps/search/?api=1&query=${q}&center=${lat},${lng}&zoom=18`
  }

  function closeTray() {
    searchOpen.value = false
  }

  const findSearchRef = ref(null)

  watch(searchOpen, async (open) => {
    if (!open) return
    await nextTick()
    try { findSearchRef.value?.focus() } catch {}
  })

  function enableHorizontalWheel(el) {
    if (!el || el.__wheelBound) return
    el.__wheelBound = true

    if (!el) return
    const onWheel = (e) => {
      // Ignore if user is intentionally horizontal scrolling already
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      // Convert wheel "lines" to pixels for Firefox
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
      // Only act if there is overflow to scroll
      const canScroll = el.scrollWidth > el.clientWidth
      if (!canScroll) return
      e.preventDefault()
      el.scrollLeft += dy
    }
    // passive:false so we can preventDefault
    el.addEventListener('wheel', onWheel, { passive: false })
  }

  Object.assign(ctx, { clearSearchAndTrayFilters, closeTray, compareSearchRows, copyCoord, enableHorizontalWheel, findSearchRef, hasSearchState, leftDockCollapsed, loadMoreRemoteSearch, localPinRowsForSearch, mapsUrl, mergeSearchRows, openSearchResultPin, queueRemoteSearch, refreshRemoteSearchResultsView, remoteSearch, remoteSearchMatchedPinIds, resetRemoteSearch, runRemoteSearch, scoreLocalPinRow, searchFiltersAreEmpty, searchOpen, searchResultLocation, searchRowTimestamp, setRemoteSearchMatchedPins, toggleBookmarkFromResult, toggleLeftDock })
  return { clearSearchAndTrayFilters, closeTray, compareSearchRows, copyCoord, enableHorizontalWheel, findSearchRef, hasSearchState, leftDockCollapsed, loadMoreRemoteSearch, localPinRowsForSearch, mapsUrl, mergeSearchRows, openSearchResultPin, queueRemoteSearch, refreshRemoteSearchResultsView, remoteSearch, remoteSearchMatchedPinIds, resetRemoteSearch, runRemoteSearch, scoreLocalPinRow, searchFiltersAreEmpty, searchOpen, searchResultLocation, searchRowTimestamp, setRemoteSearchMatchedPins, toggleBookmarkFromResult, toggleLeftDock }
}
