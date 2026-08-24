// Leaflet default-marker configuration (shared/ui).
import L from 'leaflet'

let defaultIconConfigured = false

// Point Leaflet's default marker at the bundled images so Vite resolves them.
export function configureLeafletDefaultIcon() {
  if (defaultIconConfigured) return
  delete L.Icon.Default.prototype._getIconUrl
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: new URL('leaflet/dist/images/marker-icon-2x.png', import.meta.url).toString(),
    iconUrl: new URL('leaflet/dist/images/marker-icon.png', import.meta.url).toString(),
    shadowUrl: new URL('leaflet/dist/images/marker-shadow.png', import.meta.url).toString(),
  })
  defaultIconConfigured = true
}
