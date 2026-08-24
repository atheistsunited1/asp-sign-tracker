// Geolocation state machine for the map's Locate control (#68).
//
// Modeled on the Google Maps / Mapbox GeolocateControl behavior:
//   idle ──tap──▶ locating ──fix──▶ located ──tap──▶ following
//   following ──user pans──▶ passive (dot keeps updating, no recenter)
//   passive ──tap──▶ following          following/passive ──tap──▶ located (stop watch, keep dot)
//   any ──permission denied──▶ denied   any ──no provider──▶ unavailable
//
// Fix strategy: a fast, cached/low-accuracy fix first (so something appears
// immediately) and then a high-accuracy refinement. The browser Geolocation
// API is injectable so the machine is unit-testable without a browser.
import { ref, computed } from 'vue'

export const GEO_STATUS = Object.freeze({
  IDLE: 'idle',
  LOCATING: 'locating',
  LOCATED: 'located',
  FOLLOWING: 'following',
  PASSIVE: 'passive',
  DENIED: 'denied',
  UNAVAILABLE: 'unavailable',
  ERROR: 'error',
})

export const FAST_FIX_OPTIONS = Object.freeze({ enableHighAccuracy: false, maximumAge: 60_000, timeout: 6_000 })
export const PRECISE_FIX_OPTIONS = Object.freeze({ enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 })
export const WATCH_OPTIONS = Object.freeze({ enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 })

// GeolocationPositionError codes (the constructor isn't available in every env).
const PERMISSION_DENIED = 1
const POSITION_UNAVAILABLE = 2
const TIMEOUT = 3

/** Map a GeolocationPositionError (or anything thrown) to a status + user-facing message. */
export function describeGeolocationError(err) {
  const code = Number(err?.code)
  if (code === PERMISSION_DENIED) {
    return {
      status: GEO_STATUS.DENIED,
      message: 'Location access is blocked for this site. Allow location in your browser or phone settings, then tap Locate again.',
    }
  }
  if (code === POSITION_UNAVAILABLE) {
    return { status: GEO_STATUS.ERROR, message: 'Your location is not available right now (no GPS or network fix). Try again in a moment.' }
  }
  if (code === TIMEOUT) {
    return { status: GEO_STATUS.ERROR, message: 'Finding your location is taking too long. Try again, ideally with a clear view of the sky.' }
  }
  return { status: GEO_STATUS.ERROR, message: 'Could not get your location. Please try again.' }
}

function toPosition(pos) {
  const c = pos?.coords || {}
  return {
    lat: Number(c.latitude),
    lng: Number(c.longitude),
    accuracy: Number.isFinite(Number(c.accuracy)) ? Number(c.accuracy) : null,
    timestamp: Number(pos?.timestamp) || Date.now(),
  }
}

function requestPosition(provider, options) {
  return new Promise((resolve, reject) => {
    try { provider.getCurrentPosition(resolve, reject, options) } catch (e) { reject(e) }
  })
}

