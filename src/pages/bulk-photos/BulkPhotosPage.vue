<!-- Bulk photo reports: one draft per photo, submitted through the shared activity-submission pipeline. -->

<template>
    <div class="bulk-photo-reports">
        <div class="bulk-wrap">
            <!-- Not "topbar": App.vue's global .topbar rule is position:fixed
                 and would rip this header out of the page flow. -->
            <header class="bulk-topbar">
            <h2>📷 Bulk Photo Reports</h2>
            <div class="actions">
                <input
                ref="fileInput"
                type="file"
                accept="image/*"
                multiple
                style="display:none"
                @change="onPickFiles"
                />
                <button class="btn" @click="pickPhotos">Select photos</button>
                <span class="muted" v-if="items.length">({{ items.length }} selected)</span>
            </div>
            </header>

            <div class="grid">
            <!-- Photo list: sidebar on desktop, horizontal strip on mobile -->
            <aside class="left">
                <div class="list">
                <button
                    v-for="it in items"
                    :key="it.id"
                    class="row"
                    :class="{ active: it.id===selectedId, submitted: it.submitted }"
                    @click="selectItem(it.id)"
                    :title="baseName(it.file?.name)"
                >
                    <div class="thumb-wrap">
                        <img :src="it.url" alt="" class="thumb" loading="lazy" />
                        <!-- Badges only once status changes; unsubmitted photos stay clean. -->
                        <span v-if="it.submitted" class="badge ok" title="Submitted">✔</span>
                        <span v-if="it.photoPending" class="badge photo" title="Photo not attached yet">📎</span>
                    </div>

                    <div class="meta">
                        <div class="name">{{ baseName(it.file?.name) }}</div>
                        <div class="sub">
                            <span v-if="hasGps(it)">📍 EXIF</span>
                            <span v-else>—</span>
                            <span class="dot">•</span>
                            <span>{{ bytes(it.file?.size) }}</span>
                        </div>
                    </div>
                </button>
                <div v-if="!items.length" class="empty">No photos selected.</div>
                </div>
            </aside>

            <!-- Form for the selected photo -->
            <section class="right" v-if="current">
                <div class="head">
                <div class="title">
                    <strong>{{ baseName(current.file?.name) }}</strong>
                    <span class="muted" v-if="current.submitted">— submitted</span>
                </div>
                <button
                    class="head-x"
                    title="Remove this photo"
                    aria-label="Remove this photo"
                    :disabled="submitting"
                    @click="removeItem(current.id)"
                >×</button>
                </div>

                <div class="content">
                <div class="photo-col">
                    <div class="photo-preview">
                    <img :src="current.url" alt="" :style="{ transform: `rotate(${current.rotation || 0}deg)` }" />
                    </div>
                    <button
                    v-if="!current.submitted || current.photoPending"
                    class="btn sm"
                    title="Rotate 90° clockwise"
                    @click="rotateCurrent"
                    >↻ Rotate</button>
                </div>

                <div class="fields">
                    <div class="field signtext-wrap">
                    <label>Sign Text</label>
                    <input
                        type="text"
                        v-model="draft.signText"
                        :readonly="readonly"
                        @focus="!readonly && openSuggest()"
                        @input="!readonly && openSuggest()"
                        @keydown.down.prevent="moveSel(1)"
                        @keydown.up.prevent="moveSel(-1)"
                        @keydown.enter.prevent="applySel()"
                        @blur="closeSuggestSoon()"
                    />
                    <ul v-if="showSuggest && filteredSuggestions.length" class="suggest-list">
                        <li
                        v-for="(s, i) in filteredSuggestions"
                        :key="s.text"
                        :class="{ active: i === selIndex }"
                        @mousedown.prevent="chooseSuggestion(s)"
                        @mouseenter="selIndex = i"
                        >
                        {{ s.text }}
                        </li>
                    </ul>
                    </div>

                    <div class="field">
                    <label>Activity Type</label>
                    <div class="seg">
                        <label v-for="o in rtOpts" :key="o.v" class="seg-item">
                        <input
                            type="radio"
                            name="rt"
                            :value="o.v"
                            v-model="draft.reportType"
                            :disabled="readonly"
                        />
                        <span>{{ o.l }}</span>
                        </label>
                    </div>
                    </div>

                    <div class="field">
                    <label>Sign Type</label>
                    <div class="seg small">
                        <label v-for="o in stOpts" :key="o.v" class="seg-item">
                        <input
                            type="radio"
                            name="st"
                            :value="o.v"
                            v-model="draft.signType"
                            :disabled="readonly"
                        />
                        <span>{{ o.l }}</span>
                        </label>
                    </div>
                    </div>

                    <div class="field">
                    <label>Description</label>
                    <input
                        type="text"
                        v-model="draft.locationDescription"
                        :readonly="readonly"
                        placeholder="How to find it on site — pole, corner, anything unusual"
                    />
                    </div>

                    <div class="field">
                    <label>
                        Coordinates
                        <span v-if="coordPlace !== undefined" class="muted"> ({{ coordPlace || 'unknown' }})</span>
                    </label>
                    <div class="coord-row">
                        <input
                        type="text"
                        v-model="draft.coords"
                        :readonly="readonly"
                        @change="onCoordsChange"
                        placeholder="Enter GPS coordinates <LAT, LNG>"
                        />
                        <button
                        v-if="hasGps(current)"
                        class="btn icon sm"
                        :disabled="readonly || coordsMatchExif"
                        @click="restoreGps"
                        title="Restore coordinates from photo GPS"
                        >📍↺</button>
                        <button class="btn icon sm" :disabled="readonly" @click="copyCoords" title="Copy coords">📋</button>
                        <a
                        class="btn icon sm"
                        :href="mapsLinkFrom(draft.coords)"
                        target="_blank"
                        rel="noopener"
                        title="Open in Google Maps"
                        >🗺️</a>
                    </div>
                    </div>
                </div>
                </div>

                <div class="action-bar">
                <div class="bar-left">
                    <button class="btn sm" :disabled="readonly" @click="copyFields" title="Copy sign text, activity type, and sign type">📄 Copy</button>
                    <button class="btn sm" :disabled="readonly || !copyBuffer" @click="pasteFields" title="Paste sign text, activity type, and sign type">📥 Paste</button>
                </div>
                <div class="bar-right">
                    <button
                    v-if="current.submitted && current.photoPending"
                    class="btn sm"
                    :disabled="submitting"
                    @click="retryPhoto"
                    title="Attach photo"
                    >📎 Attach photo</button>

                    <button
                    v-if="!current.submitted"
                    class="btn primary"
                    :disabled="submitting || !canSubmit"
                    @click="handleSubmit"
                    >
                    {{ submitting ? 'Submitting…' : '🚀 Submit' }}
                    </button>

                    <template v-else>
                    <button
                        v-if="!editMode"
                        class="btn"
                        @click="enterEdit"
                        :disabled="submitting"
                    >✏️ Edit</button>

                    <template v-else>
                        <button class="btn" @click="cancelEdit" :disabled="submitting">✖ Cancel</button>
                        <button class="btn primary" @click="handleUpdate" :disabled="submitting || !editDirty">✅ Update</button>
                    </template>
                    </template>
                </div>
                </div>

              </section>

            <section class="right empty-pane" v-else>
                <p class="muted">Select a photo from the list to start a report.</p>
            </section>
            </div>
        </div>

        <NearbyPinSelector
          :visible="showPinSelector"
          :coords="pendingSubmit ? formatCoords(pendingSubmit.lat, pendingSubmit.lng) : ''"
          :nearbyPins="nearbyPins"
          @selectExisting="onSelectExistingPin"
          @confirmNew="onConfirmNewPin"
          @cancel="onSelectorCancel"
        />
    </div>
