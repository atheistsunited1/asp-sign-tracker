<template>
  <div class="deleted-page">
    <header class="top-row">
      <h1>Deleted Pins</h1>
      <div class="top-actions">
        <router-link class="pill" to="/reports">Back to Reports</router-link>
      </div>
    </header>

    <section class="filters">
      <input v-model.trim="filters.q" class="filter-input" type="text" placeholder="Search ID / text" />
      <input v-model.trim="filters.city" class="filter-input" type="text" placeholder="City" />
      <input v-model.trim="filters.state" class="filter-input" type="text" placeholder="State" />
      <label class="date-field"><span>Deleted from</span><input v-model="filters.deletedFrom" class="filter-input" type="date" /></label>
      <label class="date-field"><span>Deleted to</span><input v-model="filters.deletedTo" class="filter-input" type="date" /></label>
      <button class="btn ghost filter-reset-btn" @click="resetFilters">Reset</button>
    </section>

    <section class="layout">
      <aside class="pin-list">
        <div class="list-head">
          <strong>Deleted Pins</strong>
          <span class="muted">{{ deletedTotalLabel }}</span>
        </div>
        <div class="list-scroll">
          <button v-for="p in deletedPins" :key="p.id" class="pin-row" :class="{ active: selectedDeleted?.id === p.id }" @click="selectPin(p)">
            <div class="row-top">
              <span class="id">{{ p.friendly_id }}</span>
              <span class="muted">{{ formatDateTime(p.deleted_at) }}</span>
            </div>
            <div class="row-bottom">
              <span class="muted">{{ formatPlace(p.city, p.state) }}</span>
              <span class="text">{{ p.sign_text || 'No sign text' }}</span>
            </div>
          </button>
          <div v-if="loadingDeleted" class="muted pad">Loading deleted pins...</div>
          <div v-else-if="!deletedPins.length" class="muted pad">No deleted pins found.</div>
        </div>
      </aside>

      <section class="details" v-if="selectedDeleted">
        <div class="detail-head">
          <div>
            <div class="title-line">
              <strong>{{ selectedDeleted.friendly_id }}</strong>
              <span class="muted">{{ formatPlace(selectedDeleted.city, selectedDeleted.state) }}</span>
              <div class="head-actions">
                <button class="btn success review-restore-btn" :disabled="busyRestore" @click="runRestore">{{ busyRestore ? 'Restoring...' : 'Review and Restore Pin' }}</button>
                <button class="btn danger pin-force-btn" @click="openForceDeletePin">Force Delete (PIN + ACTIVITIES + PHOTOS)</button>
              </div>
            </div>
            <div class="muted">Deleted: {{ formatDateTime(selectedDeleted.deleted_at) }} - Coords: {{ form.coords }}</div>
          </div>
        </div>
        <PinRestoreForm />
        <DeletedActivitiesCard />
      </section>
      <section class="details empty" v-else>
        <div class="muted">Select a deleted pin to review restore options.</div>
      </section>
    </section>

    <ForceDeleteModal />
    <RestorePreviewModal />
    <Lightbox :open="viewer.open" :url="viewer.items[viewer.index] || ''" alt="Activity photo" :title="viewer.title" :index="viewer.index" :count="viewer.items.length" @close="closePhotoViewer" @prev="prevPhoto" @next="nextPhoto" />
  </div>
</template>

<script setup>
// Deleted pins page: list (shared useDeletedPins) + per-activity restore preview
// + force delete. Composables are provided to the cards/modals via DELETED_PINS_CTX.
import { ref, reactive, computed, inject, watch, onBeforeUnmount, provide } from 'vue'
import { useToast } from '@/shared/ui/useToast'
import Lightbox from '@/shared/ui/Lightbox.vue'
import { formatDateTime } from '@/shared/lib/date'
import { formatPlace } from '@/shared/lib/place'
import { toPublicUrl } from '@/shared/data/photoStorage'
import { useDeletedPins } from '@/shared/domain/useDeletedPins'
import { DELETED_PINS_CTX } from '@/pages/deleted-pins/context'
import { useRestorePreview } from '@/pages/deleted-pins/useRestorePreview'
import { useForceDelete } from '@/pages/deleted-pins/useForceDelete'
import PinRestoreForm from '@/pages/deleted-pins/components/PinRestoreForm.vue'
import DeletedActivitiesCard from '@/pages/deleted-pins/components/DeletedActivitiesCard.vue'
import ForceDeleteModal from '@/pages/deleted-pins/components/ForceDeleteModal.vue'
import RestorePreviewModal from '@/pages/deleted-pins/components/RestorePreviewModal.vue'

