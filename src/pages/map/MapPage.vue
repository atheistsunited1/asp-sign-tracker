<template>
  <div id="map-container">

    <!-- Map banners (priority order) -->
    <div v-if="initialLoading" class="map-banner" role="status" aria-live="polite">
      Loading pins…
    </div>

    <div v-else-if="noPinsWarning" class="map-banner" role="status" aria-live="polite">
      Turn on filters to see pins.
    </div>

    <div v-else-if="noPinsAreaBanner" class="map-banner" role="status" aria-live="polite">
      No pins in this area to display.
    </div>



    <div id="map"></div>
    <!-- Freeze overlay while loading -->
    <div v-if="initialLoading" class="map-freeze" aria-hidden="true"></div>

    <GoToDock />


    <!-- Vertical map controls -->
    <!-- Locate: one stateful control (idle → locating → located → following/passive) -->
    <div id="map-controls">
      <button
        class="map-button light locate-btn"
        :class="`is-${locateStatus}`"
        :disabled="initialLoading || locateStatus === 'unavailable'"
        :title="locateTitle"
        :aria-label="locateTitle"
        :aria-pressed="locateStatus === 'following'"
        @click="onLocateTap"
      >
        <svg class="locate-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
          <circle class="locate-ring" cx="12" cy="12" r="5.5" />
          <circle class="locate-core" cx="12" cy="12" r="2.2" />
          <path class="locate-ticks" d="M12 2.5v3.5M12 18v3.5M2.5 12H6M18 12h3.5" />
        </svg>
      </button>
      <div v-if="showZoomReadout" class="zoom-readout" title="Zoom level (debug)">z{{ zoomLevel }}</div>
    </div>

    <!-- Mobile quick photo report -->
    <button class="camera-fab" type="button" @click="quickPhotoReport" title="Quick photo report">📷</button>

    
    <!-- Layer controls -->
    <div id="layer-controls">
      <!-- Basemap: one segmented control, active half highlighted -->
      <div class="basemap-seg" role="group" aria-label="Basemap">
        <button
          class="layer-btn seg-half"
          :class="{ active: activeBaseLayerName === 'Streets' }"
          :aria-pressed="activeBaseLayerName === 'Streets'"
          title="Streets"
          aria-label="Streets basemap"
          @click="switchBaseLayer('Streets')"
        >🛣️</button>
        <button
          class="layer-btn seg-half"
          :class="{ active: activeBaseLayerName === 'Satellite' }"
          :aria-pressed="activeBaseLayerName === 'Satellite'"
          title="Satellite (USGS imagery)"
          aria-label="Satellite basemap"
          @click="switchBaseLayer('Satellite')"
        >🛰️</button>
      </div>
    </div>
    
    <LegendPanel />



    <SearchTray />


    
    <!-- Photo viewer: the shared Lightbox (prev/next over the popup's photo list) -->
    <Lightbox
      :open="imageModal.visible"
      :url="imageModal.items[imageModal.idx] || ''"
      :index="imageModal.idx"
      :count="imageModal.items.length"
      alt="photo"
      @close="closeImageModal"
      @prev="prevImage"
      @next="nextImage"
    />

    <!-- Backdrop blocks map interactions & dismisses tray -->
    <div
      v-if="searchOpen"
      class="tray-backdrop"
      @click="closeTray"
    />


  </div>

  <PinHistoryModal
    :visible="historyModal.visible"
    :source="historyModal.source"
    @close="historyModal.visible = false"
  />
  

  <!-- Report form (add the listeners here) -->
  <ReportForm
    ref="reportFormRef"
    :pins="supabasePins"
    @refresh-pins="refreshSupabasePins"
    @submitted="() => {}"
  />

  <!-- Tap disambiguation: visually-overlapping pins at max zoom -->
  <NearbyPinSelector
    :visible="tapChooser.visible"
    :coords="tapChooser.coords"
    :nearbyPins="tapChooser.pins"
    pick-only
    @selectExisting="onTapChooserSelect"
    @cancel="closeTapChooser"
  />
</template>

<script setup>
// Map page: wiring only. The behaviour lives in the composables below, which
// share one context (mapContext.js) and register their members on it.
import { ref, inject, provide } from 'vue'
import NearbyPinSelector from '@/shared/domain/NearbyPinSelector.vue'
import PinHistoryModal from '@/pages/map/components/PinHistoryModal.vue'
import ReportForm from '@/pages/map/report-form/ReportForm.vue'
import { scope } from '@/shared/lib/debug'
import { useConfirm } from '@/shared/ui/useConfirm'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from '@/shared/ui/useToast'
import Lightbox from '@/shared/ui/Lightbox.vue'
import GoToDock from '@/pages/map/components/GoToDock.vue'
import LegendPanel from '@/pages/map/components/LegendPanel.vue'
import SearchTray from '@/pages/map/components/SearchTray.vue'
import { createMapContext, MAP_CTX } from '@/pages/map/mapContext'
import { usePinFilters } from '@/pages/map/usePinFilters'
import { useMyReportsAndBookmarks } from '@/pages/map/useMyReportsAndBookmarks'
import { useLegend } from '@/pages/map/useLegend'
import { useMapSearch } from '@/pages/map/useMapSearch'
import { useGoTo } from '@/pages/map/useGoTo'
import { usePinMarkers } from '@/pages/map/usePinMarkers'
import { usePinIndex } from '@/pages/map/usePinIndex'
import { usePinLayer } from '@/pages/map/usePinLayer'
import { usePopupPhotos } from '@/pages/map/usePopupPhotos'
import { usePinPopups } from '@/pages/map/usePinPopups'
import { usePinDrag } from '@/pages/map/usePinDrag'
import { usePinActions } from '@/pages/map/usePinActions'
import { useLocate } from '@/pages/map/useLocate'
import { useTapChooser } from '@/pages/map/useTapChooser'
import { useMapUrlState } from '@/pages/map/useMapUrlState'
import { useLeafletMap } from '@/pages/map/useLeafletMap'
import { useMapDebug } from '@/pages/map/useMapDebug'

const route = useRoute()
const router = useRouter()

const { show: showToast } = useToast()
const { confirm } = useConfirm()

const log = scope('Map')

const isMapmasterOrHigher = inject('isMapmasterOrHigher', ref(false))

const supabasePins = inject('supabasePins')
const currentUser = inject('user')


const ctx = createMapContext({ route, router, showToast, confirm, log, isMapmasterOrHigher, supabasePins, currentUser })
usePinFilters(ctx)
useMyReportsAndBookmarks(ctx)
useLegend(ctx)
useMapSearch(ctx)
useGoTo(ctx)
usePinMarkers(ctx)
usePinIndex(ctx)
usePinLayer(ctx)
usePopupPhotos(ctx)
usePinPopups(ctx)
usePinDrag(ctx)
usePinActions(ctx)
useLocate(ctx)
useTapChooser(ctx)
useMapUrlState(ctx)
useLeafletMap(ctx)
useMapDebug(ctx)
provide(MAP_CTX, ctx)   // the template components read the finished context

// Template bindings
const {
  activeBaseLayerName,
  closeImageModal,
  closeTapChooser,
  closeTray,
  historyModal,
  imageModal,
  initialLoading,
  locateStatus,
  locateTitle,
  nextImage,
  noPinsAreaBanner,
  noPinsWarning,
  onLocateTap,
  onTapChooserSelect,
  prevImage,
  quickPhotoReport,
  refreshSupabasePins,
  reportFormRef,
  searchOpen,
  showZoomReadout,
  switchBaseLayer,
  tapChooser,
  zoomLevel,
} = ctx
</script>

<style scoped src="./MapPage.css"></style>
