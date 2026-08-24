// Leaflet "you are here" graphics: solid dot, accuracy ring, pulsing halo.
// Owns its three layers so the map component only calls update()/clear().
// Panes are created here (idempotently) so the dot always sits above pins and
// never intercepts pointer events.
import L from 'leaflet'

export const LOCATION_PANES = Object.freeze({
  dot: 'mylocPane',
  pulse: 'mylocPulsePane',
})

const DOT_BASE_RADIUS = 11
const MAX_ACCURACY_RING_METERS = 250   // worse than this: ring is noise, don't draw it

function ensurePane(map, name, zIndex) {
  let pane = map.getPane(name)
  if (!pane) {
    pane = map.createPane(name)
    pane.style.zIndex = String(zIndex)
    pane.style.pointerEvents = 'none'
  }
  return pane
}

/**
 * @param {L.Map} map
 * @returns {{ update(lat:number,lng:number,accuracy?:number):void, clear():void, getLatLng():L.LatLng|null, dot:L.CircleMarker|null }}
 */
export function createLocationLayer(map) {
  ensurePane(map, LOCATION_PANES.dot, 800)
  ensurePane(map, LOCATION_PANES.pulse, 799)
  const renderer = L.canvas({ pane: LOCATION_PANES.dot })

  let dot = null
  let ring = null
  let pulse = null

  function update(lat, lng, accuracy = null) {
    const pos = [lat, lng]

    if (!dot) {
      dot = L.circleMarker(pos, {
        renderer,
        pane: LOCATION_PANES.dot,
        radius: 13,
        color: '#dcebf5ff',
        weight: 2,
        fillColor: '#2171FF',
        fillOpacity: 0.95,
        interactive: false,
      }).addTo(map)
      dot.__baseRadius = DOT_BASE_RADIUS   // read by the map's zoom-based radius scaling
    } else {
      dot.setLatLng(pos)
    }

    const acc = Number(accuracy)
    const ringOk = Number.isFinite(acc) && acc > 0 && acc <= MAX_ACCURACY_RING_METERS
    if (ringOk) {
      if (!ring) {
        ring = L.circle(pos, {
          renderer,
          pane: LOCATION_PANES.dot,
          radius: acc,
          color: '#0b5ed7',
          weight: 1,
          fillColor: '#3b82f6',
          fillOpacity: 0.15,
          interactive: false,
        }).addTo(map)
      } else {
        ring.setLatLng(pos).setRadius(acc)
      }
    } else if (ring) {
      if (map.hasLayer(ring)) map.removeLayer(ring)
      ring = null
    }

    if (!pulse) {
      pulse = L.marker(pos, {
        pane: LOCATION_PANES.pulse,
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'myloc-pulse',
          iconSize: [24, 24],
          iconAnchor: [12, 12],
          html: '<div class="pulse-ring"></div>',
        }),
      }).addTo(map)
    } else {
      pulse.setLatLng(pos)
    }

    try { dot.bringToFront(); ring?.bringToFront() } catch {}
  }

  function clear() {
    for (const layer of [dot, ring, pulse]) {
      if (layer && map.hasLayer(layer)) map.removeLayer(layer)
    }
    dot = null; ring = null; pulse = null
  }

  /** Grey the dot while no fresh fix is arriving (transient GPS loss); blue again on the next fix. */
  function setStale(stale) {
    if (dot) dot.setStyle({ fillColor: stale ? '#9ca3af' : '#2171FF', color: stale ? '#e5e7eb' : '#dcebf5ff' })
    if (ring) ring.setStyle({ color: stale ? '#9ca3af' : '#0b5ed7', fillColor: stale ? '#9ca3af' : '#3b82f6' })
    const el = pulse?.getElement?.()
    if (el) el.classList.toggle('is-stale', !!stale)
  }

  return {
    update,
    clear,
    setStale,
    getLatLng: () => (dot ? dot.getLatLng() : null),
    get dot() { return dot },
  }
}
