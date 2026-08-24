<template>
  <div class="review-container">
    <div class="title-row">
      <h1>📝 Reports <span v-if="loading" class="loading-inline" aria-live="polite">Loading…</span></h1>
      <button class="my-pill" :class="{ active: hasActiveFilters }" @click="openFilters()">
        🔎 Filters <span v-if="hasActiveFilters" class="dot" aria-hidden="true"></span>
      </button>
      <button v-if="hasActiveFilters" class="my-pill" @click="resetAllFilters()" title="Clear all filters">♻️ Reset filters</button>
    </div>

    <div class="main-grid" :aria-busy="loading">
      <!-- Left: tabs + scrollable lists -->
      <aside class="left-list" :class="{ expanded: listExpanded, collapsed: !listExpanded }">
        <!-- Header strip: tabs + filters. On mobile the strip itself expands/collapses the list. -->
        <div class="list-title">
          <button v-if="isMobile && !listExpanded" class="list-strip" type="button" @click="expandList" :aria-expanded="false" title="Show the list">
            📝 Reports · {{ activeTabLabel }}
            <span v-if="activeTab==='submitted' && submittedTotal !== null" class="muted count">({{ submittedTotal }})</span>
            <span class="chev" aria-hidden="true">▸</span>
          </button>
          <header v-else class="tabs" role="tablist">
            <button class="tab" role="tab" :aria-selected="activeTab==='submitted'" :class="{ active: activeTab==='submitted' }" @click="switchTab('submitted')">
              Pending <span v-if="submittedTotal !== null" class="muted count">({{ submittedTotal }})</span>
            </button>
            <button class="tab" role="tab" :aria-selected="activeTab==='approved'" :class="{ active: activeTab==='approved' }" @click="switchTab('approved')">Approved</button>
            <button v-if="isAdmin" class="tab" role="tab" :aria-selected="activeTab==='deleted'" :class="{ active: activeTab==='deleted' }" @click="switchTab('deleted')">Deleted</button>
            <span class="tabs-spacer"></span>
            <button class="tab-icon mobile-only" type="button" :class="{ active: hasActiveFilters }" @click="openFilters()" title="Filters" aria-label="Filters">🔍<span v-if="hasActiveFilters" class="dot" aria-hidden="true"></span></button>
            <button v-if="isMobile && (selected || selectedDeleted)" class="tab-icon mobile-only" type="button" @click="collapseList" title="Hide the list" aria-label="Hide the list">▾</button>
          </header>
        </div>

        <!-- Pending -->
        <div class="list-scroll" v-show="activeTab==='submitted' && (!isMobile || listExpanded)" ref="submittedListEl" @scroll.passive="onListScroll('submitted')">
          <ReportListItem
            v-for="r in submitted" :key="r.id"
            :type="r.report_type || 'sighting'" :thumb="firstThumb(r)" :major="r.pin_is_major_campaign"
            :friendly-id="r.pin_friendly_id" :sign-text="r.pin_sign_text || r.sign_text_edit"
            :place="formatCityState(r)" :date="formatDateOnly(r.occurred_on || r.created_at)"
            :active="r.id === selectedId" @select="selectReport(r)"
          />
          <div class="sentinel"></div>
          <div v-if="loadingMoreSubmitted" class="muted pad">Loading more…</div>
          <div v-else-if="!submittedHasMore && submitted.length" class="muted pad">End of results</div>
          <div v-else-if="!loadingSubmitted && !submitted.length" class="muted pad">No pending activity.</div>
        </div>

        <!-- Approved -->
        <div class="list-scroll" v-show="activeTab==='approved' && (!isMobile || listExpanded)" ref="approvedListEl" @scroll.passive="onListScroll('approved')">
          <ReportListItem
            v-for="r in approved" :key="r.id"
            :type="r.report_type || 'sighting'" :thumb="firstThumb(r)" :major="r.pin_is_major_campaign"
            :friendly-id="r.pin_friendly_id" :sign-text="r.pin_sign_text || r.sign_text_edit"
            :place="formatCityState(r)" :date="formatDateOnly(r.occurred_on || r.created_at)"
            :active="r.id === selectedId" @select="selectReport(r)"
          />
          <div class="sentinel"></div>
          <div v-if="loadingMoreApproved" class="muted pad">Loading more…</div>
          <div v-else-if="!approvedHasMore && approved.length" class="muted pad">End of results</div>
          <div v-else-if="!loadingApproved && !approved.length" class="muted pad">No approved activity.</div>
        </div>

        <!-- Deleted pins (mapmaster+) -->
        <div v-if="isAdmin" class="list-scroll" v-show="activeTab==='deleted' && (!isMobile || listExpanded)" ref="deletedListEl" @scroll.passive="onListScroll('deleted')">
          <ReportListItem
            v-for="p in deletedPins" :key="p.id"
            type="deleted" placeholder="🗂" :major="p.is_major_campaign"
            :friendly-id="p.friendly_id" :sign-text="p.sign_text"
            :place="formatPlace(p.city, p.state)" :date="formatDateOnly(p.deleted_at)"
            :active="p.id === selectedDeletedId" @select="selectDeletedPin(p)"
          />
          <div class="sentinel"></div>
          <div v-if="loadingMoreDeleted" class="muted pad">Loading more…</div>
          <div v-else-if="!deletedHasMore && deletedPins.length" class="muted pad">End of results</div>
          <div v-else-if="!loadingDeleted && !deletedPins.length" class="muted pad">No deleted pins.</div>
        </div>
      </aside>

      <!-- Right: detail card (top) + map (bottom) -->
      <ReportDetailCard v-if="selected" v-show="!isMobile || !listExpanded" />
      <DeletedPinCard v-else-if="activeTab==='deleted' && selectedDeleted" v-show="!isMobile || !listExpanded" />

      <Lightbox :open="lightbox.open" :url="lightbox.url" @close="closeLightbox" />

      <div class="map-holder" ref="mapEl"></div>
    </div>

    <FiltersModal :open="filtersOpen" :draft="draftFilters" @close="closeFilters()" @apply="applyFilters()" @reset="resetAllFilters()" />
  </div>
