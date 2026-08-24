// Share links: Google Maps and the app's own ?ll=&z= deep link.
import { clampLat, normalizeLng, fmt6 } from '@/shared/lib/coords'

// Public app base used to build share links. Override via VITE_APP_BASE_URL
// (see README / netlify.toml); defaults to the origin the app is served from.
export const APP_BASE_URL =
  import.meta.env.VITE_APP_BASE_URL ||
  (typeof window !== 'undefined' ? `${window.location.origin}/` : 'http://localhost:5173/')

export function googleMapsLink(lat, lng) {
  const q = `${fmt6(clampLat(lat))},${fmt6(normalizeLng(lng))}`
  return `https://maps.google.com/?q=${encodeURIComponent(q)}`
}

// App link like: https://.../?ll=31.970750,-78.447386&z=19
export function appCoordLink(lat, lng, z = 19) {
  const q = `${fmt6(clampLat(lat))},${fmt6(normalizeLng(lng))}`
  const u = new URL(APP_BASE_URL)
  u.searchParams.set('ll', q)   // keep the comma; the browser encodes it
  u.searchParams.set('z', String(z))
  return u.toString()
}
