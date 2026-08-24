// Tap-ambiguity gate for map pin taps (issue #18).
//
// A tap is "ambiguous" when two or more pins sit within TAP_AMBIGUITY_RADIUS_M
// of the tapped location — geographic distance, not screen pixels, so the
// answer does not change with zoom. What changes with zoom is the response
// (see useTapChooser): below TAP_DISAMBIGUATION_MIN_ZOOM an ambiguous tap gets
// a "zoom in closer" toast; at or above it, the pick-only chooser opens.
import { getDistanceMeters } from '@/shared/lib/coords'

// Radius (meters) around the tapped location inside which pins count as
// overlapping. Matches the report flow's 20 m nearby-pin dedupe radius; at
// zoom 16 this is ≈ 8–10 px — inside one finger tap.
export const TAP_AMBIGUITY_RADIUS_M = 20

// Minimum zoom at which an ambiguous tap opens the chooser instead of the
// "zoom in closer" toast.
export const TAP_DISAMBIGUATION_MIN_ZOOM = 16

// tapLL: { lat, lng }.  pins: array of { lat, lng, ... }.
// Returns the pins within radiusM of the tap, nearest first. Entries with
// non-finite coordinates are ignored.
export function findGeographicallyClosePins(tapLL, pins, radiusM = TAP_AMBIGUITY_RADIUS_M) {
  const lat = Number(tapLL?.lat)
  const lng = Number(tapLL?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return []

  const close = []
  for (const p of (pins || [])) {
    const pLat = Number(p?.lat)
    const pLng = Number(p?.lng)
    if (!Number.isFinite(pLat) || !Number.isFinite(pLng)) continue
    const d = getDistanceMeters(lat, lng, pLat, pLng)
    if (Number.isFinite(d) && d <= radiusM) close.push({ p, d })
  }
  close.sort((a, b) => a.d - b.d)
  return close.map((c) => c.p)
}

// The gate: a tap is ambiguous only when 2+ pins are geographically close.
export function isAmbiguousTap(closePins) {
  return Array.isArray(closePins) && closePins.length >= 2
}