</template>

<script setup>
// Reports page: wires the feed, filters, detail, photos, actions, mini-map and
// the Deleted tab together and provides them to the detail cards (REPORTS_CTX).
import { ref, inject, onMounted, provide } from 'vue'
import { useConfirm } from '@/shared/ui/useConfirm'
import { useToast } from '@/shared/ui/useToast'
import Lightbox from '@/shared/ui/Lightbox.vue'
import { formatDateOnly } from '@/shared/lib/date'
import { formatPlace, formatCityState } from '@/shared/lib/place'
import { useDeletedPins } from '@/shared/domain/useDeletedPins'
import { REPORTS_CTX } from '@/pages/reports/context'
import { useReportFilters } from '@/pages/reports/useReportFilters'
import { useReportDetail } from '@/pages/reports/useReportDetail'
import { useCoordLocale } from '@/pages/reports/useCoordLocale'
import { useMiniMap } from '@/pages/reports/useMiniMap'
import { useReportPhotos } from '@/pages/reports/useReportPhotos'
import { useReportsFeed, PAGE } from '@/pages/reports/useReportsFeed'
import { useReportActions } from '@/pages/reports/useReportActions'
import ReportListItem from '@/pages/reports/components/ReportListItem.vue'
import ReportDetailCard from '@/pages/reports/components/ReportDetailCard.vue'
import DeletedPinCard from '@/pages/reports/components/DeletedPinCard.vue'
import FiltersModal from '@/pages/reports/components/FiltersModal.vue'

const { show: showToast } = useToast()
const { confirm } = useConfirm()
const user = inject('user')
const isAdmin = inject('canModerate', ref(false))   // mapmaster + admin

// --- composition (order follows the dependency direction) ---------------------
const filtersApi = useReportFilters({ onChange: () => feed.reloadForCurrentTab() })
const { filters, draftFilters, filtersOpen, hasActiveFilters, openFilters, closeFilters, applyFilters, resetAllFilters } = filtersApi

const deleted = useDeletedPins({
  isAdmin,
  actorId: () => user?.value?.id || null,
  getFilters: () => ({ q: filters.q, city: filters.city, state: filters.state }),
  pageSize: PAGE,
  showToast, confirm,
  hooks: {
    onSelect: (pin) => minimap.showPin(pin?.lat, pin?.lng, { draggable: false }),   // read-only on the Deleted tab
    afterMutation: () => feed.afterDeletedMutation(),
  },
})

