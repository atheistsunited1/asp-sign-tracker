// Legend rows, counts by type × approved/pending (from markers in view), no-pins banners.
// Extracted verbatim from MapPage.vue. Shared map state is on
// `ctx` (see mapContext.js): other composables' members are referenced as
// `ctx.<name>`; mutable shared lets live on `ctx.state`.
import { ref, reactive, watch } from 'vue'


export function useLegend(ctx) {
  const S = ctx.state

  // restore saved state
  try {
    const s = localStorage.getItem(ctx.LS_KEYS.legendOpen)
    if (s !== null) ctx.legendOpen.value = s === '1'
  } catch {}

  watch(ctx.legendOpen, v => {
    try { localStorage.setItem(ctx.LS_KEYS.legendOpen, v ? '1' : '0') } catch {}
  })

  // --- promise timeout helper (fallback after wake-from-idle) ---

  // ✅ Page legend rows — order mirrors marker draw priority (front to back)
  const legendRows = [
    { key: 'reported',     label: 'Sightings' },
    { key: 'billboards',   label: 'Billboards' },
    { key: 'questionable', label: 'Questionable Legality' },
    { key: 'plundered',    label: 'Plundered' },
    { key: 'krakened',     label: 'Krakened' },
  ]

  // reactive counts object
  const counts = ref({
    approved: { reported: 0, billboards: 0, plundered: 0, krakened: 0, questionable: 0 },
    pending:  { reported: 0, billboards: 0, plundered: 0, krakened: 0, questionable: 0 },
  })

  function legendKeyForIconType(iconType) {
    switch (iconType) {
      case ctx.ICON_TYPES.REPORTED_SIGNS:         return 'reported'
      case ctx.ICON_TYPES.PLUNDERED:              return 'plundered'
      case ctx.ICON_TYPES.KRAKENED:               return 'krakened'
      case ctx.ICON_TYPES.SIGHTINGS_QUESTIONABLE: return 'questionable'
      default: return 'reported'
    }
  }

  function legendKeyForCategoryValue(v) {
    return v === ctx.CATEGORY_BILLBOARD ? 'billboards' : legendKeyForIconType(v)
  }

  function legendKeyForReportType(reportType='') {
    const cat = ctx.categoryForReportType(reportType)
    return legendKeyForIconType(cat)
  }

  function recomputeCountsAndBanner() {
    if (!S.map) return
    const b = S.map.getBounds()
    ctx.ensureFilterPassSets()

    if (ctx.initialLoading.value) {
      ctx.noPinsWarning.value = false
      ctx.noPinsAreaBanner.value = false
      return
    }

    // reset
    counts.value.approved = { reported:0, billboards:0, plundered:0, krakened:0, questionable:0 }
    counts.value.pending  = { reported:0, billboards:0, plundered:0, krakened:0, questionable:0 }

    let availableApproved = 0
    let availablePending  = 0

    const candidates = ctx.getCandidateMarkerIds(b)
    for (const pinId of candidates) {
      const marker = ctx.pinMarkerMap.get(pinId)
      if (!marker) continue

      let lat = marker.__lat
      let lng = marker.__lng
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        const ll = marker.getLatLng?.()
        lat = ll?.lat
        lng = ll?.lng
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
        marker.__lat = lat
        marker.__lng = lng
        ctx.indexMarkerByCell(pinId, lat, lng)
      }
      if (!b.contains([lat, lng])) continue

      const isPending = marker.__approved === false
      if (ctx.filterPassNoCategoryIds.has(pinId)) {
        if (isPending) availablePending += 1
        else availableApproved += 1
      }

      if (!ctx.filterPassWithCategoryIds.has(pinId)) continue

      const key = legendKeyForCategoryValue(ctx.categoryValueForMarker(marker))
      if (isPending) {
        counts.value.pending[key] = (counts.value.pending[key] || 0) + 1
      } else {
        counts.value.approved[key] = (counts.value.approved[key] || 0) + 1
      }
    }

    // shown totals
    const totalApprovedShown = Object.values(counts.value.approved).reduce((a,b)=>a+b,0)
    const totalPendingShown  = Object.values(counts.value.pending).reduce((a,b)=>a+b,0)

    // If all category filters are OFF, show a clear hint.
    if (ctx.activeCategories.value.size === 0) {
      const totalAvailable = availableApproved + availablePending
      ctx.noPinsWarning.value    = totalAvailable > 0
      ctx.noPinsAreaBanner.value = totalAvailable === 0
      return
    }

    // Normal rule
    const anyFilterOn = ctx.activeCategories.value.size > 0
    ctx.noPinsAreaBanner.value = !!anyFilterOn && (totalApprovedShown + totalPendingShown === 0)
    ctx.noPinsWarning.value = false
  }

  let _myReportsToastShown = false;

  watch([ctx.myReportsOnly, ctx.myReportsReady], ([only, ready], [prevOnly]) => {
    // fire only on the transition to ON, once we know the set size
    if (only && !prevOnly && ready && ctx.myReportedPinIds.size === 0 && !_myReportsToastShown) {
      _myReportsToastShown = true;
      try { ctx.showToast('You have no reports yet. Showing none.', 'info'); } catch {}
    }
  });

  function iconTypeForLegendKey(key) {
    switch (key) {
      case 'reported':     return ctx.ICON_TYPES.REPORTED_SIGNS
      case 'billboards':   return ctx.CATEGORY_BILLBOARD
      case 'plundered':    return ctx.ICON_TYPES.PLUNDERED
      case 'krakened':     return ctx.ICON_TYPES.KRAKENED
      case 'questionable': return ctx.ICON_TYPES.SIGHTINGS_QUESTIONABLE
      default:             return ctx.ICON_TYPES.REPORTED_SIGNS
    }
  }

  function legendDotStyle(key) {
    const cat = iconTypeForLegendKey(key)
    const { fill, stroke } = ctx.colorForCategory(cat)   // reuses your existing hue + stroke rule
    return {
      backgroundColor: fill,
      borderColor: stroke,
    }
  }

  function isLegendRowActive(key) {
    return ctx.activeCategories.value.has(iconTypeForLegendKey(key))
  }

  function onLegendRowToggle(key) {
    ctx.toggleCategory(iconTypeForLegendKey(key))
  }

  function onLegendRowKey(e, key) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onLegendRowToggle(key)
    }
  }

  // Color dot style (fill + inner stroke color)
  function dotStyle(key) {
    const cat = iconTypeForLegendKey(key)
    const { fill, stroke } = ctx.colorForCategory(cat)
    return { background: fill, color: stroke }
  }

  Object.assign(ctx, { counts, dotStyle, iconTypeForLegendKey, isLegendRowActive, legendDotStyle, legendKeyForCategoryValue, legendKeyForIconType, legendKeyForReportType, legendRows, onLegendRowKey, onLegendRowToggle, recomputeCountsAndBanner })
  return { counts, dotStyle, iconTypeForLegendKey, isLegendRowActive, legendDotStyle, legendKeyForCategoryValue, legendKeyForIconType, legendKeyForReportType, legendRows, onLegendRowKey, onLegendRowToggle, recomputeCountsAndBanner }
}
