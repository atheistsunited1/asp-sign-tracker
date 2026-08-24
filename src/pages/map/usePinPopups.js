// Marker popups (Vue apps mounted into Leaflet popups), popup updates, pin history modal.
// Extracted verbatim from MapPage.vue (issue #97 step 2). Shared map state is on
// `ctx` (see mapContext.js): other composables' members are referenced as
// `ctx.<name>`; mutable shared lets live on `ctx.state`.
import { ref, createApp } from 'vue'
import { scope, expectEvent } from '@/shared/lib/debug'
import L from 'leaflet'
import PinPopupContent from '@/pages/map/components/PinPopupContent.vue'
import TempPinPopupContent from '@/pages/map/components/TempPinPopupContent.vue'
import { logger } from '@/shared/lib/logger'
import { formatSignTypeLabel } from '@/shared/domain/pinUtils'
import {
  colorOptionRowsForPin,
  defaultColorForPin,
  DRAW_PRIORITY_LEVELS,
  drawPriorityForPin,
  normalizeIconColorForPin,
  normalizeSignType,
} from '@/shared/domain/pinVisuals'

export function usePinPopups(ctx) {
  const S = ctx.state

  // Map pinId -> resolver returned by expectEvent()
  const popupExpect = new Map()

  const markerPopupApps = new Map()

  function unmountPopupApp(marker) {
    const app = markerPopupApps.get(marker)
    if (!app) return
    try { app.unmount() } catch {}
    markerPopupApps.delete(marker)
  }

  function mountPopupContent(marker, component, props) {
    unmountPopupApp(marker)
    const host = document.createElement('div')
    const app = createApp(component, props)
    app.mount(host)
    markerPopupApps.set(marker, app)
    return host
  }

  function resolvePopupExpect(pin) {
    const keys = [pin.id, `usr:${pin.id}`, `usp:${pin.id}`, `pin:${pin.id}`]
    for (const k of keys) {
      const fn = popupExpect.get(k)
      if (fn) { fn(); popupExpect.delete(k); return true }
    }
    return false
  }

  function popupColorOptionsForPin(pin) {
    return colorOptionRowsForPin({
      iconType: pin?.icon_type,
      isMajorCampaign: ctx.isMajorCampaign(pin),
      signType: pin?.sign_type,
    })
  }

  const historyModal = ref({ visible: false, pinId: null })

  function openPinHistory(source) {
    historyModal.value = { visible: true, source }
  }

  // Keyboard nav when modal is open
  S.openPopups = 0

  function bindMarkerPopup(marker, pin, reports = []) {
    const pending = !ctx.isApprovedPin(pin)

    // Treat "pending" like a final lifecycle (no plunder/kraken actions)
    const isFinalLifecycle =
      pending ||
      pin.icon_type === ctx.ICON_TYPES.PLUNDERED ||
      pin.icon_type === ctx.ICON_TYPES.KRAKENED;

    const latNum = Number(pin.lat)
    const lngNum = Number(pin.lng)
    const hasCoords = Number.isFinite(latNum) && Number.isFinite(lngNum)
    const fallbackLL = marker?.getLatLng?.()
    const coordStr = hasCoords
      ? `${latNum.toFixed(6)}, ${lngNum.toFixed(6)}`
      : (fallbackLL
          ? `${(+fallbackLL.lat).toFixed(6)}, ${(+fallbackLL.lng).toFixed(6)}`
          : '—')
    const fid = (pin.friendly_id || '').trim();

    const isEditing   = ctx.editingDescMap.has(pin.id)
    const currentDesc = pin.description || ''
    const summaryType = pin?.sign_type || ''
    const summaryText = pin?.sign_text || ''
    const histKey = `pin:${pin.id}`
    const labelType = formatSignTypeLabel(summaryType, 'Not Specified')
    const photosId = `photos-${pin.id}`

    const cityStr  = (pin.city  || '').trim()
    const stateStr = (pin.state || '').trim()
    const cityStateLabel = cityStr || stateStr
      ? `${cityStr}${cityStr && stateStr ? ', ' : ''}${stateStr}`
      : 'Location'


    // Prefer numeric coords for the buttons; fall back to marker ll
    const latAct = Number.isFinite(latNum) ? latNum : (fallbackLL ? +fallbackLL.lat : NaN)
    const lngAct = Number.isFinite(lngNum) ? lngNum : (fallbackLL ? +fallbackLL.lng : NaN)
    const canActions = Number.isFinite(latAct) && Number.isFinite(lngAct)
    const popupHost = mountPopupContent(marker, PinPopupContent, {
      pending,
      labelType,
      friendlyId: pin.friendly_id || '',
      summaryText,
      photosId,
      isEditing,
      descValue: currentDesc,
      canModerate: ctx.canModerate.value,
      canBookmark: !!ctx.currentUser?.value?.id,
      isBookmarked: ctx.isPinBookmarked(pin.id),
      canActions,
      cityStateLabel,
      coordStr,
      reports: Array.isArray(reports) ? reports : [],
      historySource: histKey,
      isFinalLifecycle,
      canStylePin: ctx.canModerate.value,
      pinColor: ctx.resolvedColorForPin(pin),
      pinIconType: pin?.icon_type,
      pinIsMajorCampaign: ctx.isMajorCampaign(pin),
      pinSignType: pin?.sign_type || '',
      colorOptions: popupColorOptionsForPin(pin),
      onSaveDesc: (newDesc) => ctx.savePinDesc(pin.id, newDesc),
      onSavePinVisuals: (payload) => ctx.savePinVisuals(pin.id, payload),
      onCancelEditDesc: () => ctx.cancelEditPinDesc(pin.id),
      onStartEditDesc: () => ctx.startEditPinDesc(pin.id),
      onCopyAppPinUrl: () => ctx.copyAppPinUrl(latAct, lngAct, fid),
      onOpenMapAt: () => ctx.openMapAt(latAct, lngAct),
      onOpenPinHistory: () => openPinHistory(histKey),
      onOpenReportForPin: (presetType) => ctx.openReportForPin(pin.id, coordStr, presetType),
      onCopyPinFromExisting: () => ctx.copyPinFromExisting(pin.id),
      onTogglePinDrag: () => ctx.togglePinDrag(pin.id),
      onToggleBookmark: async () => {
        await ctx.toggleBookmarkForPin(pin.id)
        updatePinPopup(pin.id)
      },
      onDeletePin: () => ctx.deletePinFromMapPopup(pin.id),
    })

    marker.bindPopup(popupHost, {
      className: 'pin-popup',
      maxWidth: 320,
      minWidth: 220,
      // We will do our own precise centering pan; disable Leaflet's auto-pan
      autoPan: false,
    })

    // Detach Leaflet's automatic click→popup toggle (registered by bindPopup as
    // {click: this._openPopup}, vendored 1.9.4): the popup must not open when
    // the tap-ambiguity gate intercepts. We re-create the toggle explicitly.
    marker.off('click', marker._openPopup, marker)

    // Ensure URL reflects the exact clicked marker (pending or approved)
    marker.on('click', (ev) => {
      try { L.DomEvent.stop(ev) } catch {}
      if (ctx.handleAmbiguousTap(ev)) { S._lastPointerDownLL = null; return }
      const ll = marker.getLatLng()
      ctx.setUrlWithFidPassive(ll.lat, ll.lng, fid)
      S._lastPointerDownLL = null
      // Pending markers aren’t re-bound on click,
      // so open their popup immediately.
      if (pin.kind === 'pending') marker.openPopup()
      else marker.togglePopup()
    })
    marker.off('popupopen')
    marker.on('popupopen', () => {
      ctx.log('popupopen fired', { pinId: pin.id })
      resolvePopupExpect(pin)

      const el = marker.getPopup()?.getElement?.()
      if (el) {
        L.DomEvent.disableClickPropagation(el)
        L.DomEvent.disableScrollPropagation(el)
        el.addEventListener('contextmenu', (e) => e.stopPropagation())
      }

      const reportIds = (reports || []).map(r => r.id)
      setTimeout(() => { ctx.showAllPhotosForPin(pin.id, reportIds) }, 0)

      requestAnimationFrame(() => {
        requestAnimationFrame(() => { try { panMarkerWithPopupCentered(marker) } catch {} })
      })
    })
  }

  // Pan so that the marker sits at (centerX, centerY + popupHeight/2)
  // which places the popup's center roughly at screen center.
  function panMarkerWithPopupCentered(marker) {
    if (!S.map || !marker) return
    const latlng = marker.getLatLng()
    const currentPt = S.map.latLngToContainerPoint(latlng)
    const size = S.map.getSize()

    const popupEl = marker.getPopup?.()?.getElement?.()
    let popupH = 260
    if (popupEl) {
      const wrap = popupEl.querySelector('.leaflet-popup-content-wrapper') || popupEl
      const measured = wrap?.offsetHeight
      if (Number.isFinite(measured) && measured > 0) {
        popupH = Math.min(measured, 340)
      }
    }

    // 👇 NEW: a little extra downward nudge (in screen px)
    const extraY = 100   // tweak between 16–40 to taste

    // Marker should sit below center by half popup height + a bit more
    const desiredPt = L.point(size.x / 2, size.y / 2 + popupH / 2 + extraY)

    const delta = desiredPt.subtract(currentPt)
    // Remember: positive delta moves *content* opposite; negate for correct direction
    S.map.panBy([-delta.x, -delta.y], { animate: true, duration: 0.25 })
  }

  async function renderPinWithPopup(pin) {
    
    const marker = await ctx.createMarkerWithIcon(pin)
    if (!marker) return

    marker.__pinId = pin.id
    marker.on('click', async (ev) => {
      // prevent the map's click handler from also firing
      try { L.DomEvent.stop(ev) } catch {}
      if (ctx.handleAmbiguousTap(ev)) { S._lastPointerDownLL = null; return }

      // Use exact pin/marker coordinates
      const lat = (marker.__lat ?? marker.getLatLng().lat)
      const lng = (marker.__lng ?? marker.getLatLng().lng)
      const fid = (pin.friendly_id || '').trim()
      ctx.setUrlWithFidPassive(lat, lng, fid)
      S._lastPointerDownLL = null

      // Expect the popup for this pin to actually open soon
      const resolve = expectEvent(`Map popup opened for pin ${pin.id}`, 4000)
      popupExpect.set(pin.id, resolve)
      ctx.log('marker click → updatePinPopup()', { pinId: pin.id })
      await updatePinPopup(pin.id)
    })
    ctx.pinMarkerMap.set(pin.id, marker)

    // ✅ also store lat/lng to avoid repeatedly calling getLatLng()
    marker.__lat = pin.lat
    marker.__lng = pin.lng
    ctx.indexMarkerByCell(pin.id, pin.lat, pin.lng)
    ctx.markFilterPassDirty()
  }

  function renderTempPopup(marker, tempId) {
    const pos = marker.getLatLng()
    const coordStr = `${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}`
    const popupHost = mountPopupContent(marker, TempPinPopupContent, {
      mode: 'new',
      coordStr,
      onReportSign: () => ctx.openReportFromTemp(tempId),
      onRemovePin: () => ctx.deleteTempPin(tempId),
    })
    marker.bindPopup(popupHost)
  }

  async function updatePinPopup (pinId) {
    if (!S.map) return;
    ctx.log('updatePinPopup ▶', { pinId })
    const resolveUpd = expectEvent(`Map updatePinPopup pipeline completed for pin ${pinId}`, 3000)

    const pin = ctx.pinById.get(pinId)
    if (!pin) { 
      ctx.log('pin not found … FAILED', { pinId })
      resolveUpd()
      return
    }

    // remove any temp marker sitting at this coordinate
    for (const [id, marker] of ctx.tempMarkerMap.entries()) {
      const { lat, lng } = marker.getLatLng()
      if (lat.toFixed(6) === pin.lat.toFixed(6) && lng.toFixed(6) === pin.lng.toFixed(6)) {
        unmountPopupApp(marker)
        S.map.removeLayer(marker)
        ctx.tempMarkerMap.delete(id)
        ctx.tempPins.value = ctx.tempPins.value.filter(p => p.id !== id)
      }
    }

    let reports = []
    try {
      // ⏱ guard the network call so AFK wake doesn’t stall the pipeline
      const rows = await ctx.fetchReportsForPin(pin.id)
      reports = rows.map(r => ({ ...r, __pending: r.is_approved === false }))
      ctx.log('reports fetched', { pinId, count: reports.length, error: !!rows?.error })
    } catch (e) {
      logger.warn('Map reports fetch skipped while updating popup', e)
      reports = []
    }

    try {
      // rebuild marker + popup regardless of fetch outcome
      const existing = ctx.pinMarkerMap.get(pin.id)
      if (existing) {
        unmountPopupApp(existing)
        S.map.removeLayer(existing)
        ctx.pinMarkerMap.delete(pin.id)
        ctx.visibleMarkerIds.delete(pin.id)
        ctx.unindexMarkerByCell(pin.id)
        ctx.filterPassNoCategoryIds.delete(pin.id)
        ctx.filterPassWithCategoryIds.delete(pin.id)
      }

      const marker = await ctx.createMarkerWithIcon(pin)
      bindMarkerPopup(marker, pin, reports)
      ctx.pinMarkerMap.set(pin.id, marker)
      marker.__lat = pin.lat
      marker.__lng = pin.lng
      ctx.indexMarkerByCell(pin.id, pin.lat, pin.lng)
      ctx.markFilterPassDirty()

      // ensure it’s on the map before opening (covers rare race)
      ctx.redrawPins(S.map, { filtersChanged: true })
      const newMarker = ctx.pinMarkerMap.get(pinId)
      if (newMarker) {
        if (S.map.hasLayer(newMarker)) newMarker.openPopup()
        else newMarker.once('add', () => newMarker.openPopup())
      }
    } catch (err) {
      logger.error('Map failed to rebind/open popup', err)
    } finally {
      // ✅ always resolve the pipeline marker
      resolveUpd()
    }
  };

  Object.assign(ctx, { bindMarkerPopup, historyModal, markerPopupApps, mountPopupContent, openPinHistory, panMarkerWithPopupCentered, popupColorOptionsForPin, popupExpect, renderPinWithPopup, renderTempPopup, resolvePopupExpect, unmountPopupApp, updatePinPopup })
  return { bindMarkerPopup, historyModal, markerPopupApps, mountPopupContent, openPinHistory, panMarkerWithPopupCentered, popupColorOptionsForPin, popupExpect, renderPinWithPopup, renderTempPopup, resolvePopupExpect, unmountPopupApp, updatePinPopup }
}