const feed = useReportsFeed({
  user, isAdmin, filters, deleted,
  onSelected: (r) => {
    actions.primeLatestFinal(r)
    detail.loadEditingFrom(r)
    locale.resetCoordLocale()            // reverse geocoding is deferred until the coordinates change (#74)
    photos.reloadSubmissionPhotos(r.id)
    minimap.showPin(detail.editing.lat, detail.editing.lng, { draggable: true })
  },
  onRowsLoaded: (rows) => photos.hydratePhotoRows(rows),
})
const {
  activeTab, submitted, approved, selected, selectedId, submittedTotal, loading, isMobile, listExpanded,
  expandList, collapseList, activeTabLabel, submittedListEl, approvedListEl,
  loadingSubmitted, loadingApproved, loadingMoreSubmitted, loadingMoreApproved, submittedHasMore, approvedHasMore,
  onListScroll, selectReport, selectDeletedPin, switchTab,
} = feed
const { deletedPins, deletedListEl, selectedDeleted, selectedDeletedId, loadingDeleted, loadingMoreDeleted, deletedHasMore } = deleted

const detail = useReportDetail({ selected, showToast })
const locale = useCoordLocale({ editing: detail.editing, showToast })
const minimap = useMiniMap({ editing: detail.editing, selected, updateCoordLocale: locale.updateCoordLocale })
const photos = useReportPhotos({ selected, activeTab, isAdmin, isOwner: feed.isOwner, showToast, confirm })
const actions = useReportActions({ feed, detail, isAdmin, user, showToast, confirm })
const { mapEl } = minimap
const { lightbox, closeLightbox, firstThumb } = photos

provide(REPORTS_CTX, { isAdmin, feed, deleted, detail, locale, minimap, photos, actions })

onMounted(async () => {
  minimap.initMap()
  await feed.mount()
})
</script>

