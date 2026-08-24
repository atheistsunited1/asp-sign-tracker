// Pin helpers shared by the map and the submission flows: sign-type labels,
// the nearby-pin lookup (+ lifecycle/photo enrichment) and last-activity ordering.
import { fetchNearbyPinsEnrichment } from '@/shared/domain/nearbyPinsService'
import { getDistanceMeters } from '@/shared/lib/coords'
import { finalFromIconType } from '@/shared/domain/activityLifecycle'
import { logger } from '@/shared/lib/logger'

// Re-export: the Haversine helper lives in shared/lib/coords (pure); older callers import it from here.
export { getDistanceMeters }

export function formatSignTypeLabel(signType, fallback = '') {
  const raw = typeof signType === 'string' ? signType.trim() : ''
  if (!raw) return fallback

  const normalized = raw.toLowerCase()
  const labels = {
    sign: 'Sign',
    billboard: 'Billboard',
    sticker: 'Sticker',
    banner: 'Banner',
    graffiti: 'Graffiti',
    stationary: 'Pamphlet',
    literature: 'Literature',
    cross: 'Cross',
    other: 'Other',
  }

  if (labels[normalized]) return labels[normalized]
  return raw.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/**
 * Given a target lat/lng and list of pins, return those within a radius (in meters).
 */
export async function findNearbyPins(lat, lng, pins = [], radius = 20) {
  const targetLat = Number(lat)
  const targetLng = Number(lng)
  if (!Number.isFinite(targetLat) || !Number.isFinite(targetLng)) return []

  const nearby = (Array.isArray(pins) ? pins : [])
    .map(pin => {
      const pinLat = Number(pin?.lat)
      const pinLng = Number(pin?.lng)
      if (!Number.isFinite(pinLat) || !Number.isFinite(pinLng)) return null
      const dist = getDistanceMeters(targetLat, targetLng, pinLat, pinLng)
      if (!Number.isFinite(dist) || dist > radius) return null
      return { ...pin, lat: pinLat, lng: pinLng, __distanceMeters: dist }
    })
    .filter(Boolean)

  if (!nearby.length) return []

  const nearbyPinIds = nearby.map(pin => pin?.id).filter(Boolean)
  let latestReportByPin = new Map()
  let photosByPin = new Map()

  if (nearbyPinIds.length) {
    try {
      const enrichment = await fetchNearbyPinsEnrichment(nearbyPinIds, {
        reportLimitPerPin: 5,
        photoLimitPerPin: 3,
      })
      latestReportByPin = enrichment.latestReportByPin || new Map()
      photosByPin = enrichment.photosByPin || new Map()
    } catch (e) {
      logger.warn('findNearbyPins enrichment fetch error (batched)', e)
    }
  }

  const enriched = nearby.map(pin => {
    const latest = latestReportByPin.get(pin.id) || {}
    const photos = photosByPin.get(pin.id) || []
    return {
      ...pin,
      name: pin.name || 'Unnamed Pin',
      report_type: latest.report_type || 'unknown',
      sign_text: pin.sign_text || '',
      sign_type: pin.sign_type || '',
      photos,
      // Last activity = latest non-deleted report; falls back to the pin itself.
      last_activity_at: latest.occurred_on || latest.created_at || pin.created_at || null,
      last_activity_type: latest.report_type || null,
      // 'plundered' | 'krakened' when the pin's lifecycle is closed, else null.
      // From the pin's synced icon_type — the latest report can be an audit row.
      lifecycle_state: finalFromIconType(pin.icon_type) || null,
    }
  })
  return sortPinsByLastActivity(enriched)
}

/**
 * Timestamp (ms) of a pin's last activity for ordering: `last_activity_at`
 * when an enrichment step provided it, else the pin's own `created_at`.
 * Returns -Infinity when nothing parseable is present so such pins sort last.
 */
export function lastActivityMs(pin) {
  const raw = pin?.last_activity_at || pin?.created_at || null
  if (!raw) return -Infinity
  const t = new Date(raw).getTime()
  return Number.isFinite(t) ? t : -Infinity
}

/**
 * Newest-first by last activity. Ties (and pins with no date) fall back
 * to distance when `__distanceMeters` is present, keeping the previous order
 * stable. Pure; returns a new array.
 */
export function sortPinsByLastActivity(pins = []) {
  return (Array.isArray(pins) ? [...pins] : []).sort((a, b) => {
    const d = lastActivityMs(b) - lastActivityMs(a)
    if (d !== 0 && Number.isFinite(d)) return d
    if (!Number.isFinite(d)) {
      // one side has no date: dated pins first
      const aHas = Number.isFinite(lastActivityMs(a)), bHas = Number.isFinite(lastActivityMs(b))
      if (aHas !== bHas) return aHas ? -1 : 1
    }
    return (a?.__distanceMeters ?? Infinity) - (b?.__distanceMeters ?? Infinity)
  })
}