</template>


<script setup>
// Bulk photo reports: wiring only. Items/drafts live in useBulkItems, the
// submit/update flow in useBulkSubmit over the shared submission + photo pipelines.
import { inject } from 'vue'
import NearbyPinSelector from '@/shared/domain/NearbyPinSelector.vue'
import { useToast } from '@/shared/ui/useToast'
import { useAutosuggest } from '@/shared/ui/useAutosuggest'
import { SIGN_TEXT_SUGGESTIONS_WITH_COUNTS as SUGS } from '@/shared/data/signTextSuggestionsWithCounts'
import { makeClientLogger } from '@/shared/data/telemetry'
import { ACTIVITY_TYPE_OPTIONS as rtOpts, SIGN_TYPE_OPTIONS as stOpts } from '@/shared/domain/activityOptions'
import { useBulkItems } from '@/pages/bulk-photos/useBulkItems'
import { useBulkSubmit } from '@/pages/bulk-photos/useBulkSubmit'

const user = inject('user')
const { show: showToast } = useToast()
const logClient = makeClientLogger('bulk_photo_reports', user)

const bulk = useBulkItems({ showToast, closeSuggest: () => { showSuggest.value = false } })
const flow = useBulkSubmit({ bulk, user, showToast, logClient })

// Template bindings
const {
  fileInput, items, selectedId, copyBuffer, editMode, current, draft, readonly, editDirty, canSubmit,
  signTextModel, coordsMatchExif, baseName, bytes, hasGps, pickPhotos, onPickFiles, selectItem, removeItem,
  copyFields, pasteFields, coordPlace, onCoordsChange, rotateCurrent, restoreGps, copyCoords, mapsLinkFrom,
  enterEdit, cancelEdit,
} = bulk
const {
  submitting, showPinSelector, nearbyPins, pendingSubmit,
  handleSubmit, onConfirmNewPin, onSelectExistingPin, onSelectorCancel, retryPhoto, handleUpdate,
} = flow