<style scoped>
.review-container {
  padding: 20px; color: #eee; background: #1e1e1e;
  height: calc(100svh - var(--topbar-h, 0px));   /* small viewport on mobile */
  display: flex; flex-direction: column; overflow: hidden;
}
h1 { margin: 0 0 12px; color: #ffd700; font-size: 16px; }
.title-row { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
.loading-inline { margin-left: 8px; font-size: 12px; opacity: .85; }
.muted { opacity: .85; }
.pad { padding: 8px; }
.my-pill {
  appearance: none; border: 1px solid #444; background: #333; color: #ddd; border-radius: 999px; padding: 6px 10px; font-weight: 700; cursor: pointer;
  box-shadow: 0 1px 2px rgba(0,0,0,.25); text-decoration: none; display: inline-flex; align-items: center;
}
.my-pill.active { background: #0b57d0; color: #fff; border-color: #0b57d0; box-shadow: 0 0 0 3px rgba(11,87,208,.25) inset; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 999px; background: #ffd54f; margin-left: 6px; }

/* 3-panel grid fills the inner viewport area */
.main-grid {
  flex: 1 1 auto; min-height: 0; display: grid; gap: 12px; overflow: hidden; padding-bottom: 10px;
  grid-template-areas: "list" "info" "map";
  grid-template-columns: 1fr; grid-auto-rows: auto;
  grid-template-rows: auto minmax(0, 1fr) minmax(0, 0.5fr);
}
.left-list { background: #222; border: 1px solid #333; border-radius: 10px; display: flex; flex-direction: column; min-height: 0; grid-area: list; }
.left-list .list-title { font-weight: 700; padding: 10px 12px; border-bottom: 1px solid #333; }
.left-list .list-scroll { flex: 1 1 auto; overflow: auto; overflow-x: hidden; padding: 8px; gap: 8px; display: grid; min-height: 0; max-height: none; }
.info-card { grid-area: info; min-height: 0; }
.map-holder { height: 100%; min-height: 0; border: 1px solid #3a3a3a; border-radius: 10px; overflow: hidden; background: #a7d1e6; margin-bottom: 6px; grid-area: map; }
.leaflet-container { height: 100%; width: 100%; }
.sentinel { height: 1px; }

/* List header strip */
.tabs { display: flex; align-items: center; gap: 6px; padding: 4px; }
.tab { appearance: none; background: #2a2a2a; color: #e5e7eb; border: 1px solid #333; border-bottom: none; border-top-left-radius: 10px; border-top-right-radius: 10px; padding: 6px 10px; cursor: pointer; }
.tab.active { background: #242424; color: #ffd54f; font-weight: 700; }
.count { margin-left: 4px; }
.tabs-spacer { flex: 1 1 auto; }
.tab-icon { appearance: none; border: 1px solid #444; background: #333; color: #ddd; border-radius: 8px; padding: 4px 8px; cursor: pointer; font-size: 14px; line-height: 1; position: relative; align-items: center; justify-content: center; }
.tab-icon.active { background: #0b57d0; color: #fff; border-color: #0b57d0; }
.tab-icon .dot { position: absolute; top: -3px; right: -3px; width: 8px; height: 8px; border-radius: 50%; background: #ffd54f; }
.list-strip { appearance: none; width: 100%; text-align: left; border: none; background: transparent; color: #ffd54f; font-weight: 700; padding: 10px 12px; cursor: pointer; display: flex; align-items: center; gap: 6px; }
.list-strip .chev { margin-left: auto; }
.mobile-only { display: none; }
.tab:focus-visible, .my-pill:focus-visible { outline: 2px solid #ffd54f; outline-offset: 2px; box-shadow: 0 0 0 3px rgba(255, 213, 79, .25); }

/* Basemap toggle (top-right) + marker popup, rendered by Leaflet inside the map holder */
.basemap-toggle { display: flex; gap: 6px; background: rgba(30,30,30,.9); border: 1px solid #3a3a3a; border-radius: 10px; padding: 6px; }
.basemap-toggle .bm-btn { border: 1px solid #444; background: #2a2a2a; color: #eee; border-radius: 999px; padding: 6px 10px; font-size: 12px; cursor: pointer; }
.basemap-toggle .bm-btn.active { background: #1e90ff; border-color: #1e90ff; color: #fff; }
.pin-popup { display: flex; align-items: center; gap: 8px; }
.pin-popup .pp-coord { font-weight: 700; font-size: 12px; padding: 2px 6px; background: #222; border: 1px solid #444; border-radius: 6px; }
.pin-popup .use-coord-btn { border: 1px solid #1e90ff; background: #1e90ff; color: #fff; border-radius: 8px; padding: 6px 8px; font-size: 12px; cursor: pointer; }

/* Mobile: collapsible list pane over the detail pane, fixed map strip (#74) */
@media (max-width: 800px) {
  h1 { display: none; }
  .title-row { display: none; }
  .review-container { padding: 8px 8px 0; }
  .main-grid { display: flex; flex-direction: column; gap: 8px; padding-bottom: 8px; }
  .left-list { flex: 0 0 auto; min-height: 0; }
  .left-list.expanded { flex: 1 1 auto; }
  .left-list .list-title { display: block; padding: 0; border-bottom: none; }
  .left-list.collapsed .list-title { border-bottom: none; }
  .left-list .list-scroll { flex: 1 1 auto; max-height: none; }
  .tabs { flex-wrap: nowrap; overflow-x: auto; }
  .mobile-only { display: inline-flex; }
  .info-card { flex: 1 1 auto; min-height: 0; }
  .map-holder { flex: 0 0 22vh; height: 22vh; min-height: 0; margin-bottom: 0; }
}
/* Desktop: 2 columns → left (list over map), right (info full-height) */
@media (min-width: 800px) {
  .main-grid { grid-template-columns: minmax(280px, 340px) 1fr; grid-template-rows: auto 1fr; grid-template-areas: "list info" "map  info"; }
  .map-holder { min-height: 32vh; }
}
@media (min-width: 1000px) and (max-width: 1199px) {
  .main-grid { grid-template-columns: minmax(280px, 400px) 1fr; grid-template-areas: "list info" "map  map"; grid-template-rows: auto 1fr; }
}
/* Wide: 3 columns → list | info | map (map full-height) */
@media (min-width: 1200px) {
  .main-grid { grid-template-columns: 300px fit-content(340px) 1fr; grid-template-rows: 1fr; grid-template-areas: "list info map"; }
  .map-holder { min-height: auto; }
}
</style>
