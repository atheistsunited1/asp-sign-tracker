// Pin actions from the popup: edit description, visuals, delete, copy, quick photo, open the report form.
// Extracted verbatim from MapPage.vue. Shared map state is on
// `ctx` (see mapContext.js): other composables' members are referenced as
// `ctx.<name>`; mutable shared lets live on `ctx.state`.
import { ref } from 'vue'
import { errorToUserMessage } from '@/shared/lib/errors'
import { logger } from '@/shared/lib/logger'
import { withTimeout } from '@/shared/lib/withTimeout'
import ReportForm from '@/pages/map/report-form/ReportForm.vue'
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
import {
  fetchActiveNonAuditReportsForPin,
  softDeletePinWithAudit,
  softDeleteReport,
  syncPinLifecycleFromLatestNonAuditReport,
} from '@/shared/domain/activityLifecycleService'
import {
  colorOptionRowsForPin,
  defaultColorForPin,
  DRAW_PRIORITY_LEVELS,
  drawPriorityForPin,
  normalizeIconColorForPin,
  normalizeSignType,
} from '@/shared/domain/pinVisuals'

export function usePinActions(ctx) {
  const S = ctx.state

  const reportFormRef = ref(null)

  // inline edit state for pin descriptions
  const editingDescMap = new Map()

  async function fetchReportsForPin(pinId, fastMs = 2500, slowMs = 6500) {
    const run = (ms) => withTimeout(
      fetchReportsForPinSvc(pinId),
      ms,
      `reports:pin:${pinId}`
    )
    try {
      const fast = await run(fastMs)
      if (fast.error) throw fast.error
      return fast.data ?? []
    } catch {
      try { await ctx.warmSupabase?.() } catch {}
      const slow = await run(slowMs)
      return slow.data ?? []
    }
  }

  function quickPhotoReport() {
    const openFormWith = (lat, lng) => {
      const coordStr = `${(+lat).toFixed(6)}, ${(+lng).toFixed(6)}`
      // show the form & prefill…
      reportFormRef.value?.openWithPrefill({
        reportType: '',
        coords: coordStr,
      })
      // …then, in the SAME click stack, trigger the native iOS chooser
      reportFormRef.value?.openGalleryPicker()
    }


    // … keep the rest of your logic (use live dot if present, otherwise getCurrentPosition, otherwise map center)
    if (ctx.geo.position.value) {
      const { lat, lng } = ctx.geo.position.value
      openFormWith(lat, lng)
      // (optional) still try for a fresh fix and update coords field later
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => reportFormRef.value?.openWithPrefill({
            reportType: '',
            coords: `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`
          }),
          () => {},
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
        )
      }
      return
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => openFormWith(pos.coords.latitude, pos.coords.longitude),
        () => {
          const c = S.map?.getCenter?.()
          if (c) openFormWith(c.lat, c.lng)
          else reportFormRef.value?.openWithPrefill({ reportType: '', coords: '' })
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
      )
      return
    }

    const c = S.map?.getCenter?.()
    if (c) openFormWith(c.lat, c.lng)
    else reportFormRef.value?.openWithPrefill({ reportType: '', coords: '' })
  }

  // Copy a Google Maps URL for these coords to clipboard
  async function copyCoordUrl (lat, lng) {
    try {
      const url = ctx.mapsUrl(lat, lng); // you already have mapsUrl()
      await navigator.clipboard.writeText(url);
      try { ctx.showToast?.('🔗 Map link copied'); } catch {}
    } catch {
      ctx.showToast('Could not copy link to clipboard.', 'error');
    }
  };

  async function copyAppPinUrl(lat, lng, fid = '') {
    try {
      await navigator.clipboard.writeText(ctx.appPinUrl({ lat, lng, fid, z: 19 }))
      try { ctx.showToast?.('🔗 Link copied') } catch {}
    } catch {
      ctx.showToast('Could not copy link.', 'error')
    }
  }

  // Open Google Maps to these coords
  function openMapAt (lat, lng, label = '')  {
    try { window.open(ctx.mapsUrl(lat, lng, label), '_blank', 'noopener'); } catch {}
  };

  async function deletePinFromMapPopup(pinId) {
    if (!ctx.canModerate.value) {
      ctx.showToast('Mapmaster or admin only.', 'error')
      return
    }

    const pin = ctx.pinById.get(pinId)
    if (!pin) return

    let activeReports = []
    try {
      const { data, error } = await fetchActiveNonAuditReportsForPin(pinId, { limit: 200 })
      if (error) throw error
      activeReports = Array.isArray(data) ? data : []
    } catch (e) {
      logger.error('Map delete precheck failed', e)
      ctx.showToast(errorToUserMessage(e, 'Delete check failed. Please try again.'), 'error')
      return
    }

    const pendingReports = activeReports.filter((r) => r?.is_approved === false)
    const hasPending = pendingReports.length > 0
    const deletePinToo = !hasPending || activeReports.length <= 1
    const pendingOnlyReport = hasPending && activeReports.length <= 1

    const ok = await ctx.confirm({
      title: pendingOnlyReport
        ? 'Delete pending activity and pin?'
        : (deletePinToo ? 'Delete pin and activity?' : 'Delete latest pending activity?'),
      message: pendingOnlyReport
        ? 'There are no other activity entries for this pin. Deleting this pending activity will also move the associated pin to Deleted for 30 days.'
        : (deletePinToo
          ? 'This action will move the pin and associated activity/photos to Deleted for 30 days.'
          : 'Other activity entries exist for this pin. This will move only the most recent pending activity to Deleted.'),
      confirmText: 'Delete',
      cancelText: 'Cancel',
      tone: 'danger',
    })
    if (!ok) return

    try {
      if (deletePinToo) {
        await softDeletePinWithAudit(pinId, {
          actorUserId: ctx.currentUser?.value?.id || null,
          reason: hasPending
            ? 'Deleted pin while removing final pending submission from map popup.'
            : 'Deleted pin from map popup.',
        })
        ctx.showToast('Pin moved to Deleted.', 'success')
        await refreshSupabasePins()
        return
      }

      const targetPending = pendingReports[0]
      if (!targetPending?.id) {
        ctx.showToast('No pending activity found to delete.', 'warn')
        return
      }

      const { error: deleteReportErr } = await softDeleteReport(targetPending.id)
      if (deleteReportErr) throw deleteReportErr

      const sync = await syncPinLifecycleFromLatestNonAuditReport(pinId)
      if (sync?.payload) {
        pin.kind = sync.payload.is_approved ? 'approved' : 'pending'
        pin.is_approved = !!sync.payload.is_approved
        pin.icon_type = sync.payload.icon_type
        pin.icon_color = sync.payload.icon_color
      }

      ctx.showToast('Pending submission moved to Deleted.', 'success')
      await ctx.updatePinPopup(pinId)
    } catch (e) {
      logger.error('Map delete action failed', e)
      ctx.showToast(errorToUserMessage(e, 'Delete failed. Please try again.'), 'error')
    }
  }

  function openReportWithCoords (coordStr, presetType = '') {
    
    reportFormRef.value?.openWithPrefill({
      coords: coordStr,
      reportType: presetType || '',
      selectedPinId: null,      // ensure NEW pin path if caller intends new
    })
  };

  function openReportForPin (pinId, coordStr, presetType = '') {
    reportFormRef.value?.openWithPrefill({
      selectedPinId: pinId,     // existing pin quick-action path
      coords: coordStr,
      reportType: presetType || '',
    })
  };

  function startEditPinDesc (pinId) {
    if (!ctx.canModerate.value) { ctx.showToast('Mapmaster or admin only.', 'error'); return }
    editingDescMap.set(pinId, true)
    ctx.updatePinPopup(pinId)
  };

  function cancelEditPinDesc (pinId) {
    editingDescMap.delete(pinId)
    ctx.updatePinPopup(pinId)
  };

  async function savePinDesc (pinId, nextDesc = null) {
    if (!ctx.canModerate.value) { ctx.showToast('Mapmaster or admin only.', 'error'); return }
    let newDesc = ''
    if (typeof nextDesc === 'string') {
      newDesc = nextDesc.trim()
    } else {
      const input = document.getElementById(`desc-input-${pinId}`)
      if (!input) return
      newDesc = input.value.trim()
    }

    const { error } = await updatePinById(pinId, {
      description: newDesc || null,
      updated_at: new Date().toISOString(),
    })

    if (error) {
      logger.error('Map savePinDesc failed', error)
      ctx.showToast(errorToUserMessage(error, 'Failed to update description.'), 'error')
      return
    }

    // keep local cache in sync
    const i = ctx.supabasePins.value.findIndex(p => p.id === pinId)
    if (i > -1) ctx.supabasePins.value[i].description = newDesc || null
    const pin = ctx.pinById.get(pinId)
    if (pin) {
      pin.description = newDesc || null

      // Keep search cache current after updating pin.description
      const fid = (pin.friendly_id || '')
      const ldesc = (pin.description || '')
      const stxt = (pin.sign_text || '')
      const styp = (pin.sign_type || '')
      pin.__all = `${pin.id} ${fid} ${ldesc} ${stxt} ${styp} ${pin.zip || ''}`.toLowerCase().trim()
      // keep the marker's cached text in sync for fallback search
      const m = ctx.pinMarkerMap.get(pinId);
      if (m) m.__locDesc = newDesc || '';

    }

    editingDescMap.delete(pinId)
    ctx.showToast('Description updated.', 'success')
    ctx.markFilterPassDirty()
    ctx.updatePinPopup(pinId)
  };

  async function savePinVisuals(pinId, payload = {}) {
    if (!ctx.canModerate.value) {
      ctx.showToast('Mapmaster or admin only.', 'error')
      return
    }
    const pin = ctx.pinById.get(pinId)
    if (!pin) return

    const iconType = Number(pin.icon_type)
    const nextColor = normalizeIconColorForPin({
      iconType,
      isMajorCampaign: ctx.isMajorCampaign(pin),
      signType: pin.sign_type,
      requestedColor: payload?.iconColor,
    })

    const { error } = await updatePinById(pinId, {
      icon_color: nextColor,
      updated_at: new Date().toISOString(),
    })
    if (error) {
      logger.error('Map savePinVisuals failed', error)
      ctx.showToast(errorToUserMessage(error, 'Failed to update pin style.'), 'error')
      return
    }

    pin.icon_color = nextColor

    const m = ctx.pinMarkerMap.get(pinId)
    if (m) m.__iconColor = nextColor

    const idx = ctx.supabasePins.value.findIndex((p) => p.id === pinId)
    if (idx > -1) ctx.supabasePins.value[idx].icon_color = nextColor

    ctx.showToast('Pin style updated.', 'success')
    ctx.updatePinPopup(pinId)
  }

  function deleteTempPin (tempId) {
    const marker = ctx.tempMarkerMap.get(tempId)
    if (marker) {
        ctx.unmountPopupApp(marker)
        S.map.removeLayer(marker)
        ctx.tempMarkerMap.delete(tempId)
        ctx.tempPins.value = ctx.tempPins.value.filter(p => p.id !== tempId)
        
    }
  };

  // Copy an existing approved pin into a new *submission* (prepopulates ReportForm)
  async function copyPinFromExisting (pinId) {
    const formApi = reportFormRef.value
    if (!formApi) { ctx.showToast('Report form state not found.', 'error'); return }

    // 1) get the base pin from cache (or fall back to query)
    let pin = ctx.pinById.get(pinId)
    if (!pin) {
      const run = () => fetchPinById(pinId)

      try {
        const res = await withTimeout(run(), 2500, `copyPin:select:${pinId}`)
        if (res.error) throw res.error
        pin = res.data
      } catch (e) {
        if (e?.name !== 'TimeoutError' && e?.message !== 'timeout') throw e
        await ctx.warmSupabase()
        const res2 = await withTimeout(run(), 6500, `copyPin:select(retry):${pinId}`)
        if (res2.error) throw res2.error
        pin = res2.data
      }
    }
    if (!pin) { ctx.showToast('Pin not found.', 'error'); return }
    const coords = (pin?.lat != null && pin?.lng != null)
      ? `${(+pin.lat).toFixed(6)}, ${(+pin.lng).toFixed(6)}`
      : '';
    formApi.openWithPrefill({
      selectedPinId: null,               // NEW submission, not linking to old pin
      coords,
      reportType: '',                    // let the user choose
      signType: pin.sign_type || '',
      signText: pin.sign_text || '',
      locationDescription: pin.description || '',
    })
    // (keep your staged photos clearing below if you want — optional)

    // clear any queued photos (revoke previews to avoid leaks)
    formApi.clearStagedPhotos?.()

    // Done. User can adjust and submit; backend will make a new submission with a new UUID/friendly id on approval.
  };

  const openReportFromTemp = (tempId) => {
    const marker = ctx.tempMarkerMap.get(tempId)
    if (!marker) { ctx.showToast('Temporary pin not found.', 'error'); return }

    const pos = marker.getLatLng()
    const coordStr = `${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)}`
    openReportWithCoords(coordStr, '')
  }

  const refreshSupabasePins = async () => {
    // remove old markers
    for (const m of ctx.pinMarkerMap.values()) {
      ctx.unmountPopupApp(m)
      if (S.map.hasLayer(m)) S.map.removeLayer(m)
    }
    ctx.pinMarkerMap.clear()
    ctx.clearRenderCaches()
    await ctx.loadPinsFromSupabase(S.map)
    await ctx.loadMyReports()
    await ctx.loadBookmarks()
  };

  Object.assign(ctx, { cancelEditPinDesc, copyAppPinUrl, copyCoordUrl, copyPinFromExisting, deletePinFromMapPopup, deleteTempPin, editingDescMap, fetchReportsForPin, openMapAt, openReportForPin, openReportFromTemp, openReportWithCoords, quickPhotoReport, refreshSupabasePins, reportFormRef, savePinDesc, savePinVisuals, startEditPinDesc })
  return { cancelEditPinDesc, copyAppPinUrl, copyCoordUrl, copyPinFromExisting, deletePinFromMapPopup, deleteTempPin, editingDescMap, fetchReportsForPin, openMapAt, openReportForPin, openReportFromTemp, openReportWithCoords, quickPhotoReport, refreshSupabasePins, reportFormRef, savePinDesc, savePinVisuals, startEditPinDesc }
}