const user = inject('user', ref(null))
const { show: showToast } = useToast()
const actorId = () => user?.value?.id || null

// --- filters (debounced) ----------------------------------------------------------
const filters = reactive({ q: '', city: '', state: '', deletedFrom: '', deletedTo: '' })
let filterDebounceHandle = null
watch(() => [filters.q, filters.city, filters.state, filters.deletedFrom, filters.deletedTo], () => {
  if (filterDebounceHandle) clearTimeout(filterDebounceHandle)
  filterDebounceHandle = setTimeout(() => reload(), 220)
})
onBeforeUnmount(() => { if (filterDebounceHandle) clearTimeout(filterDebounceHandle) })
function resetFilters() { Object.assign(filters, { q: '', city: '', state: '', deletedFrom: '', deletedTo: '' }); reload() }

// --- photo viewer -------------------------------------------------------------------
const viewer = reactive({ open: false, title: '', items: [], index: 0 })
function openPhotoViewerForReport(report, startIndex = 0) {
  const photos = Array.isArray(report?.displayPhotos) ? report.displayPhotos : []
  if (!photos.length) return
  viewer.items = photos.map((p) => p.image_url).filter(Boolean)
  viewer.index = Math.min(Math.max(0, Number(startIndex) || 0), viewer.items.length - 1)
  viewer.title = `Activity ${String(report?.id || '').slice(0, 8)}`
  viewer.open = true
}
function closePhotoViewer() { Object.assign(viewer, { open: false, title: '', items: [], index: 0 }) }
function nextPhoto() { if (viewer.items.length) viewer.index = (viewer.index + 1) % viewer.items.length }
function prevPhoto() { if (viewer.items.length) viewer.index = (viewer.index - 1 + viewer.items.length) % viewer.items.length }

// --- list (shared), restore preview, force delete -------------------------------------
const list = useDeletedPins({
  isMapmasterOrHigher: ref(true),                // the route is mapmaster-only (router guard)
  actorId,
  getFilters: () => filters,
  pageSize: 250,
  showToast, confirm: () => Promise.resolve(false),
  hooks: { onSelect: (pin) => { closePhotoViewer(); restore.resetFormFromPin(pin) } },
})
const { deletedPins, deletedTotal, loadingDeleted, selectedDeleted, deletedReports, loadingDeletedReports, loadDeletedPage, selectDeletedPin, clearDeletedSelection } = list
const displayReports = computed(() => deletedReports.value.map((report) => ({
  ...report,
  displayPhotos: (Array.isArray(report?.photos) ? report.photos : [])
    .map((p) => ({ id: p?.id || p?.image_url || '', image_url: toPublicUrl(p?.image_url) }))
    .filter((p) => !!p.image_url),
})))
const deletedTotalLabel = computed(() => (Number.isFinite(deletedTotal.value) ? `${deletedTotal.value} total` : '-'))

const reload = () => loadDeletedPage(true, { keepSelection: true })
const selectPin = (pin) => selectDeletedPin(pin)

const restore = useRestorePreview({
  selectedPin: selectedDeleted, deletedReports, actorId, showToast,
  afterRestore: async () => { clearDeletedSelection(); await loadDeletedPage(true) },
})
const { form, busyRestore, runRestore } = restore

const forceDelete = useForceDelete({
  selectedPin: selectedDeleted, showToast,
  afterPinDeleted: async () => { clearDeletedSelection(); await loadDeletedPage(true) },
  afterReportDeleted: async (pinId) => { const pin = deletedPins.value.find((p) => p.id === pinId) || selectedDeleted.value; if (pin) await selectDeletedPin(pin) },
})
const { openForceDeletePin } = forceDelete

