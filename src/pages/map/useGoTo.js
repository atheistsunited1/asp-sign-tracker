// Jump-to box: coordinate / pin-id / address suggestions (local + geocoder), choose & focus a pin.
// Extracted verbatim from MapPage.vue (issue #97 step 2). Shared map state is on
// `ctx` (see mapContext.js): other composables' members are referenced as
// `ctx.<name>`; mutable shared lets live on `ctx.state`.
import { ref } from 'vue'
import { clampLat, normalizeLng } from '@/shared/lib/coords'

export function useGoTo(ctx) {
  const S = ctx.state

  // Jump-to shows a short placeholder until focused (the bar widens on focus).
  const goToFocused = ref(false)

  const goToSuggestions = ref([])

  const goToSelIndex = ref(-1)

  const goToAddressCache = new Map()

  S.goToAddressAbort = null

  S.goToTemporaryPinId = null

  // --- coord pill state ---
  const coordInput = ref('')

  function markerLatLng(marker) {
    if (!marker) return null
    const ll = marker.getLatLng?.()
    if (ll && Number.isFinite(ll.lat) && Number.isFinite(ll.lng)) return ll
    const lat = Number(marker.__lat)
    const lng = Number(marker.__lng)
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng }
    return null
  }

  // Accepts:
  //  • "lat,lng" or "lat lng"
  //  • Google Maps: .../@lat,lng,...  or ?q=lat,lng or ?ll=lat,lng
  //  • Apple Maps:  ...?ll=lat,lng or ?q=lat,lng
  //  • Waze:        ...?ll=lat,lng or ?lat=..&lon=..
  //  • Google Earth Web: .../@lat,lng,
  //  • Generic: lat=-33.1&lng=151.2  or latitude=..&longitude=..
  // Returns {lat,lng} | null
  function extractLatLngFromAny(input){
    const s = (input || '').trim()

    // 1) plain pair
    let m = s.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/)
    if (m) {
      const lat = parseFloat(m[1]), lng = parseFloat(m[2])
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat: clampLat(lat), lng: normalizeLng(lng) }
    }

    // Try URL forms
    let url = null
    try { url = new URL(s) } catch { /* not a URL */ }

    if (url) {
      // 2) path: @lat,lng
      m = url.href.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/)
      if (m) {
        const lat = parseFloat(m[1]), lng = parseFloat(m[2])
        if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat: clampLat(lat), lng: normalizeLng(lng) }
      }

      // 3) common query params
      const tryPairs = [
        ['ll', (v)=>{ const p=v.split(/[, ]/); if(p.length>=2) return {lat:+p[0], lng:+p[1]}; return null }],
        ['q',  (v)=>{ const p=v.split(/[, ]/); if(p.length>=2 && isFinite(+p[0]) && isFinite(+p[1])) return {lat:+p[0], lng:+p[1]}; return null }],
        ['lat',(v)=>{ const lat = +v; const lngParam = url.searchParams.get('lng') ?? url.searchParams.get('lon') ?? url.searchParams.get('long'); if(lngParam!=null) return {lat, lng:+lngParam}; return null }],
      ]
      for (const [key, fn] of tryPairs) {
        const val = url.searchParams.get(key)
        if (val != null) {
          const out = fn(val)
          if (out && Number.isFinite(out.lat) && Number.isFinite(out.lng)) {
            return { lat: clampLat(out.lat), lng: normalizeLng(out.lng) }
          }
        }
      }

      // 4) generic lat=.. & (lng|lon)=..
      const mm = url.href.match(/(?:^|[?&])(lat|latitude)=(-?\d+(?:\.\d+)?).*?(?:^|[?&])(lng|lon|long|longitude)=(-?\d+(?:\.\d+)?)/i)
      if (mm) {
        const lat = parseFloat(mm[2]), lng = parseFloat(mm[4])
        if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat: clampLat(lat), lng: normalizeLng(lng) }
      }
    }

    // 5) free text with labels
    m = s.match(/lat(?:itude)?\s*[:=]?\s*(-?\d+(?:\.\d+)?)[^\d-]+(?:lng|lon|long|longitude)\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i)
    if (m) {
      const lat = parseFloat(m[1]), lng = parseFloat(m[2])
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat: clampLat(lat), lng: normalizeLng(lng) }
    }

    return null
  }

  function centerOfPins(pins = []) {
    if (!pins.length) return null
    let latTotal = 0
    let lngTotal = 0
    let count = 0
    for (const p of pins) {
      const lat = Number(p?.lat)
      const lng = Number(p?.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      latTotal += lat
      lngTotal += lng
      count += 1
    }
    if (!count) return null
    return { lat: latTotal / count, lng: lngTotal / count }
  }

  function addUniqueSuggestion(out, seen, item) {
    if (!item?.key) return
    if (seen.has(item.key)) return
    seen.add(item.key)
    out.push(item)
  }

  function buildGoToSuggestions(query, { allowPinFuzzy = false } = {}) {
    const q = String(query || '').trim()
    if (!q) return []

    const out = []
    const seen = new Set()
    const ql = q.toLowerCase()
    const maxPins = allowPinFuzzy ? 8 : 4

    const coordHit = extractLatLngFromAny(q)
    if (coordHit) {
      addUniqueSuggestion(out, seen, {
        type: 'coords',
        key: `coords:${coordHit.lat.toFixed(6)},${coordHit.lng.toFixed(6)}`,
        label: `${coordHit.lat.toFixed(6)}, ${coordHit.lng.toFixed(6)}`,
        sub: 'Coordinate',
        lat: coordHit.lat,
        lng: coordHit.lng,
      })
    }

    let pinCount = 0
    // Pins match by Pin ID only (exact, or prefix when fuzzy matching is allowed).
    // Every pin has a Pin ID (generated from short_num), so UUIDs are neither
    // matched nor shown — matching UUID fragments produced noisy results (#69).
    for (const [pid, marker] of ctx.pinMarkerMap) {
      if (pinCount >= maxPins) break
      const fid = String(marker?.__friendlyId || '')
      if (!fid) continue
      const fidLower = fid.toLowerCase()
      const exact = fidLower === ql
      const prefix = allowPinFuzzy && q.length >= 2 && fidLower.startsWith(ql)
      if (!exact && !prefix) continue

      const ll = markerLatLng(marker)
      if (!ll) continue
      pinCount += 1
      addUniqueSuggestion(out, seen, {
        type: 'pin',
        key: `pin:${pid}`,
        label: fid,
        sub: `${ll.lat.toFixed(6)}, ${ll.lng.toFixed(6)}`,
        lat: ll.lat,
        lng: ll.lng,
        pinId: pid,
        exact,
      })
    }

    const cityBuckets = new Map()
    for (const p of (ctx.supabasePins?.value || [])) {
      const city = String(p?.city || '').trim()
      const state = String(p?.state || '').trim()
      if (!city && !state) continue
      const label = `${city}${city && state ? ', ' : ''}${state}`.trim()
      const labelLower = label.toLowerCase()
      if (!labelLower.includes(ql)) continue
      const key = `city:${labelLower}`
      const list = cityBuckets.get(key) || []
      list.push(p)
      cityBuckets.set(key, list)
    }
    for (const [key, pins] of cityBuckets) {
      const center = centerOfPins(pins)
      if (!center) continue
      const p0 = pins[0]
      const city = String(p0?.city || '').trim()
      const state = String(p0?.state || '').trim()
      addUniqueSuggestion(out, seen, {
        type: 'place',
        key,
        label: `${city}${city && state ? ', ' : ''}${state}`.trim(),
        sub: `${pins.length} pin${pins.length === 1 ? '' : 's'}`,
        lat: center.lat,
        lng: center.lng,
      })
      if (out.length >= 12) break
    }

    if (/^\d{1,10}$/.test(q)) {
      const zipBuckets = new Map()
      for (const p of (ctx.supabasePins?.value || [])) {
        const zip = String(p?.zip || '').trim()
        if (!zip || !zip.startsWith(q)) continue
        const list = zipBuckets.get(zip) || []
        list.push(p)
        zipBuckets.set(zip, list)
      }
      for (const [zip, pins] of zipBuckets) {
        const center = centerOfPins(pins)
        if (!center) continue
        const p0 = pins[0]
        const city = String(p0?.city || '').trim()
        const state = String(p0?.state || '').trim()
        addUniqueSuggestion(out, seen, {
          type: 'zip',
          key: `zip:${zip}`,
          label: zip,
          sub: `${city}${city && state ? ', ' : ''}${state}`,
          lat: center.lat,
          lng: center.lng,
        })
        if (out.length >= 12) break
      }
    }

    return out.slice(0, 12)
  }

  async function fetchExternalGoToSuggestions(query) {
    const q = String(query || '').trim()
    if (q.length < 2) return []
    try { S.goToAddressAbort?.abort() } catch {}
    const ctrl = new AbortController()
    S.goToAddressAbort = ctrl

    const cacheKey = q.toLowerCase()
    if (goToAddressCache.has(cacheKey)) return goToAddressCache.get(cacheKey)

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&q=${encodeURIComponent(q)}`
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) return []
      const rows = await res.json()
      const out = (Array.isArray(rows) ? rows : []).map((r) => {
        const lat = Number(r?.lat)
        const lng = Number(r?.lon)
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
        const label = String(r?.display_name || '').split(',').slice(0, 3).join(', ').trim()
        const isZip = /^\d{1,10}$/.test(q)
        return {
          type: isZip ? 'zip' : 'place',
          key: `ext:${r?.place_id || `${lat}:${lng}`}`,
          label: label || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          sub: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          lat,
          lng,
        }
      }).filter(Boolean)
      goToAddressCache.set(cacheKey, out)
      return out
    } catch (err) {
      if (err?.name === 'AbortError') return []
      return []
    }
  }

  let goToSeq = 0

  async function refreshGoToSuggestions({ allowPinFuzzy = false } = {}) {
    const q = String(coordInput.value || '').trim()
    const seq = ++goToSeq
    let list = buildGoToSuggestions(q, { allowPinFuzzy })
    goToSuggestions.value = list
    goToSelIndex.value = list.length ? 0 : -1
    if (!q || list.length >= 8) return

    const external = await fetchExternalGoToSuggestions(q)
    if (seq !== goToSeq || !external.length) return
    const seen = new Set(list.map((x) => x.key))
    for (const row of external) addUniqueSuggestion(list, seen, row)
    list = list.slice(0, 12)
    goToSuggestions.value = list
    if (goToSelIndex.value < 0 && list.length) goToSelIndex.value = 0
  }

  function moveGoToSuggestion(delta) {
    const items = goToSuggestions.value
    if (!items.length) return
    const max = items.length - 1
    let next = goToSelIndex.value + delta
    if (next < 0) next = max
    if (next > max) next = 0
    goToSelIndex.value = next
  }

  function onGoToInput() {
    const q = String(coordInput.value || '').trim()
    if (!q) {
      clearGoToSuggestions()
      clearGoToTemporaryPinVisibility()
      return
    }
    // Prefix matching on Pin IDs is quiet enough to run while typing (#69); the
    // "exact only while typing" guard existed for the old UUID-substring noise.
    refreshGoToSuggestions({ allowPinFuzzy: true }).catch(() => {})
  }

  async function onGoToEnter() {
    if (!goToSuggestions.value.length) {
      await refreshGoToSuggestions({ allowPinFuzzy: true })
    } else if (goToSelIndex.value < 0) {
      goToSelIndex.value = 0
    }
    if (goToSelIndex.value >= 0) {
      await chooseGoToSuggestion(goToSelIndex.value)
    }
  }

  function clearGoToSuggestions() {
    goToSuggestions.value = []
    goToSelIndex.value = -1
  }

  function clearGoToTemporaryPinVisibility({ redraw = true } = {}) {
    if (!S.goToTemporaryPinId) return false
    const didClear = ctx.temporaryVisiblePinIds.delete(S.goToTemporaryPinId)
    S.goToTemporaryPinId = null
    if (didClear && redraw) {
      ctx.redrawPins(S.map, { filtersChanged: true })
      ctx.recomputeCountsAndBanner()
    }
    return didClear
  }

  async function chooseGoToSuggestion(index) {
    const item = goToSuggestions.value[index]
    if (!item) return
    goToSelIndex.value = index
    const clearedGoToOverride = clearGoToTemporaryPinVisibility({ redraw: false })

    if (item.type === 'pin' && item.pinId) {
      const hadTargetOverride = ctx.temporaryVisiblePinIds.has(item.pinId)
      coordInput.value = item.label || item.pinId
      clearGoToSuggestions()
      const focused = await focusPinById(item.pinId, {
        temporaryOverride: true,
        zoom: 18,
        showOverrideToast: false,
      })
      if (focused) S.goToTemporaryPinId = item.pinId
      if (clearedGoToOverride && (!focused || hadTargetOverride)) {
        ctx.redrawPins(S.map, { filtersChanged: true })
        ctx.recomputeCountsAndBanner()
      }
      return
    }

    if (Number.isFinite(item.lat) && Number.isFinite(item.lng)) {
      coordInput.value = item.label || `${item.lat.toFixed(6)}, ${item.lng.toFixed(6)}`
      clearGoToSuggestions()
      if (item.type === 'coords') {
        try { S.map?.setView([item.lat, item.lng], Math.max(S.map?.getZoom?.() || 8, 12), { animate: true }) } catch {}
      } else {
        try { S.map?.setView([item.lat, item.lng], 12, { animate: true }) } catch {}
      }
      if (clearedGoToOverride) {
        ctx.redrawPins(S.map, { filtersChanged: true })
        ctx.recomputeCountsAndBanner()
      }
    }
  }

  async function focusPinById(pinId, {
    temporaryOverride = false,
    zoom = 18,
    showOverrideToast = true,
  } = {}) {
    if (!pinId) return false
    const marker = ctx.pinMarkerMap.get(pinId)
    if (!marker) return false

    let didOverride = false
    if (temporaryOverride && !ctx.temporaryVisiblePinIds.has(pinId)) {
      ctx.temporaryVisiblePinIds.add(pinId)
      didOverride = true
    }

    if (didOverride) {
      ctx.redrawPins(S.map, { filtersChanged: true })
      ctx.recomputeCountsAndBanner()
      if (showOverrideToast) {
        ctx.showToast('Pin temporarily unhidden until search is cleared.', 'info')
      }
    } else if (!S.map?.hasLayer?.(marker)) {
      ctx.redrawPins(S.map, { filtersChanged: true })
      ctx.recomputeCountsAndBanner()
    }

    const ll = markerLatLng(marker)
    if (ll && S.map) {
      const targetZoom = Math.max(Number(S.map.getZoom?.() || 0), zoom)
      S.map.setView([ll.lat, ll.lng], targetZoom, { animate: true })
    }
    try { marker.openPopup?.() } catch {}
    return true
  }

  // Focus panel search when tray opens
  const coordInputEl = ref(null)

  Object.assign(ctx, { addUniqueSuggestion, buildGoToSuggestions, centerOfPins, chooseGoToSuggestion, clearGoToSuggestions, clearGoToTemporaryPinVisibility, coordInput, coordInputEl, extractLatLngFromAny, fetchExternalGoToSuggestions, focusPinById, goToAddressCache, goToFocused, goToSelIndex, goToSuggestions, markerLatLng, moveGoToSuggestion, onGoToEnter, onGoToInput, refreshGoToSuggestions })
  return { addUniqueSuggestion, buildGoToSuggestions, centerOfPins, chooseGoToSuggestion, clearGoToSuggestions, clearGoToTemporaryPinVisibility, coordInput, coordInputEl, extractLatLngFromAny, fetchExternalGoToSuggestions, focusPinById, goToAddressCache, goToFocused, goToSelIndex, goToSuggestions, markerLatLng, moveGoToSuggestion, onGoToEnter, onGoToInput, refreshGoToSuggestions }
}
