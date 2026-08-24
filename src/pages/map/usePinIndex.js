// Marker spatial index (grid cells) and filter-pass sets used by redraw and the legend counts.
// Extracted verbatim from MapPage.vue (issue #97 step 2). Shared map state is on
// `ctx` (see mapContext.js): other composables' members are referenced as
// `ctx.<name>`; mutable shared lets live on `ctx.state`.
import { clampLat, normalizeLng } from '@/shared/lib/coords'

export function usePinIndex(ctx) {

  const GRID_CELL_DEG = 1

  const markerCellById = new Map()      // pinId -> "latCell:lngCell"

  const markerIdsByCell = new Map()     // "latCell:lngCell" -> Set(pinId)

  const visibleMarkerIds = new Set()    // pinIds currently on map

  const filterPassNoCategoryIds = new Set()

  const filterPassWithCategoryIds = new Set()

  let filterPassDirty = true

  function markFilterPassDirty() {
    filterPassDirty = true
  }

  function markerCellKey(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return `${Math.floor(lat / GRID_CELL_DEG)}:${Math.floor(lng / GRID_CELL_DEG)}`
  }

  function indexMarkerByCell(pinId, lat, lng) {
    const nextKey = markerCellKey(lat, lng)
    const prevKey = markerCellById.get(pinId)
    if (prevKey && prevKey !== nextKey) {
      const prevSet = markerIdsByCell.get(prevKey)
      if (prevSet) {
        prevSet.delete(pinId)
        if (prevSet.size === 0) markerIdsByCell.delete(prevKey)
      }
    }

    if (!nextKey) {
      markerCellById.delete(pinId)
      return
    }

    markerCellById.set(pinId, nextKey)
    let bucket = markerIdsByCell.get(nextKey)
    if (!bucket) {
      bucket = new Set()
      markerIdsByCell.set(nextKey, bucket)
    }
    bucket.add(pinId)
  }

  function unindexMarkerByCell(pinId) {
    const key = markerCellById.get(pinId)
    markerCellById.delete(pinId)
    if (!key) return
    const bucket = markerIdsByCell.get(key)
    if (!bucket) return
    bucket.delete(pinId)
    if (bucket.size === 0) markerIdsByCell.delete(key)
  }

  function clearRenderCaches() {
    markerCellById.clear()
    markerIdsByCell.clear()
    visibleMarkerIds.clear()
    filterPassNoCategoryIds.clear()
    filterPassWithCategoryIds.clear()
    ctx.photoStripCache.clear()
    markFilterPassDirty()
  }

  function getCandidateMarkerIds(bounds) {
    if (!bounds) return new Set(ctx.pinMarkerMap.keys())
    if (!markerIdsByCell.size) return new Set(ctx.pinMarkerMap.keys())

    const south = clampLat(bounds.getSouth())
    const north = clampLat(bounds.getNorth())
    const west = normalizeLng(bounds.getWest())
    const east = normalizeLng(bounds.getEast())
    if (!Number.isFinite(south) || !Number.isFinite(north) || !Number.isFinite(west) || !Number.isFinite(east)) {
      return new Set(ctx.pinMarkerMap.keys())
    }

    const latMin = Math.floor(Math.min(south, north) / GRID_CELL_DEG)
    const latMax = Math.floor(Math.max(south, north) / GRID_CELL_DEG)
    const lngSegments = west <= east
      ? [[west, east]]
      : [[west, 180], [-180, east]]

    const out = new Set()
    for (let latCell = latMin; latCell <= latMax; latCell += 1) {
      for (const [lngStart, lngEnd] of lngSegments) {
        const lngMin = Math.floor(lngStart / GRID_CELL_DEG)
        const lngMax = Math.floor(lngEnd / GRID_CELL_DEG)
        for (let lngCell = lngMin; lngCell <= lngMax; lngCell += 1) {
          const bucket = markerIdsByCell.get(`${latCell}:${lngCell}`)
          if (!bucket) continue
          for (const pinId of bucket) out.add(pinId)
        }
      }
    }
    return out
  }

  function synthesizePinForFilter(pinId, marker) {
    const lat = Number(marker?.__lat)
    const lng = Number(marker?.__lng)
    const lat6 = Number.isFinite(lat) ? lat.toFixed(6) : ''
    const lng6 = Number.isFinite(lng) ? lng.toFixed(6) : ''
    return {
      id: String(pinId),
      friendly_id: marker?.__friendlyId || '',
      description: marker?.__locDesc || '',
      sign_text: '',
      sign_type: '',
      city: '',
      state: '',
      zip: '',
      country: '',
      __coordText6: (lat6 && lng6) ? `${lat6}, ${lng6}` : '',
      __latE6: Number.isFinite(lat) ? Math.round(lat * 1e6) : 0,
      __lngE6: Number.isFinite(lng) ? Math.round(lng * 1e6) : 0,
      __all: `${pinId} ${marker?.__friendlyId || ''} ${(marker?.__locDesc || '')}`.toLowerCase(),
      is_approved: marker?.__approved !== false,
      is_major_campaign: false,
    }
  }

  function getPinForFilter(pinId, marker) {
    return ctx.pinById.get(pinId) || synthesizePinForFilter(pinId, marker)
  }

  function passesPolicyNoCategory(pinId, marker) {
    if (!marker) return false
    if (ctx.temporaryVisiblePinIds.has(pinId)) return true

    const pin = getPinForFilter(pinId, marker)
    const searchActive = !ctx.searchFiltersAreEmpty()
    if (searchActive && !ctx.remoteSearchMatchedPinIds.value.has(String(pin.id))) return false

    const cityFilter = ctx.normalizeFilterText(ctx.pinFilterCity.value)
    const stateFilter = ctx.normalizeFilterText(ctx.pinFilterState.value)
    const countryFilter = ctx.normalizeFilterText(ctx.pinFilterCountry.value)
    if (cityFilter && !ctx.normalizeFilterText(pin.city).includes(cityFilter)) return false
    if (stateFilter && !ctx.normalizeFilterText(pin.state).includes(stateFilter)) return false
    if (countryFilter && !ctx.normalizeFilterText(ctx.inferredCountryForPin(pin)).includes(countryFilter)) return false

    if (ctx.bookmarkedOnly.value && !ctx.isPinBookmarked(pin.id)) return false
    if (ctx.majorCampaignOnly.value && !ctx.isMajorCampaign(pin)) return false

    const myReportsGateActive = ctx.myReportsOnly.value && ctx.myReportsReady.value
    if (myReportsGateActive && !ctx.myReportedPinIds.has(pin.id)) return false
    return true
  }

  function rebuildFilterPassSets() {
    filterPassNoCategoryIds.clear()
    filterPassWithCategoryIds.clear()
    const allow = ctx.activeCategories.value

    for (const [pinId, marker] of ctx.pinMarkerMap.entries()) {
      if (ctx.temporaryVisiblePinIds.has(pinId)) {
        filterPassNoCategoryIds.add(pinId)
        filterPassWithCategoryIds.add(pinId)
        continue
      }
      if (!passesPolicyNoCategory(pinId, marker)) continue
      filterPassNoCategoryIds.add(pinId)
      if (allow.has(ctx.categoryValueForMarker(marker))) filterPassWithCategoryIds.add(pinId)
    }
    filterPassDirty = false
  }

  function ensureFilterPassSets() {
    if (filterPassDirty) rebuildFilterPassSets()
  }

  Object.assign(ctx, { GRID_CELL_DEG, clearRenderCaches, ensureFilterPassSets, filterPassNoCategoryIds, filterPassWithCategoryIds, getCandidateMarkerIds, getPinForFilter, indexMarkerByCell, markFilterPassDirty, markerCellById, markerCellKey, markerIdsByCell, passesPolicyNoCategory, rebuildFilterPassSets, synthesizePinForFilter, unindexMarkerByCell, visibleMarkerIds })
  return { GRID_CELL_DEG, clearRenderCaches, ensureFilterPassSets, filterPassNoCategoryIds, filterPassWithCategoryIds, getCandidateMarkerIds, getPinForFilter, indexMarkerByCell, markFilterPassDirty, markerCellById, markerCellKey, markerIdsByCell, passesPolicyNoCategory, rebuildFilterPassSets, synthesizePinForFilter, unindexMarkerByCell, visibleMarkerIds }
}
