// Drag-to-relocate a pin from its popup and save the new position (relocate activity).
// Extracted verbatim from MapPage.vue. Shared map state is on
// `ctx` (see mapContext.js): other composables' members are referenced as
// `ctx.<name>`; mutable shared lets live on `ctx.state`.
import L from 'leaflet'
import TempPinPopupContent from '@/pages/map/components/TempPinPopupContent.vue'
import { errorToUserMessage } from '@/shared/lib/errors'
import { logger } from '@/shared/lib/logger'
import {
  deleteBookmarkForUser,
  fetchBookmarksForUser,
  fetchPinById,
  fetchPinsPage,
  fetchPhotoRowsForReportIds,
  fetchReportIdsForPin,
  fetchReportedPinIdsByUser,
  fetchReportsForPin as fetchReportsForPinSvc,
  insertReports,
  upsertBookmarkForUser,
  updatePinById,
  warmSupabaseConnection,
} from '@/pages/map/mapService'

export function usePinDrag(ctx) {
  const S = ctx.state

  function togglePinDrag(pinId) {
    if (!ctx.isMapmasterOrHigher.value) {
      ctx.showToast('Mapmaster or admin only.', 'error')
      return
    }
    const baseMarker = ctx.pinMarkerMap.get(pinId)
    if (!baseMarker) return

    const pin = ctx.pinById.get(pinId)
    if (!pin) return

    const existing = ctx.draggedPins.get(pinId)
    if (existing?.ghost) {
      const changed =
        Number.isFinite(existing.newLat) &&
        Number.isFinite(existing.newLng) &&
        (Math.abs(existing.newLat - existing.oldLat) > 1e-10 ||
         Math.abs(existing.newLng - existing.oldLng) > 1e-10)

      // Cancel path: restore in-memory coordinates if the drag was never saved.
      if (changed) {
        const restored = L.latLng(existing.oldLat, existing.oldLng)
        baseMarker.setLatLng(restored)
        baseMarker.__lat = existing.oldLat
        baseMarker.__lng = existing.oldLng
        pin.lat = existing.oldLat
        pin.lng = existing.oldLng
        pin.__coordText6 = `${existing.oldLat.toFixed(6)}, ${existing.oldLng.toFixed(6)}`
        pin.__latE6 = Math.round(existing.oldLat * 1e6)
        pin.__lngE6 = Math.round(existing.oldLng * 1e6)
        ctx.indexMarkerByCell(pinId, existing.oldLat, existing.oldLng)
        ctx.markFilterPassDirty()
        ctx.updatePinPopup(pinId)
      }

      // turn off dragging
      S.map.removeLayer(existing.ghost)
      ctx.draggedPins.delete(pinId)
      ctx.showToast(changed ? 'Drag canceled (not saved).' : 'Drag disabled.', 'info')
      return
    }

    // Create a draggable ghost marker at the same position. The default icon's
    // 25×41 px box is a hopeless touch target — a finger missing it by a few px
    // grabs the map and pans instead. Wrap the default marker image in a
    // transparent padded hit box so the grab area is finger-sized; the visual
    // stays the stock blue marker, tip anchored on the latlng.
    const GHOST_HIT_PAD = 32
    const defIcon = L.Icon.Default.prototype.options
    const ghostIcon = L.divIcon({
      className: 'ghost-drag-hit',
      iconSize: [25 + GHOST_HIT_PAD * 2, 41 + GHOST_HIT_PAD * 2],
      iconAnchor: [12 + GHOST_HIT_PAD, 41 + GHOST_HIT_PAD],
      html: `<img src="${defIcon.iconUrl}" srcset="${defIcon.iconRetinaUrl} 2x" alt="" draggable="false" ` +
            `style="position:absolute;left:${GHOST_HIT_PAD}px;top:${GHOST_HIT_PAD}px;width:25px;height:41px;">`,
    })
    const ghost = L.marker([pin.lat, pin.lng], { draggable: true, icon: ghostIcon })
    ghost.addTo(S.map)

    const rec = {
      ghost,
      oldLat: pin.lat, oldLng: pin.lng,
      newLat: pin.lat, newLng: pin.lng,
    }
    ctx.draggedPins.set(pinId, rec)
    ctx.showToast('Drag enabled. Move the marker, then click Save Location.', 'info')

    // The open popup's tip sits in the popup pane (above the marker pane),
    // exactly over the ghost's grab area — pointer-downs hit the tip instead of
    // the ghost and the drag never starts. Close it; dragend brings
    // the Save Location popup, and Cancel lives there too.
    S.map.closePopup()

    ghost.on('dragend', () => {
      const pos = ghost.getLatLng()
      rec.newLat = pos.lat
      rec.newLng = pos.lng

      // update the circle marker + caches immediately for visual fidelity
      baseMarker.setLatLng(pos)
      baseMarker.__lat = pos.lat
      baseMarker.__lng = pos.lng
      pin.lat = pos.lat
      pin.lng = pos.lng
      pin.__coordText6 = `${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}`
      pin.__latE6 = Math.round(pos.lat * 1e6)
      pin.__lngE6 = Math.round(pos.lng * 1e6)
      ctx.indexMarkerByCell(pinId, pos.lat, pos.lng)
      ctx.markFilterPassDirty()

      const movedCoordStr = `${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}`
      const popupHost = ctx.mountPopupContent(baseMarker, TempPinPopupContent, {
        mode: 'moved',
        coordStr: movedCoordStr,
        onSaveLocation: () => saveDraggedPin(pinId),
        onCancelDrag: () => togglePinDrag(pinId),
      })
      baseMarker.setPopupContent(popupHost).openPopup()
    })
  }

  async function saveDraggedPin (pinId) {
    if (!ctx.isMapmasterOrHigher.value) {
      ctx.showToast('Mapmaster or admin only.', 'error')
      return
    }
    const rec = ctx.draggedPins.get(pinId)
    const pin = ctx.pinById.get(pinId)
    const marker = ctx.pinMarkerMap.get(pinId)
    if (!rec || !pin || !marker) return

    const { error: updateError } = await updatePinById(pinId, {
      lat: rec.newLat,
      lng: rec.newLng,
      updated_at: new Date().toISOString(),
    })

    if (updateError) {
      logger.error('Map saveDraggedPin coordinate update failed', updateError)
      ctx.showToast(errorToUserMessage(updateError, 'Failed to update coordinates.'), 'error')
      return
    }

    const { error: reportError } = await insertReports([{
      pin_id: pinId,
      report_type: 'relocated',
      is_approved: true,      // admin/system action → approved
    }])

    if (reportError) {
      logger.error('Map saveDraggedPin relocation report insert failed', reportError)
      ctx.showToast(errorToUserMessage(reportError, 'Failed to log relocation activity.'), 'error')
      return
    }

    // refresh local caches & precomputed coord text for search
    pin.lat = rec.newLat
    pin.lng = rec.newLng
    pin.__coordText6 = `${rec.newLat.toFixed(6)}, ${rec.newLng.toFixed(6)}`
    pin.__latE6 = Math.round(rec.newLat * 1e6)
    pin.__lngE6 = Math.round(rec.newLng * 1e6)


    // clean up ghost marker and record
    if (rec.ghost && S.map.hasLayer(rec.ghost)) S.map.removeLayer(rec.ghost)

    

    ctx.draggedPins.delete(pinId)

    ctx.showToast('Location saved and activity logged.', 'success')
    // popup refresh (and color may change if you use updated_at elsewhere)
    ctx.updatePinPopup(pinId)
  }
    

  Object.assign(ctx, { saveDraggedPin, togglePinDrag })
  return { saveDraggedPin, togglePinDrag }
}