export function useGeolocation({
  provider = (typeof navigator !== 'undefined' ? navigator.geolocation : null),
  fastOptions = FAST_FIX_OPTIONS,
  preciseOptions = PRECISE_FIX_OPTIONS,
  watchOptions = WATCH_OPTIONS,
} = {}) {
  const supported = !!provider
  const status = ref(supported ? GEO_STATUS.IDLE : GEO_STATUS.UNAVAILABLE)
  const position = ref(null)     // { lat, lng, accuracy, timestamp } | null
  const error = ref(null)        // { status, message } | null
  let watchId = null
  let fixSeq = 0

  const hasFix = computed(() => !!position.value)
  const isFollowing = computed(() => status.value === GEO_STATUS.FOLLOWING)
  const isWatching = computed(() => watchId != null)

  function fail(err) {
    const described = describeGeolocationError(err)
    error.value = described
    if (described.status === GEO_STATUS.DENIED) {
      // Location is disabled: there is no trustworthy position any more.
      position.value = null
      status.value = GEO_STATUS.DENIED
      return described
    }
    // Transient failure: keep any previously good position and just report it.
    status.value = position.value ? GEO_STATUS.LOCATED : GEO_STATUS.ERROR
    return described
  }

  function accept(pos) {
    const p = toPosition(pos)
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null
    position.value = p
    error.value = null
    return p
  }

  /**
   * Get a fix: resolves with the first usable position (fast/cached) and keeps
   * refining in the background; `onUpdate` fires for every accepted position.
   * Rejects with { status, message } when no fix could be obtained.
   */
  async function getFix({ onUpdate } = {}) {
    if (!supported) {
      error.value = { status: GEO_STATUS.UNAVAILABLE, message: 'Geolocation is not supported in this browser.' }
      status.value = GEO_STATUS.UNAVAILABLE
      throw error.value
    }
    const seq = ++fixSeq
    if (status.value !== GEO_STATUS.FOLLOWING && status.value !== GEO_STATUS.PASSIVE) {
      status.value = GEO_STATUS.LOCATING
    }

    let first = null
    try {
      first = accept(await requestPosition(provider, fastOptions))
    } catch (e) {
      if (Number(e?.code) === PERMISSION_DENIED) throw fail(e)
      // fall through to the precise attempt
    }
    if (seq !== fixSeq) return first   // superseded by a newer call

    if (first) {
      if (status.value === GEO_STATUS.LOCATING) status.value = GEO_STATUS.LOCATED
      onUpdate?.(first)
      // refine in the background; ignore failures (we already have a fix)
      requestPosition(provider, preciseOptions)
        .then((pos) => {
          if (seq !== fixSeq) return
          const p = accept(pos)
          if (p) onUpdate?.(p)
        })
        .catch(() => {})
      return first
    }

    try {
      const p = accept(await requestPosition(provider, preciseOptions))
      if (seq !== fixSeq) return p
      if (!p) throw new Error('empty position')
      if (status.value === GEO_STATUS.LOCATING) status.value = GEO_STATUS.LOCATED
      onUpdate?.(p)
      return p
    } catch (e) {
      if (seq !== fixSeq) return null
      throw fail(e)
    }
  }

  /** Continuous updates; `onUpdate` fires per position. Status → following. */
  function startFollow({ onUpdate, onError } = {}) {
    if (!supported) return false
    if (watchId == null) {
      try {
        watchId = provider.watchPosition(
          (pos) => {
            const p = accept(pos)
            if (p) onUpdate?.(p)
          },
          (err) => {
            // Only a permission denial ends a watch. Transient errors (no fix,
            // timeout — tunnels, indoors, a GPS hiccup) keep following/passive
            // alive; the next good position simply resumes. Chromium also emits
            // one of these when the position source changes mid-watch.
            const described = describeGeolocationError(err)
            if (described.status === GEO_STATUS.DENIED) {
              fail(err)
              stopFollow()
              onError?.(described, { transient: false })
              return
            }
            error.value = described
            onError?.(described, { transient: true })
          },
          watchOptions,
        )
      } catch (e) {
        fail(e)
        return false
      }
    }
    status.value = GEO_STATUS.FOLLOWING
    return true
  }

  /** Keep updating the dot but stop recentering (user panned away). */
  function setPassive() {
    if (watchId != null) status.value = GEO_STATUS.PASSIVE
  }

  /** Stop the watch; keep the last position (dot stays). */
  function stopFollow() {
    if (watchId != null) {
      try { provider.clearWatch(watchId) } catch {}
      watchId = null
    }
    if (status.value === GEO_STATUS.FOLLOWING || status.value === GEO_STATUS.PASSIVE) {
      status.value = position.value ? GEO_STATUS.LOCATED : GEO_STATUS.IDLE
    }
  }

  function reset() {
    stopFollow()
    fixSeq += 1
    position.value = null
    error.value = null
    status.value = supported ? GEO_STATUS.IDLE : GEO_STATUS.UNAVAILABLE
  }

  return {
    supported, status, position, error,
    hasFix, isFollowing, isWatching,
    getFix, startFollow, setPassive, stopFollow, reset,
  }
}
