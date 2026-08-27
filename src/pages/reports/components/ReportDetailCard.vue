<template>
  <!-- Root is the .info-card grid cell so the page layout rules still apply. -->
  <section class="info-card" v-if="selected">
    <template v-for="r in [selected]" :key="r.id">
      <!-- Compact sticky head: identity only; submitter/approver live in the scroll body -->
      <div class="info-head">
        <div class="id-date">
          <div class="ids">
            <span v-if="r.pin_friendly_id" class="badge">Pin ID: {{ r.pin_friendly_id }}</span>
            <span v-if="editing.is_major_campaign" class="badge badge-major" title="Marked as major campaign">Major campaign</span>
            <span class="time">📅 {{ formatDateOnly(r.occurred_on || r.created_at) }}</span>
          </div>
        </div>
      </div>

      <!-- Action bar: below the head on desktop, sticky bottom bar on mobile -->
      <div class="action-bar actions">
        <span class="edit-first" v-if="(activeTab==='approved' && isMapmasterOrHigher) || (activeTab==='submitted' && (isMapmasterOrHigher || isOwner))">
          <template v-if="!editMode">
            <button class="ghost" @click="enterEdit">✏️ Edit</button>
          </template>
          <template v-else>
            <button class="approve" :disabled="!editDirty" @click="saveEdits">✅ Save</button>
            <button class="ghost" :disabled="!editDirty" @click="resetEditForm" title="Discard unsaved changes to this pin's details">Reset details</button>
            <button class="ghost" @click="cancelEdit">Cancel</button>
          </template>
        </span>

        <!-- ADD PHOTOS (admin on Approved; admin/owner on Submitted) -->
        <button
          v-if="remainingSlots(r) > 0 && canAddPhotos"
          class="ghost"
          :disabled="busy[r.id]"
          @click.stop="triggerExtraPhotos(r.id)"
          :title="`You can add ${remainingSlots(r)} more`"
        >📸 Add photos</button>
        <span class="muted" v-if="uploadingPhotos">Uploading {{ uploadProgress.done }}/{{ uploadProgress.total }}…</span>
        <input :id="`extra-files-${r.id}`" type="file" accept="image/*" multiple style="display:none" @change="onExtraPhotosChange(r.id, $event)" />

        <template v-if="activeTab==='submitted' && isMapmasterOrHigher">
          <button v-if="!disableApprove(r)" class="approve" :disabled="busy[r.id]" @click.stop="onApprove(r)">✅ Approve</button>
          <button class="danger" :disabled="busy[r.id]" @click.stop="onDeleteSubmitted(r.id)">🗑 Delete</button>
        </template>
        <template v-if="activeTab==='approved' && isMapmasterOrHigher">
          <button class="danger" :disabled="busy[r.id]" @click.stop="onDeleteApproved(r.id)">🗑 Delete</button>
        </template>
      </div>

      <!-- Only the content below scrolls -->
      <div class="info-scroll">
        <div class="desc">
          <div class="meta-lines">
            <div class="byline" title="Submitter">👤 Submitted by: <strong>{{ r.submitter_username || 'anonymous' }}</strong></div>
            <div class="byline" title="Approver">✅ Approved by: <strong>{{ r.approver_username || '-' }}</strong></div>
          </div>

          <!-- Major Campaign -->
          <div class="field inline-field">
            <label class="lbl inline">Major Campaign</label>
            <div class="seg small w300">
              <label class="seg-item">
                <input type="radio" :name="`mc-${r.id}`" :value="false" v-model="editing.is_major_campaign" :disabled="!editMode" />
                <span>No</span>
              </label>
              <label class="seg-item">
                <input type="radio" :name="`mc-${r.id}`" :value="true" v-model="editing.is_major_campaign" :disabled="!editMode" />
                <span>Yes</span>
              </label>
            </div>
          </div>

          <div class="form-2col">
            <!-- Activity Type -->
            <div class="field">
              <label class="lbl">Activity Type</label>
              <div class="seg w300">
                <label v-for="opt in rtOpts" :key="opt.v" class="seg-item" :class="{ disabled: opt.v==='sighting' && isFinalLifecycle(r.report_type) }">
                  <input type="radio" :name="`rt-${r.id}`" :value="opt.v" v-model="editing.report_type" :disabled="!editMode || (opt.v==='sighting' && isFinalLifecycle(r.report_type))" />
                  <span>{{ opt.l }}</span>
                </label>
              </div>
            </div>

            <!-- Sign Type -->
            <div class="field">
              <label class="lbl">Sign Type</label>
              <div class="seg small w300">
                <label v-for="opt in stOpts" :key="opt.v" class="seg-item">
                  <input type="radio" :name="`st-${r.id}`" :value="opt.v" v-model="editing.sign_type_edit" :disabled="!editMode" />
                  <span>{{ opt.l }}</span>
                </label>
              </div>
            </div>

            <div class="field">
              <label class="lbl">Sign Text</label>
              <input class="w300" type="text" v-model="editing.sign_text_edit" :readonly="!editMode" />
            </div>

            <div class="field">
              <template v-if="r.pin_is_approved">
                <label class="lbl">Description</label>
                <div class="muted w300">{{ r.pin_description || '—' }}</div>
              </template>
              <template v-else>
                <label class="lbl">Description (how to find it on site)</label>
                <input class="w300" type="text" v-model="editing.description" />
              </template>
            </div>

            <div class="field">
              <label class="lbl">City</label>
              <input class="w300" type="text" v-model="editing.city" :readonly="!editMode" placeholder="City" />
            </div>
            <div class="field">
              <label class="lbl">State / Region</label>
              <input class="w300" type="text" v-model="editing.state" :readonly="!editMode" placeholder="State / Region" />
            </div>

            <!-- Most Recent GSV Date -->
            <div class="field">
              <label class="lbl">Most Recent GSV Date</label>
              <div class="field-pair gsv-pair">
                <select v-model="gsvMonth" :disabled="!editMode || submitting">
                  <option value="">Month</option>
                  <option v-for="(m, i) in MONTHS" :key="m" :value="i+1">{{ m }}</option>
                </select>
                <select v-model="gsvYear" :disabled="!editMode || submitting">
                  <option value="">Year</option>
                  <option v-for="y in YEARS" :key="y" :value="y">{{ y }}</option>
                </select>
              </div>
              <small class="muted">Format: <code>Mmm YYYY</code> (e.g., <em>Apr 2023</em>)</small>
              <div v-if="gsvError" class="coord-error">{{ gsvError }}</div>
            </div>

            <!-- Coordinates (reverse-geocode hint appears only after the coordinates change) -->
            <div class="field field-span">
              <label class="lbl">Coordinates</label>
              <input
                class="coord w300"
                type="text"
                :value="formatCoords(editing.lat, editing.lng)"
                @input="editMode && onCoordInput($event.target.value)"
                :readonly="!editMode"
                placeholder="Enter GPS coordinates <LAT, LNG>"
                :title="formatCoords(editing.lat, editing.lng)"
              />
              <div v-if="coordsChanged" class="coord-hint" aria-live="polite">
                <template v-if="coordPlace === undefined">Looking up place…</template>
                <template v-else-if="coordHint">Near: {{ coordHint }}</template>
                <template v-else>Place unknown for these coordinates</template>
              </div>
              <div class="btn-row coord-actions">
                <button v-if="coordsChanged" class="mini" @click="editMode && resetCoords()" :disabled="!editMode" title="Restore the saved coordinates">Reset coords</button>
                <a
                  v-if="Number.isFinite(editing.lat) && Number.isFinite(editing.lng)"
                  class="mini inline-map-btn coord-action-link gmaps-btn"
                  :href="gmapsLink(editing.lat, editing.lng)"
                  target="_blank" rel="noopener" title="Open in Google Maps" aria-label="Open in Google Maps"
                >
                  <svg class="gmaps-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                    <path fill="#EA4335" d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7z"/>
                    <path fill="#4285F4" d="M12 2v20s7-7.75 7-13a7 7 0 0 0-7-7z" opacity=".9"/>
                    <circle cx="12" cy="9" r="2.6" fill="#fff"/>
                  </svg>
                </a>
                <button v-if="coordsChanged" class="mini" :disabled="!editMode || !coordHint" title="Copy the place above into City and State / Region" @click.prevent="useLocaleForCityState">Save new coordinates</button>
              </div>
              <div v-if="editing.__coordError" class="coord-error">{{ editing.__coordError }}</div>
            </div>

            <div class="field field-span" v-if="isMapmasterOrHigher">
              <label class="lbl">Pin Color</label>
              <select v-model="editing.icon_color_edit" :disabled="!editMode">
                <option v-for="opt in editingColorOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
            </div>
          </div>

          <!-- Photos -->
          <div class="field field-span photos-field">
            <label class="lbl">Photos</label>
            <div class="media-row">
              <div class="photos-scroller" v-if="submissionPhotoRows(r).length" @wheel.passive="hWheel">
                <div v-for="p in submissionPhotoRows(r)" :key="p.id || p.image_url" class="photo-wrap">
                  <img :src="p.image_url" alt="submitted photo" @click="openLightbox(p.image_url)" title="Click to view" />
                  <button v-if="canDeletePhotos" class="del-btn" @click.stop="deleteUsrPhoto(r.id, p)" title="Delete photo">✖</button>
                </div>
              </div>
              <div v-else class="photos-empty">No photos</div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup>
