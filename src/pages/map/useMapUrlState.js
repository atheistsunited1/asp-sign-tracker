// URL ↔ map state: ll/z/fid, filter/search query params, passive updates.
// Extracted verbatim from MapPage.vue (issue #97 step 2). Shared map state is on
// `ctx` (see mapContext.js): other composables' members are referenced as
// `ctx.<name>`; mutable shared lets live on `ctx.state`.
import { watch } from 'vue'
import { clampLat, normalizeLng } from '@/shared/lib/coords'

export function useMapUrlState(ctx) {
  const S = ctx.state

  S.urlTargeted = false

  // Build an app URL that carries ll + fid (+ z=19 by default)
  function appPinUrl({ lat, lng, fid, z = 19 }) {
    const url = new URL(window.location.href);
    url.searchParams.set('ll', `${(+lat).toFixed(6)},${(+lng).toFixed(6)}`);
    url.searchParams.set('z', String(z));
    if (fid) url.searchParams.set('fid', String(fid));
    return url.toString();
  }

  // Replace-only ll/z/fid without triggering router watchers
  function setUrlWithFidPassive(lat, lng, fid) {
    const url = new URL(window.location.href);
    url.searchParams.set('ll', `${(+lat).toFixed(6)},${(+lng).toFixed(6)}`);
    const z = S.map?.getZoom?.();
    if (Number.isFinite(z)) url.searchParams.set('z', String(z));
    if (fid) url.searchParams.set('fid', String(fid));
    history.replaceState(history.state, '', url);
  }

  let lastUrlState = { ll: null, z: null }

  function updateUrlFromMap(passive = true, reason = 'move/zoom') {
    if (!S.map) return
    const c = S.map.getCenter()
    const z = S.map.getZoom()
    const llStr = `${(+c.lat).toFixed(6)},${(+c.lng).toFixed(6)}`
    const zStr = String(z)

    // Skip if nothing changed since last write
    if (lastUrlState.ll === llStr && lastUrlState.z === zStr) return
    lastUrlState = { ll: llStr, z: zStr }

    if (passive) {
      // uses history.replaceState and *includes z*
      setUrlCoordPassive(c.lat, c.lng)
    } else {
      // would trigger router watcher; probably not what we want here
      setUrlCoord(c.lat, c.lng)
    }
    ctx.log('🔗 url:update from map', { reason, ll: llStr, z: zStr })
  }

  // tiny debounce
  function debounce(fn, ms = 150) {
    let t
    return (...args) => {
      clearTimeout(t)
      t = setTimeout(() => fn(...args), ms)
    }
  }

  function parseZoom(z) {
    const n = Number(z)
    if (!Number.isFinite(n)) {
      if (z != null) ctx.log('🧭 parseZoom: invalid', { z })
      return null
    }
    return Math.max(3, Math.min(20, Math.round(n)))
  }

  const syncSearchStateToUrlDebounced = debounce(() => {
    try { syncSearchStateToUrl() } catch {}
  }, 180)

  watch(
    [
      ctx.activeCategories,
      ctx.myReportsOnly,
      ctx.majorCampaignOnly,
      ctx.bookmarkedOnly,
      ctx.pinFilterCity,
      ctx.pinFilterState,
      ctx.pinFilterCountry,
      () => ctx.remoteSearch.q,
      () => ctx.remoteSearch.page,
    ],
    () => syncSearchStateToUrlDebounced(),
    { deep: true },
  )

  function setUrlCoord(lat, lng) {
    try {
      const q = { ...ctx.route.query, ll: `${(+lat).toFixed(6)},${(+lng).toFixed(6)}` }
      
      const z = S.map?.getZoom?.()
      if (Number.isFinite(z)) q.z = String(z)
      ctx.log('🔗 setUrlCoord(router.replace)', { ll: q.ll, z: q.z })
      ctx.router.replace({ query: q })
    } catch {}
  }

  function setUrlCoordPassive(lat, lng) {
    const url = new URL(window.location.href);
    url.searchParams.set('ll', `${(+lat).toFixed(6)},${(+lng).toFixed(6)}`);
    const z = S.map?.getZoom?.()
    if (Number.isFinite(z)) url.searchParams.set('z', String(z))
      ctx.log('🔗 setUrlCoordPassive(history.replaceState)', {
        ll: url.searchParams.get('ll'),
        z: url.searchParams.get('z')
      })
    history.replaceState(history.state, '', url); // no router nav, no watchers
  }

  function parseCsvParam(v) {
    return String(v || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
  }

  function syncSearchStateToUrl() {
    const url = new URL(window.location.href)
    const setOrDelete = (key, value) => {
      const val = String(value ?? '').trim()
      if (!val) url.searchParams.delete(key)
      else url.searchParams.set(key, val)
    }

    setOrDelete('sq', ctx.remoteSearch.q)
    setOrDelete('spg', ctx.remoteSearch.page > 1 ? String(ctx.remoteSearch.page) : '')

    const catCsv = [...ctx.activeCategories.value].sort((a, b) => a - b).join(',')
    setOrDelete('fcat', catCsv)
    setOrDelete('fmy', ctx.myReportsOnly.value ? '1' : '')
    setOrDelete('fmaj', ctx.majorCampaignOnly.value ? '1' : '')
    setOrDelete('fbm', ctx.bookmarkedOnly.value ? '1' : '')
    setOrDelete('fcity', ctx.pinFilterCity.value)
    setOrDelete('fstate', ctx.pinFilterState.value)
    setOrDelete('fcountry', ctx.pinFilterCountry.value)

    history.replaceState(history.state, '', url)
  }

  function loadSearchStateFromUrl() {
    const q = ctx.route.query || {}
    ctx.remoteSearch.q = String(q.sq || '')
    ctx.remoteSearch.page = Math.max(1, Number(q.spg || 1) || 1)

    const cats = ctx.normalizeCats(parseCsvParam(q.fcat).map((v) => Number(v)))
    if (Array.isArray(cats) && cats.length) ctx.activeCategories.value = new Set(cats)
    if (q.fmy != null) ctx.myReportsOnly.value = String(q.fmy) === '1'
    if (q.fmaj != null) ctx.majorCampaignOnly.value = String(q.fmaj) === '1'
    if (q.fbm != null) ctx.bookmarkedOnly.value = String(q.fbm) === '1'
    ctx.pinFilterCity.value = String(q.fcity || '')
    ctx.pinFilterState.value = String(q.fstate || '')
    ctx.pinFilterCountry.value = String(q.fcountry || '')
  }

  function parseLlQuery(ll) {
    if (!ll) return null
    // accept "lat,lng" OR "lat lng" (any whitespace)
    const raw = String(ll)
    const m = raw.match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/)
    if (!m) {
      ctx.log('🧭 parseLlQuery: no match', { ll: raw })
      return null
    }
    const lat = clampLat(+m[1])
    const lng = normalizeLng(+m[2])
    return { lat, lng }
  }

  function goToQueryCoordinate({ lat, lng }, z) {
    // honor persisted filter state; do not override here
    const zoom = parseZoom(z) ?? 8
    const layer = zoom >= 15 ? 'Satellite' : 'Streets'
    ctx.switchBaseLayer(layer)
    S.map.setView(ctx.safeLatLng(lat, lng), zoom, { animate: false })
    ctx.recomputeCountsAndBanner()
  }

  Object.assign(ctx, { appPinUrl, debounce, goToQueryCoordinate, loadSearchStateFromUrl, parseCsvParam, parseLlQuery, parseZoom, setUrlCoord, setUrlCoordPassive, setUrlWithFidPassive, syncSearchStateToUrl, syncSearchStateToUrlDebounced, updateUrlFromMap })
  return { appPinUrl, debounce, goToQueryCoordinate, loadSearchStateFromUrl, parseCsvParam, parseLlQuery, parseZoom, setUrlCoord, setUrlCoordPassive, setUrlWithFidPassive, syncSearchStateToUrl, syncSearchStateToUrlDebounced, updateUrlFromMap }
}