// Sign-text typeahead over the selected photo's draft
const {
  items: filteredSuggestions,
  openList: showSuggest,
  selIndex,
  open: openSuggest,
  closeSoon: closeSuggestSoon,
  move: moveSel,
  apply: applySel,
  choose: chooseSuggestion,
} = useAutosuggest(signTextModel, {
  items: () => SUGS.map(s => ({ text: s.sign_text, n: s.n })),
  max: 8,
  sortByCount: true,
})
</script>
<style scoped>
.bulk-wrap{
  padding:12px;
  height: calc(100svh - var(--topbar-h,0px));
  display:flex; flex-direction:column; gap:10px;
  background:#1e1e1e; color:#eee;
}
.bulk-topbar{
  display:flex; align-items:center; justify-content:space-between; gap:8px;
  flex-wrap:wrap;
}
h2{ margin:0; font-size:16px; color:#ffd54f; }
.actions{ display:flex; align-items:center; gap:8px; }
.muted{ opacity:.85; }

.grid{
  flex:1 1 auto; min-height:0;
  display:grid; gap:10px;
  grid-template-columns: minmax(240px, 340px) 1fr;
  grid-template-areas: "left right";
}

.left{
  grid-area:left;
  background:#222; border:1px solid #333; border-radius:10px;
  display:flex; flex-direction:column; min-height:0; min-width:0;
}
.list{
  padding:8px; overflow:auto; min-height:0; display:grid; gap:8px;
}
.row{
  display:grid; grid-template-columns:auto 1fr; gap:10px;
  align-items:center; text-align:left;
  background:#262626; border:1px solid #3a3a3a; border-radius:8px;
  padding:8px; color:#ddd; cursor:pointer;
}
.row:hover{ background:#2d2d2d; }
.row.active{ border-color:#ffd700; box-shadow:0 0 0 2px rgba(255,215,0,.15) inset; }
.row.submitted{ border-color:#2b7a3f; }
.thumb-wrap{ position:relative; width:64px; }
.thumb{
  width:64px; height:48px; object-fit:cover; border-radius:6px; border:1px solid #3a3a3a; background:#2a2a2a;
}
.badge{
  position:absolute; top:4px; right:4px; padding:2px 6px; font-size:11px; border-radius:999px;
  border:1px solid #444; background:rgba(32,32,32,.85);
}
.badge.ok{ background:#2e7d32; color:#fff; border-color:#2e7d32; }
.badge.photo{ top:auto; bottom:4px; background:#444; color:#ddd; }
.meta{ min-width:0; }
.name{ font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.sub{ font-size:12px; opacity:.85; display:flex; align-items:center; gap:6px; }
.dot{ opacity:.6; }

.right{
  grid-area:right;
  background:#2a2a2a; border:1px solid #3a3a3a; border-radius:10px;
  display:grid; grid-template-rows:auto 1fr auto; min-height:0; min-width:0; overflow:hidden;
}
.empty{ padding:12px; opacity:.8; }
.empty-pane{ display:grid; place-items:center; }

.head{
  display:flex; align-items:center; justify-content:space-between; gap:8px;
  padding:10px 12px; border-bottom:1px solid #3a3a3a;
}
.title{ display:flex; gap:8px; align-items:center; min-width:0; }
.title strong{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

.content{
  display:grid; grid-template-columns: 220px 1fr; gap:12px;
  padding:12px; min-height:0; overflow:auto;
}
.photo-col{ display:flex; flex-direction:column; gap:8px; align-items:center; }
/* Square, centered stage: any 90°-rotated contained image stays in bounds */
.photo-preview{
  width:100%; aspect-ratio:1; display:grid; place-items:center;
  border-radius:8px; border:1px solid #3a3a3a; background:#111; overflow:hidden;
}
.photo-preview img{
  max-width:100%; max-height:100%; width:auto; height:auto;
  transition: transform .15s ease;
}
/* minmax(0,1fr) column: without it the implicit auto column grows to the
   nowrap chip rail's intrinsic width instead of letting it scroll */
.fields{ display:grid; grid-template-columns:minmax(0,1fr); gap:10px; min-width:0; }

.field{ display:flex; flex-direction:column; gap:6px; min-width:0; }
label{ font-size:12px; color:#bbb; letter-spacing:.02em; }
input[type="text"], textarea{
  width:100%; padding:10px 12px; border:1px solid #444; border-radius:8px;
  background:#222; color:#eee; font-size:14px; outline:none; box-sizing:border-box;
}
textarea{ resize:vertical; line-height:1.25; height: calc(1em * 1.25 * 3); }
input:focus, textarea:focus{ border-color:#1e90ff; box-shadow:0 0 0 3px rgba(30,144,255,.15); }

/* Chip rail: one row, side-scrolling — chips never wrap into extra rows */
.seg{
  display:flex; flex-wrap:nowrap; gap:6px;
  overflow-x:auto; scroll-snap-type:x proximity;
  -webkit-overflow-scrolling:touch;
  scrollbar-width:none;
  padding-bottom:2px;
}
.seg::-webkit-scrollbar{ display:none; }
.seg-item{ position:relative; flex:0 0 auto; scroll-snap-align:start; }
.seg-item input{ position:absolute; inset:0; opacity:0; cursor:pointer; }
.seg-item span{
  display:inline-block; padding:8px 12px; border:1px solid #444; border-radius:999px;
  background:#222; color:#eee; user-select:none; font-size:12px; white-space:nowrap;
}
.seg.small .seg-item span{ padding:6px 10px; }
.seg-item input:checked + span{ background:#1e90ff; color:#fff; border-color:#1e90ff; }

.coord-row{ display:flex; gap:8px; align-items:center; }
/* Inside the flex row the input must shrink, not keep width:100% */
.coord-row input{ flex:1 1 auto; width:auto; min-width:0; }

/* Autosuggest under the Sign Text input (same look as ReportForm) */
.signtext-wrap { position: relative; }
.suggest-list {
  position: absolute;
  left: 0; right: 0;
  top: calc(100% + 4px);
  z-index: 10;
  max-height: 220px;
  overflow: auto;
  background: #ffffff;
  border: 1px solid #c9c9c9;
  border-radius: 8px;
  box-shadow: 0 6px 18px rgba(0,0,0,0.10);
  padding: 4px;
  margin: 0;
  list-style: none;
  color: #1f2937;
}
.suggest-list li {
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  line-height: 1.2;
  color: #1f2937;
  font-weight: 500;
}
.suggest-list li:hover,
.suggest-list li.active {
  background: #eaf3ff;
  color: #0b57d0;
}
.suggest-list li + li {
  border-top: 1px solid #f2f2f2;
}
.btn{
  display:inline-flex; align-items:center; gap:6px;
  padding:8px 12px; border-radius:8px; border:1px solid #555; background:#444; color:#fff; cursor:pointer;
}
.btn:disabled{ opacity:.5; cursor:default; }
.btn.primary{ background:#1e90ff; border-color:#1e90ff; }
.btn.icon.sm{ padding:6px 8px; font-size:12px; border-radius:8px; }
.btn.sm{ padding:6px 10px; font-size:13px; }

/* Sticky action bar: bottom row of the form panel on all sizes */
.action-bar{
  display:flex; align-items:center; justify-content:space-between; gap:8px;
  padding:10px 12px; border-top:1px solid #3a3a3a; background:#262626;
}
.bar-left, .bar-right{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; }

/* ===== Mobile: horizontal thumbnail strip + thumb-reachable actions ===== */
@media (max-width: 1000px){
  .bulk-wrap{ padding:8px; overflow-x:hidden; }
  .grid{
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto 1fr;
    grid-template-areas: "left" "right";
  }
  .content{ grid-template-columns: 1fr; }

  /* 16px inputs stop iOS Safari from zooming the viewport on focus,
     which left the page panned wider than the screen. */
  input[type="text"], textarea, select{ font-size:16px; }

  /* Right-edge fade hints that the chip rail scrolls */
  .seg{
    mask-image: linear-gradient(to right, black calc(100% - 24px), transparent);
    -webkit-mask-image: linear-gradient(to right, black calc(100% - 24px), transparent);
  }
  /* Cap the square stage's footprint on small screens */
  .photo-preview{ width:auto; max-width:100%; height:26vh; aspect-ratio:1; margin:0 auto; }

  /* One-row side-scrolling strip instead of a tall list */
  .left{ flex:0 0 auto; }
  .list{
    display:flex; flex-direction:row; gap:8px;
    overflow-x:auto; overflow-y:hidden;
    -webkit-overflow-scrolling: touch;
  }
  .row{
    grid-template-columns:auto; flex:0 0 auto;
    padding:6px;
  }
  .meta{ display:none; }
  .thumb-wrap{ width:56px; }
  .thumb{ width:56px; height:42px; }
}
/* remove button, flush right in the details-card name row */
.head-x{
  flex:0 0 auto;
  width:26px; height:26px;
  border-radius:50%;
  border:1px solid #4a4a4a;
  background:#2a2a2a;
  color:#ddd;
  font-size:16px; line-height:1;
  padding:0;
  cursor:pointer;
  display:inline-grid;
  place-items:center;
}
.head-x:hover{
  background:#343434;
  border-color:#5a5a5a;
  color:#fff;
}
.head-x:disabled{ opacity:.5; cursor:default; }

</style>
