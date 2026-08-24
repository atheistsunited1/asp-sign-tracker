// Tap disambiguation for visually overlapping pins.
// Extracted verbatim from MapPage.vue. Shared map state is on
// `ctx` (see mapContext.js): other composables' members are referenced as
// `ctx.<name>`; mutable shared lets live on `ctx.state`.
import { ref } from 'vue'
import { logger } from '@/shared/lib/logger'
import {
  TAP_DISAMBIGUATION_MIN_ZOOM,
  findGeographicallyClosePins,
  isAmbiguousTap,
} from '@/pages/map/tapAmbiguity'
import NearbyPinSelector from '@/shared/domain/NearbyPinSelector.vue'
import { fetchNearbyPinsEnrichment } from '@/shared/domain/nearbyPinsService'

export function useTapChooser(ctx) {
  const S = ctx.state

  // --- Tap disambiguation ---
  // Tunables and the pure gate live in tapAmbiguity.js. Ambiguity is a fixed
  // geographic radius (20 m) around the tapped location — never zoom-dependent,
  // and the map is never zoomed on the user's behalf. Below zoom 16 an
  // ambiguous tap gets a "zoom in closer" toast; at 16+ it opens the pick-only
  // NearbyPinSelector.
  const tapChooser = ref({ visible: false, pins: [], coords: '' })

  let bypassTapAmbiguity = false

  // True tap location in container px. Prefer the DOM event (robust for small
  // canvas markers); fall back to Leaflet's containerPoint, then the latlng.
  function tapContainerPoint(ev) {
    const oe = ev?.originalEvent
    if (oe && Number.isFinite(oe.clientX)) {
      try { return S.map.mouseEventToContainerPoint(oe) } catch {}
    }
    if (ev?.containerPoint) return ev.containerPoint
    return ev?.latlng ? S.map.latLngToContainerPoint(ev.latlng) : null
  }

  // Pins within the geographic ambiguity radius of the tap, nearest first.
  function findVisuallyClosePins(tapLL) {
    const entries = []
    for (const pinId of ctx.visibleMarkerIds) {
      const marker = ctx.pinMarkerMap.get(pinId)
      if (!marker) continue
      entries.push({ id: pinId, lat: marker.__lat, lng: marker.__lng })
    }
    return findGeographicallyClosePins(tapLL, entries)
      .map(e => ctx.pinById.get(e.id))
      .filter(Boolean)
  }

  // Returns true when the tap was intercepted (toast shown or chooser opened).
  function handleAmbiguousTap(ev) {
    if (bypassTapAmbiguity) return false
    try {
      if (!S.map) return false
      const pt = tapContainerPoint(ev)
      const tapLL = ev?.latlng || (pt ? S.map.containerPointToLatLng(pt) : null)
      if (!tapLL) return false
      const closePins = findVisuallyClosePins(tapLL)
      if (!isAmbiguousTap(closePins)) return false

      if (S.map.getZoom() < TAP_DISAMBIGUATION_MIN_ZOOM) {
        ctx.showToast('Multiple pins here — zoom in closer to open a pin.', 'info')
        return true
      }
      tapChooser.value = {
        visible: true,
        pins: closePins,
        coords: `${tapLL.lat.toFixed(6)}, ${tapLL.lng.toFixed(6)}`,
      }
      enrichTapChooserPins(closePins)
      return true
    } catch (e) {
      logger.warn('tap disambiguation check failed; falling through to default click', e)
      return false
    }
  }

  function closeTapChooser() {
    tapChooser.value = { visible: false, pins: [], coords: '' }
  }

  // The chooser opens instantly with in-memory pins (sorted by the pin's own
  // created_at); the latest-activity date/type and photos are patched in when
  // the enrichment fetch returns, matching what the report-flow selector shows.
  let tapChooserEnrichSeq = 0

  async function enrichTapChooserPins(pins) {
    const ids = (pins || []).map(p => p?.id).filter(Boolean)
    if (!ids.length) return
    const seq = ++tapChooserEnrichSeq
    try {
      const { latestReportByPin, photosByPin } = await fetchNearbyPinsEnrichment(ids, {
        reportLimitPerPin: 5, photoLimitPerPin: 3,
      })
      if (seq !== tapChooserEnrichSeq || !tapChooser.value.visible) return
      tapChooser.value = {
        ...tapChooser.value,
        pins: tapChooser.value.pins.map(p => {
          const latest = latestReportByPin.get(p.id) || {}
          return {
            ...p,
            photos: photosByPin.get(p.id) || p.photos || [],
            last_activity_at: latest.occurred_on || latest.created_at || p.created_at || null,
            last_activity_type: latest.report_type || null,
          }
        }),
      }
    } catch (e) {
      logger.warn('tap chooser enrichment failed; showing pins without activity dates', e)
    }
  }

  function onTapChooserSelect(pin) {
    closeTapChooser()
    const marker = ctx.pinMarkerMap.get(pin.id)
    if (!marker) return
    // Re-fire the marker's own click path (URL, popup, centering) with the
    // ambiguity check bypassed — the user has already disambiguated.
    bypassTapAmbiguity = true
    try {
      marker.fire('click', { latlng: marker.getLatLng() })
    } finally {
      bypassTapAmbiguity = false
    }
  }

  Object.assign(ctx, { closeTapChooser, enrichTapChooserPins, findVisuallyClosePins, handleAmbiguousTap, onTapChooserSelect, tapChooser, tapContainerPoint })
  return { closeTapChooser, enrichTapChooserPins, findVisuallyClosePins, handleAmbiguousTap, onTapChooserSelect, tapChooser, tapContainerPoint }
}