// Detail card for the selected activity: identity, action bar, editable fields, photos.
// Everything comes from the page's composables via the REPORTS_CTX injection.
import { inject } from 'vue'
import { REPORTS_CTX } from '@/pages/reports/context'
import { formatDateOnly } from '@/shared/lib/date'
import { formatCoords } from '@/shared/lib/coords'

const ctx = inject(REPORTS_CTX)
const { isMapmasterOrHigher } = ctx
const { selected, activeTab, isOwner } = ctx.feed
const {
  editing, editMode, editDirty, submitting, enterEdit, resetEditForm, cancelEdit,
  MONTHS, YEARS, rtOpts, stOpts, gsvMonth, gsvYear, gsvError, editingColorOptions, coordsChanged,
} = ctx.detail
const {
  canAddPhotos, canDeletePhotos, uploadingPhotos, uploadProgress, remainingSlots, submissionPhotoRows,
  triggerExtraPhotos, onExtraPhotosChange, deleteUsrPhoto, openLightbox, hWheel,
} = ctx.photos
const { busy, disableApprove, isFinalLifecycle, saveEdits, onApprove, onDeleteSubmitted, onDeleteApproved } = ctx.actions
const { coordPlace, coordHint, useLocaleForCityState } = ctx.locale
const { onCoordInput, resetCoords, gmapsLink } = ctx.minimap
</script>

