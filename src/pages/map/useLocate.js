// Locate control: geolocation follow/passive states, camera moves, blue-dot layer.
// Extracted verbatim from MapPage.vue (issue #97 step 2). Shared map state is on
// `ctx` (see mapContext.js): other composables' members are referenced as
// `ctx.<name>`; mutable shared lets live on `ctx.state`.
import { computed, watch } from 'vue'
import { useGeolocation, GEO_STATUS } from '@/pages/map/useGeolocation'
import { createLocationLayer } from '@/pages/map/mapLocationLayer'

export function useLocate(ctx) {
  const S = ctx.state

  // ── Locate control (#68) ────────────────────────────────────────────────────
  // Geolocation state lives in the composable; drawing lives in the location
  // layer; this component only wires the button, the map camera and toasts.
  const geo = useGeolocation()

  const locateStatus = geo.status

  S.locationLayer = null             // created lazily once the map exists

  const LOCATE_ZOOM = 17               // close enough to see the street; USGS imagery is native to 16

  const CENTERED_TOLERANCE_PX = 40     // "map is on my dot" if the dot is within this many px of center

  const locateTitle = computed(() => ({
    [GEO_STATUS.IDLE]:        'Show my location',
    [GEO_STATUS.LOCATING]:    'Finding your location…',
    [GEO_STATUS.LOCATED]:     'Center on my location (tap again to follow)',
    [GEO_STATUS.FOLLOWING]:   'Following your location — tap to stop',
    [GEO_STATUS.PASSIVE]:     'Tap to re-center and keep following',
    [GEO_STATUS.DENIED]:      'Location access is blocked — allow it for this site, then tap again',
    [GEO_STATUS.UNAVAILABLE]: 'Geolocation is not supported in this browser',
    [GEO_STATUS.ERROR]:       'Could not get your location — tap to retry',
  })[locateStatus.value] || 'Show my location')

  function paintLocation(p) {
    if (!S.map || !p) return
    if (!S.locationLayer) S.locationLayer = createLocationLayer(S.map)
    S.locationLayer.update(p.lat, p.lng, p.accuracy)
    if (S.locationLayer.dot) ctx.applyRadius(S.locationLayer.dot)
  }

  // Our own camera moves also fire Leaflet's drag/move events; don't mistake
  // them for the user panning away (which is what drops follow → passive).
  let programmaticMoveUntil = 0

  function moveCamera(fn) {
    programmaticMoveUntil = Date.now() + 1000
    try { fn() } finally { /* timer-based guard; nothing to restore */ }
  }

  function centerOnLocation(p, { zoom = null, animate = true } = {}) {
    if (!S.map || !p) return
    const target = ctx.safeLatLng(p.lat, p.lng)
    moveCamera(() => { zoom != null ? S.map.setView(target, zoom, { animate }) : S.map.panTo(target, { animate }) })
  }

  function isMapCenteredOn(p) {
    if (!S.map || !p) return false
    try {
      const a = S.map.latLngToContainerPoint(ctx.safeLatLng(p.lat, p.lng))
      const c = S.map.getSize().divideBy(2)
      return a.distanceTo(c) <= CENTERED_TOLERANCE_PX
    } catch { return false }
  }

  function onUserPanStart() {
    if (Date.now() < programmaticMoveUntil) return
    if (geo.status.value === GEO_STATUS.FOLLOWING) geo.setPassive()
  }

  function followHandlers() {
    return {
      onUpdate: (p) => {
        paintLocation(p)
        S.locationLayer?.setStale(false)
        if (geo.status.value === GEO_STATUS.FOLLOWING) centerOnLocation(p)
      },
      // Transient watch errors (no fix / timeout) are expected in tunnels and
      // indoors; the watch keeps running and the next fix resumes — meanwhile the
      // dot goes grey so a stale position can't pass for a live one. Only a
      // denial (which also stops the watch) is worth telling the user about.
      onError: (e, { transient } = {}) => {
        if (transient) S.locationLayer?.setStale(true)
        else ctx.showToast(e.message, 'error')
      },
    }
  }

  // Location disabled (permission denied / no geolocation): no dot at all.
  watch(() => geo.status.value, (s) => {
    if (s === GEO_STATUS.DENIED || s === GEO_STATUS.UNAVAILABLE) S.locationLayer?.clear()
  })

  // Following is the second tap on Locate; say so once, the first time a tap
  // puts the user on their dot (Google doesn't, but our users aren't trained).
  function maybeShowFollowHint() {
    try {
      if (localStorage.getItem(ctx.LS_KEYS.locateFollowHintShown) === '1') return
      localStorage.setItem(ctx.LS_KEYS.locateFollowHintShown, '1')
    } catch {}
    ctx.showToast('Tap Locate again to follow your location as you move.', 'info', 5000)
  }

  async function onLocateTap() {
    if (ctx.initialLoading.value || !S.map) return
    const s = geo.status.value
    if (s === GEO_STATUS.UNAVAILABLE) { ctx.showToast('Geolocation is not supported in this browser.', 'error'); return }
    if (s === GEO_STATUS.LOCATING) return
    if (s === GEO_STATUS.FOLLOWING) { geo.stopFollow(); return }                         // stop following, keep the dot
    if (s === GEO_STATUS.PASSIVE) {                                                      // re-center and keep following
      centerOnLocation(geo.position.value, { zoom: Math.max(S.map.getZoom(), LOCATE_ZOOM) })
      geo.startFollow(followHandlers())
      return
    }
    if (s === GEO_STATUS.LOCATED && geo.position.value) {
      if (isMapCenteredOn(geo.position.value)) {                                         // second tap on the dot → follow
        centerOnLocation(geo.position.value, { zoom: Math.max(S.map.getZoom(), LOCATE_ZOOM) })
        geo.startFollow(followHandlers())
      } else {                                                                           // panned away → just re-center
        centerOnLocation(geo.position.value, { zoom: Math.max(S.map.getZoom(), LOCATE_ZOOM) })
        maybeShowFollowHint()
      }
      return
    }
    // idle / error / denied (retry): get a fix — fast first, then refined
    try {
      const p = await geo.getFix({ onUpdate: paintLocation })
      if (p) {
        centerOnLocation(p, { zoom: Math.max(S.map.getZoom(), LOCATE_ZOOM) })
        maybeShowFollowHint()
      }
    } catch (e) {
      ctx.showToast(e?.message || 'Could not get your location.', 'error')
    }
  }

  Object.assign(ctx, { CENTERED_TOLERANCE_PX, LOCATE_ZOOM, centerOnLocation, followHandlers, geo, isMapCenteredOn, locateStatus, locateTitle, maybeShowFollowHint, moveCamera, onLocateTap, onUserPanStart, paintLocation })
  return { CENTERED_TOLERANCE_PX, LOCATE_ZOOM, centerOnLocation, followHandlers, geo, isMapCenteredOn, locateStatus, locateTitle, maybeShowFollowHint, moveCamera, onLocateTap, onUserPanStart, paintLocation }
}
