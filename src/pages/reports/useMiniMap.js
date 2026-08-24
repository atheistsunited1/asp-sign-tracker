// The Reports page mini-map: a draggable marker for the selected activity's pin,
// streets/satellite toggle, and coordinate editing hooks.
import { ref } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { configureLeafletDefaultIcon } from '@/shared/ui/leaflet'
import { parseCoords } from '@/shared/lib/coords'

export function gmapsLink(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '#'
  const q = `${(+lat).toFixed(6)},${(+lng).toFixed(6)}`
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
}

function pinPopupHtml(lat, lng) {
  return `
    <div class="pin-popup">
      <div class="pp-coord">${(+lat).toFixed(6)}, ${(+lng).toFixed(6)}</div>
      <button class="use-coord-btn">Use this coordinate</button>
    </div>
  `
}

/**
 * @param {{ editing: object, selected: import('vue').Ref, updateCoordLocale: Function }} deps
 */
export function useMiniMap({ editing, selected, updateCoordLocale }) {
  configureLeafletDefaultIcon()
  const mapEl = ref(null)
  let map, marker, streetsLayer, satelliteLayer, baseToggleEl

  function initMap() {
    if (map || !mapEl.value) return
    map = L.map(mapEl.value, { center: [0, 0], zoom: 2 })
    streetsLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors' })
    // USGS "Imagery Only": public domain, no key; cache ends at zoom 16 (upsampled beyond).
    satelliteLayer = L.tileLayer(
      'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
      { maxNativeZoom: 16, maxZoom: 20, attribution: 'Imagery: USDA, USGS The National Map: Orthoimagery' },
    )
    streetsLayer.addTo(map)

    marker = L.marker([0, 0], { draggable: true }).addTo(map)
    marker.on('dragend', () => {
      const { lat, lng } = marker.getLatLng()
      marker.bindPopup(pinPopupHtml(lat, lng)).openPopup()
    })
    map.on('popupopen', (e) => {
      const btn = e.popup.getElement()?.querySelector('.use-coord-btn')
      if (btn) {
        btn.addEventListener('click', () => {
          const ll = marker.getLatLng()
          useMarkerCoord(ll.lat, ll.lng)
          map.closePopup()
        }, { once: true })
      }
    })

    const BasemapToggle = L.Control.extend({
      options: { position: 'topright' },
      onAdd() {
        const div = L.DomUtil.create('div', 'basemap-toggle')
        div.innerHTML = `
        <button class="bm-btn active" data-layer="streets">🗺 Streets</button>
        <button class="bm-btn" data-layer="sat">🛰 Satellite</button>
      `
        L.DomEvent.disableClickPropagation(div)
        baseToggleEl = div
        div.addEventListener('click', (ev) => {
          const b = ev.target.closest('.bm-btn')
          if (!b) return
          if (b.dataset.layer === 'streets') {
            if (map.hasLayer(satelliteLayer)) map.removeLayer(satelliteLayer)
            if (!map.hasLayer(streetsLayer)) map.addLayer(streetsLayer)
          } else {
            if (map.hasLayer(streetsLayer)) map.removeLayer(streetsLayer)
            if (!map.hasLayer(satelliteLayer)) map.addLayer(satelliteLayer)
          }
          baseToggleEl.querySelectorAll('.bm-btn').forEach((x) => x.classList.remove('active'))
          b.classList.add('active')
        })
        return div
      },
    })
    map.addControl(new BasemapToggle())
    setTimeout(() => map.invalidateSize(), 0)
  }

  function panTo(lat, lng) {
    if (!map) return
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      map.panTo([lat, lng])
      marker?.setLatLng([lat, lng])
    }
  }
  /** Center on a pin and place the marker there (popup closed). */
  function showPin(lat, lng, { draggable = true } = {}) {
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      panTo(lat, lng)
      marker?.setLatLng([lat, lng]).closePopup()
    }
    try { draggable ? marker?.dragging?.enable() : marker?.dragging?.disable() } catch {}
  }

  function useMarkerCoord(lat, lng) {
    if (!selected.value) return
    editing.lat = +lat
    editing.lng = +lng
    updateCoordLocale(editing.lat, editing.lng)
  }
  function resetCoords() {
    const row = selected.value
    if (!row) return
    if (Number.isFinite(row.__origLat) && Number.isFinite(row.__origLng)) {
      editing.lat = row.__origLat
      editing.lng = row.__origLng
      updateCoordLocale(editing.lat, editing.lng)
      panTo(editing.lat, editing.lng)
      marker?.setLatLng([editing.lat, editing.lng])
      marker?.closePopup()
    }
  }
  function onCoordInput(val) {
    const parsed = parseCoords(val)
    if (parsed) {
      editing.lat = parsed.lat
      editing.lng = parsed.lng
      updateCoordLocale(editing.lat, editing.lng)
      editing.__coordError = null
    } else {
      editing.__coordError = val.trim() ? 'Use “lat, lng” (two numbers).' : null
    }
  }

  return { mapEl, initMap, panTo, showPin, useMarkerCoord, resetCoords, onCoordInput, gmapsLink }
}
