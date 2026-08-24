// Pin layer: marker maps, loading pins from Supabase, redraw with draw priority, temp pins.
// Extracted verbatim from MapPage.vue. Shared map state is on
// `ctx` (see mapContext.js): other composables' members are referenced as
// `ctx.<name>`; mutable shared lets live on `ctx.state`.
import { ref } from 'vue'
import { errorToUserMessage } from '@/shared/lib/errors'
import { logger } from '@/shared/lib/logger'
import {
  deleteBookmarkForUser,
  fetchBookmarksForUser,
  fetchPinById,
  fetchPinsPage,
  fetchPhotoRowsForReportIds,
  fetchReportIdsForPin,
  fetchReportedPinIdsByUser,
  fetchReportsForPin as fetchReportsForPinSvc,
  insertReports,
  upsertBookmarkForUser,
  updatePinById,
  warmSupabaseConnection,
} from '@/pages/map/mapService'
import {
  colorOptionRowsForPin,
  defaultColorForPin,
  DRAW_PRIORITY_LEVELS,
  drawPriorityForPin,
  normalizeIconColorForPin,
  normalizeSignType,
} from '@/shared/domain/pinVisuals'

export function usePinLayer(ctx) {
  const S = ctx.state

  const pinMarkerMap = new Map()

  const tempMarkerMap = new Map()

  const tempPins = ref([])

  S.tempPinSeq = 0

  const draggedPins = new Map()

  const temporaryVisiblePinIds = new Set()

  // Fast lookup instead of supabasePins.value.find(...)
  const pinById = new Map()

  async function loadPinsFromSupabase(_mapArg) {
    console.time('[Map] pins-load')

    const pageSize = 1000
    let allPins = []
    let totalCount = 0
    const pinsColumnsBase =
      'id,lat,lng,icon_type,icon_color,friendly_id,description,' +
      'is_major_campaign,' +
      'sign_text,sign_type,city,state,is_approved,' +
      'updated_at,created_at'
    const pinsColumnsWithZip = `${pinsColumnsBase},zip`
    let fetchRange = (from, to) => fetchPinsPage({ columns: pinsColumnsWithZip, from, to })

    let first = await fetchRange(0, pageSize - 1)
    if (first.error && String(first.error?.message || '').toLowerCase().includes('zip')) {
      fetchRange = (from, to) => fetchPinsPage({ columns: pinsColumnsBase, from, to })
      first = await fetchRange(0, pageSize - 1)
    }
    if (first.error) {
      logger.error('Map failed to load first pins page', first.error)
      ctx.showToast(errorToUserMessage(first.error, 'Failed to load map pins.'), 'error')
      console.timeEnd('[Map] pins-load')
      return
    }

    const firstPins = first.data ?? []
    allPins = allPins.concat(firstPins)
    totalCount = Number.isFinite(first.count) ? first.count : firstPins.length

    if (Number.isFinite(totalCount) && totalCount > firstPins.length) {
      const ranges = []
      for (let from = firstPins.length; from < totalCount; from += pageSize) {
        ranges.push({ from, to: Math.min(from + pageSize - 1, totalCount - 1) })
      }

      const failedRanges = []
      const batchSize = 6
      for (let i = 0; i < ranges.length; i += batchSize) {
        const batch = ranges.slice(i, i + batchSize)
        const pageResults = await Promise.allSettled(
          batch.map((r) => fetchRange(r.from, r.to))
        )
        pageResults.forEach((res, idx) => {
          const r = batch[idx]
          if (res.status !== 'fulfilled') {
            failedRanges.push(r)
            return
          }
          if (res.value?.error) {
            failedRanges.push(r)
            return
          }
          allPins = allPins.concat(res.value?.data ?? [])
        })
      }

      for (const r of failedRanges) {
        const retry = await fetchRange(r.from, r.to)
        if (retry.error) {
          logger.warn('Map pins page retry failed', { from: r.from, to: r.to, error: retry.error })
          continue
        }
        allPins = allPins.concat(retry.data ?? [])
      }
    } else if (firstPins.length === pageSize) {
      // Fallback path when count is unavailable.
      let offset = pageSize
      while (true) {
        const { data: pins, error } = await fetchRange(offset, offset + pageSize - 1)
        if (error) {
          logger.error('Map failed to load pins page', error)
          break
        }
        const rows = pins ?? []
        allPins = allPins.concat(rows)
        if (rows.length < pageSize) break
        offset += pageSize
      }
    }

    const dedup = new Map()
    for (const p of allPins) {
      if (!p?.id) continue
      if (!dedup.has(p.id)) dedup.set(p.id, p)
    }
    allPins = [...dedup.values()]

    ctx.supabasePins.value = allPins
    ctx.log('pins loaded … SUCCESSFUL', { count: allPins.length, total: totalCount || allPins.length })

    for (const marker of pinMarkerMap.values()) {
      ctx.unmountPopupApp(marker)
      if (S.map?.hasLayer(marker)) S.map.removeLayer(marker)
    }
    pinMarkerMap.clear()
    pinById.clear()
    ctx.clearRenderCaches()

    for (const p of allPins) {
      const fid   = (p.friendly_id || '')
      const ldesc = (p.description || '')
      const stxt  = (p.sign_text || '')
      const styp  = (p.sign_type || '')
      const zip   = (p.zip || '')
      const country = ctx.inferredCountryForPin(p)

      // Text blob for "All fields" (ID + location + sign fields)
      p.__all = `${p.id} ${fid} ${ldesc} ${stxt} ${styp} ${p.city || ''} ${p.state || ''} ${zip} ${country}`.toLowerCase().trim()

      // Ensure numbers
      const latN = Number(p.lat)
      const lngN = Number(p.lng)
      p.lat = latN
      p.lng = lngN
      p.is_approved = !!p.is_approved
      p.country = country

      // Prebuilt coordinate strings & integer microdegrees
      p.__coordText6 = `${latN.toFixed(6)}, ${lngN.toFixed(6)}`
      p.__latE6 = Math.round(latN * 1e6)
      p.__lngE6 = Math.round(lngN * 1e6)

      pinById.set(p.id, p)
    }

    console.time('[Map] markers-create')
    const renderJobs = allPins.map((row) => {
      // Build a unified pin object that Map rendering expects
      const pin = ctx.buildPinFromRow(row)
      return ctx.renderPinWithPopup(pin)
    })
    const renderResults = await Promise.allSettled(renderJobs)
    const failedRenders = renderResults.filter((r) => r.status === 'rejected').length
    if (failedRenders) {
      logger.warn('Map marker render failures', { failedRenders })
    }

    console.timeEnd('[Map] markers-create')

    ctx.markFilterPassDirty()
    console.timeEnd('[Map] pins-load')
    redrawPins(S.map, { filtersChanged: true })
  }

  // Re-sorts the shared canvas draw list so overlapping markers stack by
  // category priority (see drawPriorityForPin). Within a category relative
  // order doesn't matter, so one bringToFront pass in ascending priority —
  // each an O(1) linked-list move — leaves the whole list correctly ordered.
  function enforceDrawPriority() {
    const buckets = Array.from({ length: DRAW_PRIORITY_LEVELS }, () => [])
    const topBucket = buckets[DRAW_PRIORITY_LEVELS - 1]
    for (const pinId of ctx.visibleMarkerIds) {
      const marker = pinMarkerMap.get(pinId)
      if (!marker) continue
      ;(buckets[marker.__drawPriority] || topBucket).push(marker)
    }
    for (const bucket of buckets) {
      for (const marker of bucket) marker.bringToFront()
    }
  }

  function redrawPins(_mapArg, { filtersChanged = false } = {}) {
    if (filtersChanged) ctx.markFilterPassDirty()
    if (!S.map) return
    ctx.ensureFilterPassSets()

    const bounds = S.map.getBounds()
    const candidates = ctx.getCandidateMarkerIds(bounds)
    const nextVisible = new Set()
    let kept = 0
    let added = 0
    let removed = 0

    for (const pinId of candidates) {
      if (!ctx.filterPassWithCategoryIds.has(pinId)) continue
      const marker = pinMarkerMap.get(pinId)
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
      if (!bounds.contains([lat, lng])) continue

      nextVisible.add(pinId)
      kept += 1
    }

    for (const pinId of nextVisible) {
      const marker = pinMarkerMap.get(pinId)
      if (!marker) continue

      if (!ctx.visibleMarkerIds.has(pinId)) {
        if (!S.map.hasLayer(marker)) S.map.addLayer(marker)
        added += 1
      }
    }

    for (const pinId of ctx.visibleMarkerIds) {
      if (nextVisible.has(pinId)) continue
      const marker = pinMarkerMap.get(pinId)
      if (marker && S.map.hasLayer(marker)) {
        S.map.removeLayer(marker)
        removed += 1
      }
    }

    ctx.visibleMarkerIds.clear()
    for (const pinId of nextVisible) ctx.visibleMarkerIds.add(pinId)

    // Canvas paint order = renderer draw-list order, so newly added markers land
    // front-most regardless of category. Removals and style changes never
    // disturb relative order, so only re-sort when something was added.
    if (added > 0) enforceDrawPriority()

    ctx.dlog('redrawPins summary', {
      candidates: candidates.size,
      passFilter: ctx.filterPassWithCategoryIds.size,
      kept,
      added,
      removed,
    })
  }

  Object.assign(ctx, { draggedPins, enforceDrawPriority, loadPinsFromSupabase, pinById, pinMarkerMap, redrawPins, tempMarkerMap, tempPins, temporaryVisiblePinIds })
  return { draggedPins, enforceDrawPriority, loadPinsFromSupabase, pinById, pinMarkerMap, redrawPins, tempMarkerMap, tempPins, temporaryVisiblePinIds }
}