<style scoped>
.info-card {
  background: #2a2a2a; border: 1px solid #3a3a3a; border-radius: 10px; padding: 12px; min-height: 0;
  display: grid; grid-template-rows: auto auto 1fr; overflow: hidden;
}
.info-card, .info-head, .desc { min-width: 0; }
.info-card, .info-scroll, .desc { overflow-x: hidden; }
.info-head {
  display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 8px; padding-bottom: 8px;
  border-bottom: 1px solid #3a3a3a; position: sticky; top: 0; background: #2a2a2a; z-index: 1;
}
.id-date .ids { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
.ids { margin-top: 6px; display: flex; gap: 6px; flex-wrap: wrap; }
.badge { background: #444; color: #ffd700; padding: 2px 6px; border-radius: 6px; font-size: .8em; }
.badge-major { background: #3a2f00; color: #ffd54f; border: 1px solid #6a5715; }
.time { font-size: .9em; opacity: .8; }
.muted { opacity: .85; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-start; }
.edit-first { order: -1; }
.approve { background: #28a745; color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; }
.approve:disabled, .approve.disabled { background: #555; color: #ddd; border: 1px solid #666; cursor: not-allowed; opacity: .9; }
.danger { background: #ef5a67; color: #111; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; }
.danger:hover { background: #e74c59; }
.ghost { background: #444; color: #fff; border: 1px solid #555; padding: 6px 10px; border-radius: 6px; cursor: pointer; }
.ghost:hover { background: #4d4d4d; }
.mini { padding: 4px 6px; border: 1px solid #444; background: #303030; color: #eee; border-radius: 6px; cursor: pointer; }
.mini:hover { background: #383838; }
.info-scroll { min-height: 0; overflow: auto; overflow-x: hidden; }
.desc { margin: 10px 0; white-space: pre-wrap; overflow-x: hidden; }
.desc input, .desc textarea, .desc select { width: 100%; box-sizing: border-box; padding: 6px 8px; border-radius: 6px; border: 1px solid #444; background: #222; color: #eee; }
.meta-lines { display: grid; gap: 2px; margin-bottom: 8px; font-size: 12px; }
.byline { margin-top: 2px; font-size: 12px; opacity: .9; }
.lbl { display: block; margin-top: 8px; font-size: .9em; opacity: .9; }
.lbl.inline { margin-top: 0; }
.field .lbl.inline { white-space: nowrap; }
.field.inline-field { display: inline-flex; align-items: center; gap: 10px; }
.field.inline-field .lbl { margin: 0; }
.field.inline-field .seg { max-width: none; }
.form-2col { display: grid; gap: 12px; }
@media (min-width: 1000px) and (max-width: 1199px) { .form-2col { grid-template-columns: repeat(2, minmax(240px, 1fr)); } }
.seg { display: flex; flex-wrap: wrap; gap: 6px; }
.seg-item { position: relative; }
.seg-item input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.seg-item span { display: inline-block; padding: 8px 12px; border: 1px solid #444; border-radius: 999px; background: #222; color: #eee; font-size: 12px; user-select: none; }
.seg.small .seg-item span { padding: 6px 10px; font-size: 12px; }
.seg-item input:checked + span { background: #1e90ff; border-color: #1e90ff; color: #fff; }
.seg-item.disabled span { opacity: .55; }
.seg-item input:disabled + span { cursor: not-allowed; opacity: .55; }
.field .seg { max-width: 300px; }
.field-span { grid-column: 1 / -1; }
.w300 { max-width: 300px; width: 100%; }
.field-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; max-width: 340px; }
.field-pair.gsv-pair { grid-template-columns: 120px 92px; max-width: 220px; }
.coord { width: 100%; box-sizing: border-box; padding: 6px 8px; border-radius: 6px; border: 1px solid #444; background: #222; color: #eee; max-width: 300px; }
.coord-error { margin-top: 4px; font-size: 12px; color: #ff9e9e; opacity: .95; }
.coord-hint { margin-top: 4px; font-size: 11px; color: #9aa3ad; font-style: italic; }
.btn-row { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.coord-actions { max-width: 520px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 6px; }
.coord-action-link { text-decoration: none; justify-content: center; }
.inline-map-btn { vertical-align: middle; }
.gmaps-btn { display: inline-flex; align-items: center; justify-content: center; padding: 3px 6px; line-height: 0; }
.gmaps-icon { display: block; }
.media-row { display: grid; grid-template-columns: 1fr; gap: 12px; align-items: start; margin: 8px 0 4px; }
.photos-field { margin-top: 10px; }
.photos-scroller { display: flex; gap: 8px; padding-bottom: 6px; overflow-x: auto; }
.photos-scroller img { width: 140px; height: 110px; object-fit: cover; border-radius: 8px; border: 1px solid #444; }
.photos-empty { padding: 2px 0 0; min-height: 0; color: #aaa; border: none; border-radius: 0; font-size: 12px; }
.photo-wrap { position: relative; flex: 0 0 auto; }
.photo-wrap img { width: 140px; height: 110px; object-fit: cover; border-radius: 8px; border: 1px solid #444; cursor: zoom-in; }
.del-btn { position: absolute; top: 6px; right: 6px; border: 1px solid #444; background: rgba(32,32,32,.85); color: #eee; border-radius: 6px; padding: 2px 6px; font-size: 12px; line-height: 1; cursor: pointer; }
.del-btn:hover { background: rgba(48,48,48,.9); }
.ghost:focus-visible, .approve:focus-visible, .danger:focus-visible, .mini:focus-visible, .seg-item span:focus-visible, input:focus-visible, select:focus-visible, a.inline-map-btn:focus-visible {
  outline: 2px solid #ffd54f; outline-offset: 2px; box-shadow: 0 0 0 3px rgba(255, 213, 79, .25);
}
/* Mobile: sticky bottom action bar */
@media (max-width: 800px) {
  .info-card { flex: 1 1 auto; min-height: 0; padding: 10px; grid-template-rows: auto minmax(0, 1fr) auto; }
  .info-card .action-bar { order: 3; position: sticky; bottom: 0; margin: 0 -10px -10px; padding: 8px 10px calc(8px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid #3a3a3a; background: #2a2a2a; box-shadow: 0 -4px 10px rgba(0,0,0,.25); }
  .info-card .info-scroll { order: 2; }
  .media-row { grid-template-columns: 1fr; }
}
@media (min-width: 1200px) { .info-card { max-width: 340px; } }
</style>
