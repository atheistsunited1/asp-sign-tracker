// Shared coordinate parsing/formatting (one implementation per concept, ADR-0004 §5).

const PAIR_RE = /(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/

/** Clamp latitude to [-90, 90]; NaN passes through as NaN. */
export function clampLat(lat) {
  lat = Number(lat)
  if (!Number.isFinite(lat)) return NaN
  return Math.max(-90, Math.min(90, lat))
}

/** Wrap longitude into [-180, 180). In-range values pass through unchanged. */
export function normalizeLng(lng) {
  lng = Number(lng)
  if (lng >= -180 && lng < 180) return lng
  return ((lng + 180) % 360 + 360) % 360 - 180
}

function toLatLngPair(a, b) {
  // If the first number can only be a longitude, treat input as lng-first.
  const looksLngFirst = Math.abs(a) > 90 && Math.abs(a) <= 180 && Math.abs(b) <= 90
  if (looksLngFirst) [a, b] = [b, a]
  const lat = clampLat(a)
  const lng = normalizeLng(b)
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
}

/** Format a number to 6 decimal places. */
export function fmt6(n) {
  return Number(n).toFixed(6)
}

/** Format a lat/lng pair as "lat, lng" at 6 decimal places. */
export function formatCoords(lat, lng) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return ''
  return `${fmt6(lat)}, ${fmt6(lng)}`
}

/**
 * Parse a "lat, lng" (or "lat lng") pair. Accepts lng-first pairs when
 * unambiguous. Returns { lat, lng } (lat clamped, lng wrapped) or null.
 */
export function parseCoords(str = '') {
  const m = String(str).trim().match(PAIR_RE)
  if (!m) return null
  return toLatLngPair(parseFloat(m[1]), parseFloat(m[2]))
}

/**
 * Legacy-shape variant of parseCoords: returns { lat: NaN, lng: NaN } instead
 * of null so callers can destructure and Number.isFinite-check.
 */
export function parseLatLng(str = '') {
  return parseCoords(str) || { lat: NaN, lng: NaN }
}

/**
 * Like parseCoords, but also accepts Google-style "@lat,lng" paths and map
 * URLs (with or without scheme) carrying coordinates in common query params
 * ("ll", "q", "center", …) or explicit lat/lng keys. Returns { lat, lng } or null.
 */
export function parseCoordsFlexible(str = '') {
  const s = String(str).trim()

  const plain = parseCoords(s)
  if (plain) return plain

  const at = s.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/)
  if (at) {
    const pair = toLatLngPair(parseFloat(at[1]), parseFloat(at[2]))
    if (pair) return pair
  }

  try {
    const u = s.startsWith('http') ? new URL(s) : new URL('https://' + s)
    const qp = new URLSearchParams(u.search)

    for (const key of ['ll', 'sll', 'q', 'query', 'center', 'daddr', 'loc', 'latlng', 'coords', 'coord']) {
      const pair = parseCoords(qp.get(key) || '')
      if (pair) return pair
    }

    const lat = qp.get('lat')
    const lng = qp.get('lng') || qp.get('lon') || qp.get('long')
    if (lat != null && lng != null) {
      const pair = toLatLngPair(parseFloat(lat), parseFloat(lng))
      if (pair) return pair
    }
  } catch { /* not a URL */ }

  return null
}

/** Distance between two lat/lng pairs (Haversine, meters). */
export function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = deg => (deg * Math.PI) / 180
  const R = 6371000 // Earth radius in meters

  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}