provide(DELETED_PINS_CTX, {
  list: { ...list, displayReports },
  restore, forceDelete,
  viewer: { viewer, openPhotoViewerForReport, closePhotoViewer, nextPhoto, prevPhoto },
})

loadDeletedPage(true)
</script>

<style scoped>
.deleted-page { padding: 16px; color: #eee; background: #1e1e1e; height: calc(100svh - var(--topbar-h, 0px)); min-height: 0; display: grid; grid-template-rows: auto auto 1fr; gap: 10px; overflow: hidden; }
.top-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.top-row h1 { margin: 0; font-size: 18px; color: #ffd54f; }
.filters { display: grid; gap: 8px; grid-template-columns: minmax(180px, 260px) repeat(2, minmax(110px, 150px)) repeat(2, minmax(110px, 140px)) auto; align-items: end; justify-content: start; }
.filter-input { min-height: 30px; padding: 5px 7px; font-size: 12px; }
.date-field { display: grid; gap: 4px; font-size: 12px; color: #bbb; max-width: 140px; }
.filter-reset-btn { min-height: 30px; min-width: 74px; padding: 4px 10px; align-self: end; }
.layout { min-height: 0; display: grid; grid-template-columns: 320px minmax(520px, 820px); justify-content: start; gap: 10px; overflow: hidden; }
.pin-list, .details { background: #252525; border: 1px solid #333; border-radius: 10px; min-height: 0; overflow: hidden; height: 100%; }
.pin-list { display: grid; grid-template-rows: auto 1fr; }
.list-head { padding: 10px; border-bottom: 1px solid #333; display: flex; justify-content: space-between; }
.list-scroll { overflow: auto; padding: 8px; display: grid; gap: 8px; align-content: start; grid-auto-rows: max-content; }
.pin-row { width: 100%; text-align: left; border: 1px solid #3b3b3b; background: #2d2d2d; color: #eee; border-radius: 8px; padding: 8px; display: grid; gap: 6px; max-height: 98px; overflow: hidden; }
.pin-row.active { border-color: #ffd54f; box-shadow: 0 0 0 2px rgba(255, 213, 79, 0.2) inset; }
.row-top { display: flex; justify-content: space-between; gap: 8px; }
.row-bottom { display: grid; gap: 4px; }
.text { font-size: 12px; }
.details { display: grid; grid-template-rows: auto; grid-auto-rows: max-content; align-content: start; gap: 10px; padding: 10px; overflow: auto; }
.details.empty { display: grid; place-items: center; }
.detail-head { display: flex; justify-content: flex-start; align-items: flex-start; gap: 8px; }
.title-line { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.head-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.review-restore-btn { font-weight: 700; white-space: nowrap; }
.pin-force-btn { margin-left: 12px; font-weight: 700; padding: 8px 12px; letter-spacing: 0.1px; white-space: nowrap; }
label { display: grid; gap: 4px; font-size: 12px; color: #c9c9c9; }
input, select, textarea { width: 100%; box-sizing: border-box; border-radius: 6px; border: 1px solid #444; background: #171717; color: #eee; padding: 7px 8px; }
.btn { border: 1px solid #555; background: #3b3b3b; color: #fff; border-radius: 8px; padding: 6px 10px; cursor: pointer; }
.btn.ghost { background: #2d2d2d; }
.btn.success { background: #2b8c3e; border-color: #2b8c3e; }
.btn.danger { background: #c64956; border-color: #c64956; }
.pill { text-decoration: none; border: 1px solid #4b4b4b; border-radius: 999px; padding: 6px 10px; color: #eee; background: #2f2f2f; }
.muted { color: #bdbdbd; font-size: 12px; }
.pad { padding: 8px; }
.id { font-weight: 600; }
@media (max-width: 980px) {
  .filters { grid-template-columns: repeat(2, minmax(120px, 1fr)); }
  .layout { grid-template-columns: 1fr; grid-template-rows: minmax(220px, 300px) 1fr; }
  .pin-force-btn { margin-left: 0; width: 100%; }
  .review-restore-btn { width: 100%; }
  .head-actions { width: 100%; margin-left: 0; }
}
</style>
