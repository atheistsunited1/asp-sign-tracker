// Leaflet map lifecycle: creation, base layers, zoom/move wiring, mount/unmount orchestration.
// Extracted verbatim from MapPage.vue. Shared map state is on
// `ctx` (see mapContext.js): other composables' members are referenced as
// `ctx.<name>`; mutable shared lets live on `ctx.state`.
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { createLocationLayer } from '@/pages/map/mapLocationLayer'
import { DEBUG_RUNTIME_EVENT, isDebugEnabled } from '@/shared/lib/debugRuntime'
import { configureLeafletDefaultIcon } from '@/shared/ui/leaflet'
import { logger } from '@/shared/lib/logger'
import { withTimeout } from '@/shared/lib/withTimeout'
import { clampLat, normalizeLng } from '@/shared/lib/coords'
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
import 'leaflet-doubletapdrag'
import 'leaflet-doubletapdragzoom'

export function useLeafletMap(ctx) {
  const S = ctx.state

  // near other refs
  const initialLoading = ref(true)

  S.map = null

  let alive = true

  let leafletZoomCtrl = null

  let onMapMoveZoom = null

  S._lastPointerDownLL = null

  // ✅ Use the same default icon bundle path everywhere
  configureLeafletDefaultIcon()


  // Web Mercator renderable latitude (Leaflet's practical cap ~85.0511)
  const MAX_LAT = 85.05112878;

  const MAX_LNG = 180;

  const MAP_MAX_BOUNDS = L.latLngBounds(
    L.latLng(-MAX_LAT, -MAX_LNG),
    L.latLng( MAX_LAT,  MAX_LNG)
  );

  const centerCoords = [39.5, -98.35]

  const zoomLevel = ref(5)

  // Small "wake" warm-up: brief delay → refresh token → tiny query
  async function warmSupabase() {
    try { await new Promise(r => setTimeout(r, 250)); } catch {}
    try { await withTimeout(warmSupabaseConnection(), 6000, 'warm:supabase') } catch {}
  }

  // Debug-only zoom readout: shown when diagnostics logging is on.
  const showZoomReadout = ref(isDebugEnabled())
  if (typeof window !== 'undefined') {
    window.addEventListener(DEBUG_RUNTIME_EVENT, () => { showZoomReadout.value = isDebugEnabled() })
  }

  const _cleanup = []

  onBeforeUnmount(() => {
    try { if (S.remoteSearchDebounceTimer) clearTimeout(S.remoteSearchDebounceTimer) } catch {}
    try { S.remoteSearchAbortCtrl?.abort() } catch {}
    try { S.goToAddressAbort?.abort() } catch {}
    try { if (ctx.imageModal.value.visible) document.body.style.overflow = '' } catch {}
    alive = false
    for (const app of ctx.markerPopupApps.values()) {
      try { app.unmount() } catch {}
    }
    ctx.markerPopupApps.clear()
    ctx.clearRenderCaches()
    _cleanup.forEach(fn => { try { fn() } catch {} })
    try {
      if (S.map && onMapMoveZoom) S.map.off('zoomend moveend', onMapMoveZoom)
      if (S.map) {
        S.map.off()                 // drop any other per-map handlers
        leafletZoomCtrl?.remove?.()
        S.map.remove()              // destroy the Leaflet instance
      }
    } catch {}
    S.map = null
    onMapMoveZoom = null
    ctx.log('beforeUnmount')
  })

  // Base layers
  const baseLayers = {
    Streets: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
      noWrap: true,              // disables horizontal world wrapping
      bounds: MAP_MAX_BOUNDS,    // hints to tile source; optional but nice
    }),
    // USGS "Imagery Only" (The National Map): public-domain orthoimagery, no key
    // or account. The cache stops at zoom 16; beyond that Leaflet upsamples
    // (deliberately accepted).
    Satellite: L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}', {
      maxNativeZoom: 16,
      maxZoom: 20,
      attribution: 'Imagery: USDA, USGS The National Map: Orthoimagery',
      noWrap: true,              // disables horizontal world wrapping
      bounds: MAP_MAX_BOUNDS,    // hints to tile source; optional but nice
    })
  }

  let currentBaseLayer = baseLayers.Streets

  const activeBaseLayerName = ref('Streets')   // drives the segmented control's active state

  function switchBaseLayer(layerName) {
    if (!S.map || !baseLayers[layerName]) return
    if (currentBaseLayer === baseLayers[layerName]) return
    ctx.log('🗺️ switchBaseLayer', { from: getLayerName(currentBaseLayer), to: layerName })
    S.map.removeLayer(currentBaseLayer)
    currentBaseLayer = baseLayers[layerName]
    currentBaseLayer.addTo(S.map)
    activeBaseLayerName.value = layerName
  }

  function getLayerName(layer) {
    return layer === baseLayers.Satellite ? 'Satellite' : 'Streets'
  }

  onMounted(async () => {

    const onImageKeys = (e) => {
      if (!ctx.imageModal.value.visible) return;
      if (e.key === 'Escape') ctx.closeImageModal();
      else if (e.key === 'ArrowRight') ctx.nextImage();
      else if (e.key === 'ArrowLeft')  ctx.prevImage();
    };
    window.addEventListener('keydown', onImageKeys);
    _cleanup.push(() => window.removeEventListener('keydown', onImageKeys));

    
    const onAppMenuClick = () => ctx.closeTray()
    window.addEventListener('app:menu-click', onAppMenuClick)
    _cleanup.push(() => window.removeEventListener('app:menu-click', onAppMenuClick))
    
    const onKey = (e) => { if (e.key === 'Escape' && ctx.searchOpen.value) ctx.closeTray() }
    window.addEventListener('keydown', onKey)
    _cleanup.push(() => window.removeEventListener('keydown', onKey))


    ctx.log('mounted')

    const onVis = async () => {
      ctx.log(`visibilitychange: ${document.visibilityState}`)
      if (document.visibilityState === 'visible') {
        // small grace so the tab/network fully "wakes"
        setTimeout(() => { warmSupabase().catch(()=>{}) }, 200)
      }
    }
    const onShow = (e) => ctx.log(`pageshow (persisted=${!!e.persisted})`)
    const onHide = (e) => ctx.log(`pagehide (persisted=${!!e.persisted})`)

    window.addEventListener('visibilitychange', onVis)
    window.addEventListener('pageshow', onShow)
    window.addEventListener('pagehide', onHide)

    _cleanup.push(() => {
      window.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pageshow', onShow)
      window.removeEventListener('pagehide', onHide)
    })
    



    await ctx.router.isReady()
    if (!alive) return                         // navigated away mid-await
    ctx.loadSearchStateFromUrl()

    function centerOnUserAtLoad() {
      if (S.urlTargeted || ctx.route.query.ll || (ctx.route.query.lat != null && ctx.route.query.lng != null)) {
        ctx.log('📍 centerOnUserAtLoad: skipped (URL target present)')
        return
      }
      if (!ctx.geo.supported) return
      // Fast fix first (dot appears immediately), refined in the background.
      ctx.geo.getFix({ onUpdate: ctx.paintLocation })
        .then((p) => {
          if (!p) return
          if (S.urlTargeted) { ctx.log('📍 centerOnUserAtLoad: abandoning pan (URL took over)'); return }
          ctx.log('📍 centerOnUserAtLoad: geolocation success', { lat: p.lat, lng: p.lng })
          ctx.moveCamera(() => S.map.setView(ctx.safeLatLng(p.lat, p.lng), 8, { animate: false }))
          ctx.updateAllRadii()
        })
        .catch((e) => logger.warn('Map initial geolocation failed', e))
    };

    if (!S.map) {
      const el = document.getElementById('map')
      if (!alive || !el) {                     // container gone? bail quietly
        return
      }
      S.map = L.map('map', {
          zoomControl: false,   // disable default position
          preferCanvas: true,
          maxBounds: MAP_MAX_BOUNDS,
          maxBoundsViscosity: 1.0,   // 1.0 = "sticky" edge; prevents dragging past bounds
          worldCopyJump: false,      // keep a single world; avoids weird wrap jumps
          inertia: true,             // can keep this; viscosity will still cap
          // One-finger zoom: double-tap, hold, drag (down = in, up = out) — Google Maps gesture
          doubleTapDragZoom: 'center',
          doubleTapDragZoomOptions: { reverse: true },
      }).setView(centerCoords, 5)
      ctx.log('Leaflet map created')

      
      S.map.dragging.disable()
      S.map.scrollWheelZoom.disable()
      S.map.doubleClickZoom.disable()
      S.map.boxZoom.disable()
      S.map.keyboard.disable()
      S.map.touchZoom.disable()
      if (S.map.tap) S.map.tap.disable()
      S.map.doubleTapDragZoom?.disable()

      // My-location panes + renderer are owned by utils/mapLocationLayer.js.
      S.locationLayer = createLocationLayer(S.map)
      S.map.on('dragstart', ctx.onUserPanStart)   // user pans while following → passive
      // Capture the exact point the user touched/clicked (pre-zoom/pan)
      S.map.on('mousedown touchstart', (e) => { S._lastPointerDownLL = e.latlng })
    }
    // Track popup state AFTER map exists
    S.map.on('popupopen', () => {
      S.openPopups = 1
    })
    S.map.on('popupclose', () => { S.openPopups = 0 })


    // Always show the default Leaflet +/- control
    if (!leafletZoomCtrl) leafletZoomCtrl = L.control.zoom({ position: 'bottomright' })
    leafletZoomCtrl.addTo(S.map)

    currentBaseLayer.addTo(S.map)
    ctx.log('base layer added', { layer: 'Streets' })


    // If URL has coords, honor them (and optional z). Otherwise, center on user once.
    const qCoord = ctx.parseLlQuery(ctx.route.query.ll)
    const qZoom  = ctx.parseZoom(ctx.route.query.z)
    ctx.log('🧭 startup query snapshot', {
      raw: { ll: ctx.route.query.ll, z: ctx.route.query.z, lat: ctx.route.query.lat, lng: ctx.route.query.lng },
      parsed: { qCoord, qZoom }
    })
    if (qCoord) {
      S.urlTargeted = true; ctx.log('🔒 urlTargeted set at startup')
      ctx.goToQueryCoordinate(qCoord, qZoom)
    } else {
      centerOnUserAtLoad()
    }
    
    watch([() => ctx.route.query.ll, () => ctx.route.query.z, () => ctx.route.query.lat, () => ctx.route.query.lng],
    ([vll, vz, vlat, vlng]) => {
      ctx.log('🌐 route watcher', { ll: vll, z: vz, lat: vlat, lng: vlng })
      let p = ctx.parseLlQuery(vll)
      if (!p && vlat != null && vlng != null) {
        const lat = clampLat(+vlat); const lng = normalizeLng(+vlng)
        if (Number.isFinite(lat) && Number.isFinite(lng)) p = { lat, lng }
      }
      const z = ctx.parseZoom(vz)
      if (p) { S.urlTargeted = true; ctx.log('🔒 urlTargeted set by route watcher', { p, z }); ctx.goToQueryCoordinate(p, z) }
    })




    // Bind pan/zoom listeners once (kept out of data loaders)
    onMapMoveZoom = () => {
      const bucket = S.map.getZoom() >= ctx.ZOOM_BUMP_THRESHOLD ? 1 : 0
      zoomLevel.value = S.map.getZoom()
      const c = S.map.getCenter()
      ctx.log('🧭 map move/zoom', { zoom: zoomLevel.value, center: { lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5) } })
       ctx.redrawPins(S.map)
      
      // ✅ always recompute counts/banners on any pan or zoom
      ctx.recomputeCountsAndBanner()
      if (bucket !== S.lastZoomBucket) {
        ctx.updateAllRadii()
        S.lastZoomBucket = bucket
      }
      
      // Keep URL (ll & z) current without firing router watchers
      ctx.updateUrlFromMap(true, 'move/zoom')
    }
    S.map.on('zoomend moveend', onMapMoveZoom)


    await ctx.loadPinsFromSupabase(S.map)
    
    await ctx.loadMyReports()
    await ctx.loadBookmarks()
    if (!ctx.searchFiltersAreEmpty()) {
      await ctx.runRemoteSearch({ resetPage: false })
    }
    ctx.updateAllRadii()
    ctx.recomputeCountsAndBanner()   // 👈 add this
    
    // ✅ unfreeze
    S.map.dragging.enable()
    S.map.scrollWheelZoom.enable()
    S.map.doubleClickZoom.enable()
    S.map.boxZoom.enable()
    S.map.keyboard.enable()
    S.map.touchZoom.enable()
    if (S.map.tap) S.map.tap.enable()
    S.map.doubleTapDragZoom?.enable()
    initialLoading.value = false

    S.map.on('click', async function (e) {
      if (initialLoading.value) return
      
      const tgt = e.originalEvent?.target
      const closest = (sel) => typeof tgt?.closest === 'function' && tgt.closest(sel)

      // Ignore clicks on interactive layers OR popup chrome
      if (closest('.leaflet-interactive') || closest('.leaflet-popup')) return

      // If ANY popup is open, close it and DO NOT create a temp marker
      const hasOpenPopup = S.openPopups > 0 || !!document.querySelector('.leaflet-popup-pane .leaflet-popup')
      if (hasOpenPopup) {
        ctx.log('map click ignored (popup open)')
        S.map.closePopup()
        return
      }

      // A near-miss tap in a dense area (2+ pins within the ambiguity radius,
      // none actually hit) zooms/disambiguates instead of dropping a temp marker.
      const ll = S._lastPointerDownLL || e.latlng
      if (ctx.handleAmbiguousTap({ latlng: ll })) {
        S._lastPointerDownLL = null
        return
      }

      // otherwise, create the temp marker
      const lat = ll.lat.toFixed(6)
      const lng = ll.lng.toFixed(6)
      
      ctx.setUrlCoordPassive(lat, lng)
      S._lastPointerDownLL = null

      const id = `temp-${++S.tempPinSeq}`
      const marker = L.marker([lat, lng], { draggable: true, icon: new L.Icon.Default() }).addTo(S.map)
      ctx.renderTempPopup(marker, id)
      marker.openPopup()
      marker.on('dragend', () => { ctx.renderTempPopup(marker, id); marker.openPopup() })
      ctx.tempPins.value.push({ id, lat, lng })
      ctx.tempMarkerMap.set(id, marker)
    })
    
    setTimeout(() => S.map.invalidateSize(), 300)
  });

  Object.assign(ctx, { MAP_MAX_BOUNDS, MAX_LAT, MAX_LNG, _cleanup, activeBaseLayerName, baseLayers, centerCoords, getLayerName, initialLoading, showZoomReadout, switchBaseLayer, warmSupabase, zoomLevel })
  return { MAP_MAX_BOUNDS, MAX_LAT, MAX_LNG, _cleanup, activeBaseLayerName, baseLayers, centerCoords, getLayerName, initialLoading, showZoomReadout, switchBaseLayer, warmSupabase, zoomLevel }
}
