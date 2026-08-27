// Legend categories, tray filters (city/state/country), Major-campaign / my-reports / bookmarked toggles, persistence and the filter vocabulary.
// Extracted verbatim from MapPage.vue. Shared map state is on
// `ctx` (see mapContext.js): other composables' members are referenced as
// `ctx.<name>`; mutable shared lets live on `ctx.state`.
import { ref, computed, watch } from 'vue'
import {
  colorOptionRowsForPin,
  defaultColorForPin,
  DRAW_PRIORITY_LEVELS,
  drawPriorityForPin,
  normalizeIconColorForPin,
} from '@/shared/domain/pinVisuals'

export function usePinFilters(ctx) {
  const S = ctx.state

  // banner: "If filters are on and no pins in view"
  const noPinsAreaBanner = ref(false)

  const LS_KEYS = {
    activeCategories: 'map.activeCategories',
    legendOpen: 'map.legendOpen',
    locateFollowHintShown: 'map.locateFollowHintShown',
    myReportsOnly: 'map.myReportsOnly',
    bookmarkedOnly: 'map.bookmarkedOnly',
    leftDockCollapsed: 'map.leftDockCollapsed',
  }

  function normalizeCats(arr) {
    if (!Array.isArray(arr)) return null;
    const valid = new Set(Object.values(ICON_TYPES)); // [0,1,2,3]
    const out = [];
    for (const v of arr) {
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n) && valid.has(n)) out.push(n);
    }
    return out.length ? out : null;
  }

  const legendOpen = ref(false)                   // starts collapsed

  // --- Icon type constants (IDs) ---
  const ICON_TYPES = {
    REPORTED_SIGNS: 0,          // reported + major campaign reported
    PLUNDERED: 1,               // street pirate + major plunders (JICR/JS)
    KRAKENED: 2,                // removed not ASP + major campaign removed
    SIGHTINGS_QUESTIONABLE: 3,
  }

  // Default: Sightings ON. Category values are icon_type numbers.
  const activeCategories = ref(new Set([ ICON_TYPES.REPORTED_SIGNS ]))

  const noPinsWarning = ref(false)

  const pinFilterCity = ref('')

  const pinFilterState = ref('')

  const pinFilterCountry = ref('')

  const hasActiveTrayFilters = computed(() =>
    myReportsOnly.value ||
    bookmarkedOnly.value ||
    !!String(pinFilterCity.value || '').trim() ||
    !!String(pinFilterState.value || '').trim() ||
    !!String(pinFilterCountry.value || '').trim()
  )

  // --- filters ---
  const myReportsOnly = ref(false)

  const majorCampaignOnly = ref(false)

  const bookmarkedOnly = ref(false)

  watch(majorCampaignOnly, v => {
    try { localStorage.setItem('map.majorCampaignOnly', String(v)) } catch {}
    ctx.redrawPins(S.map, { filtersChanged: true })
    ctx.recomputeCountsAndBanner()
  })

  const US_STATE_CODES = new Set([
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
    'DC', 'PR', 'GU', 'VI', 'AS', 'MP',
  ])

  function normalizeFilterText(v) {
    return String(v || '').trim().toLowerCase()
  }

  function inferredCountryForPin(pin) {
    const explicit = String(pin?.country || '').trim()
    if (explicit) return explicit
    const stateCode = String(pin?.state || '').trim().toUpperCase()
    const zip = String(pin?.zip || '').trim()
    if (US_STATE_CODES.has(stateCode) || /^\d{5}(?:-\d{4})?$/.test(zip)) {
      return 'United States US'
    }
    return ''
  }

  function isMajorCampaign(pin) {
    // Prefer a canonical boolean if present; gracefully handle common aliases.
    const v =
      pin.is_major_campaign ??
      pin.major_campaign ??
      pin.is_major ??
      pin.campaign_is_major ??
      false
    // accept truthy (1/'true') as well
    return v === true || v === 1 || v === '1' || v === 'true'
  }

  // persist in localStorage (optional, consistent with other toggles)
  try {
    const saved = localStorage.getItem('map.myReportsOnly')
    if (saved != null) myReportsOnly.value = (saved === 'true')
  } catch {}
  try {
    const saved = localStorage.getItem(LS_KEYS.bookmarkedOnly)
    if (saved != null) bookmarkedOnly.value = (saved === 'true')
  } catch {}
  watch(myReportsOnly, v => {
    try { localStorage.setItem('map.myReportsOnly', String(v)) } catch {}
    // re-filter immediately
    ctx.redrawPins(S.map, { filtersChanged: true })
    ctx.recomputeCountsAndBanner()
  })

  watch(bookmarkedOnly, v => {
    if (v && !ctx.bookmarksAvailable.value) {
      bookmarkedOnly.value = false
      ctx.showToast('Bookmarks are unavailable right now.', 'info')
      return
    }
    try { localStorage.setItem(LS_KEYS.bookmarkedOnly, String(v)) } catch {}
    ctx.redrawPins(S.map, { filtersChanged: true })
    ctx.recomputeCountsAndBanner()
  })

  watch([pinFilterCity, pinFilterState, pinFilterCountry], () => {
    ctx.redrawPins(S.map, { filtersChanged: true })
    ctx.recomputeCountsAndBanner()
  })

  watch(activeCategories, () => {
    ctx.redrawPins(S.map, { filtersChanged: true })
    ctx.recomputeCountsAndBanner()
  })

  function resetAllLocalFilters() {
    activeCategories.value = new Set([ICON_TYPES.REPORTED_SIGNS])
    myReportsOnly.value = false
    majorCampaignOnly.value = false
    bookmarkedOnly.value = false
    pinFilterCity.value = ''
    pinFilterState.value = ''
    pinFilterCountry.value = ''
    ctx.temporaryVisiblePinIds.clear()
    S.goToTemporaryPinId = null
    ctx.redrawPins(S.map, { filtersChanged: true })
    ctx.recomputeCountsAndBanner()
  }

  watch(activeCategories, (setVal) => {
    try { localStorage.setItem(LS_KEYS.activeCategories, JSON.stringify([...setVal])) } catch {}
  })

  // Try to restore from localStorage
  try {
    const savedCats = JSON.parse(localStorage.getItem(LS_KEYS.activeCategories) || 'null')
    if (Array.isArray(savedCats)) {
      activeCategories.value = new Set(savedCats)
    }
  } catch {/* ignore parse errors */}

  // helper to toggle a category id
  function toggleCategory(iconType) {
    const s = new Set(activeCategories.value)
    if (s.has(iconType)) s.delete(iconType)
    else s.add(iconType)
    activeCategories.value = s
    ctx.redrawPins(S.map, { filtersChanged: true }) // re-apply filters immediately
  }

  Object.assign(ctx, { ICON_TYPES, LS_KEYS, US_STATE_CODES, activeCategories, bookmarkedOnly, hasActiveTrayFilters, inferredCountryForPin, isMajorCampaign, legendOpen, majorCampaignOnly, myReportsOnly, noPinsAreaBanner, noPinsWarning, normalizeCats, normalizeFilterText, pinFilterCity, pinFilterCountry, pinFilterState, resetAllLocalFilters, toggleCategory })
  return { ICON_TYPES, LS_KEYS, US_STATE_CODES, activeCategories, bookmarkedOnly, hasActiveTrayFilters, inferredCountryForPin, isMajorCampaign, legendOpen, majorCampaignOnly, myReportsOnly, noPinsAreaBanner, noPinsWarning, normalizeCats, normalizeFilterText, pinFilterCity, pinFilterCountry, pinFilterState, resetAllLocalFilters, toggleCategory }
}
