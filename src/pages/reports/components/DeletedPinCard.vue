<template>
  <!-- Read-only detail for a soft-deleted pin (Deleted tab): pin facts, its deleted activity, restore / purge. -->
  <section class="info-card" v-if="selectedDeleted">
    <div class="info-head">
      <div class="id-date">
        <div class="ids">
          <span class="badge">Pin ID: {{ selectedDeleted.friendly_id }}</span>
          <span v-if="selectedDeleted.is_major_campaign" class="badge badge-major" title="Marked as major campaign">Major campaign</span>
          <span class="time">🗑 Deleted {{ formatDateTime(selectedDeleted.deleted_at) }}</span>
        </div>
      </div>
    </div>

    <div class="action-bar actions">
      <button class="approve" :disabled="busyDeleted" @click="restoreSelectedDeleted" title="Restore this pin and its deleted activity">♻️ Restore</button>
      <button class="danger" :disabled="busyDeleted" @click="purgeSelectedDeleted" title="Permanently delete this pin, its activity and photos">🗑 Purge</button>
      <router-link class="ghost link-btn" :to="{ name: 'deleted-pins' }" title="Per-activity restore, edits and purge">Advanced restore…</router-link>
    </div>

    <div class="info-scroll">
      <div class="desc">
        <div class="form-2col">
          <div class="field"><label class="lbl">Sign Type</label><div class="muted w300">{{ formatSignTypeLabel(selectedDeleted.sign_type, '—') }}</div></div>
          <div class="field"><label class="lbl">Sign Text</label><div class="muted w300">{{ selectedDeleted.sign_text || '—' }}</div></div>
          <div class="field"><label class="lbl">Location Description</label><div class="muted w300">{{ selectedDeleted.description || '—' }}</div></div>
          <div class="field"><label class="lbl">City</label><div class="muted w300">{{ selectedDeleted.city || '—' }}</div></div>
          <div class="field"><label class="lbl">State / Region</label><div class="muted w300">{{ selectedDeleted.state || '—' }}</div></div>
          <div class="field field-span">
            <label class="lbl">Coordinates</label>
            <div class="btn-row coord-actions">
              <span class="muted">{{ formatCoords(selectedDeleted.lat, selectedDeleted.lng) || '—' }}</span>
              <a
                v-if="Number.isFinite(selectedDeleted.lat) && Number.isFinite(selectedDeleted.lng)"
                class="mini inline-map-btn coord-action-link gmaps-btn"
                :href="gmapsLink(selectedDeleted.lat, selectedDeleted.lng)"
                target="_blank" rel="noopener" title="Open in Google Maps" aria-label="Open in Google Maps"
              >
                <svg class="gmaps-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                  <path fill="#EA4335" d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7z"/>
                  <path fill="#4285F4" d="M12 2v20s7-7.75 7-13a7 7 0 0 0-7-7z" opacity=".9"/>
                  <circle cx="12" cy="9" r="2.6" fill="#fff"/>
                </svg>
              </a>
            </div>
          </div>
        </div>

        <div class="field field-span">
          <label class="lbl">Deleted activity ({{ deletedReports.length }})</label>
          <div v-if="loadingDeletedReports" class="muted">Loading…</div>
          <div v-else-if="!deletedReports.length" class="muted">No activity on this pin.</div>
          <div v-else class="deleted-reports">
            <div v-for="dr in deletedReports" :key="dr.id" class="deleted-report">
              <div class="primary">
                <span class="pill" :class="(dr.report_type || 'sighting').toLowerCase()">{{ dr.report_type || 'sighting' }}</span>
                <span class="muted">• {{ formatDateOnly(dr.occurred_on || dr.created_at) }}</span>
                <span v-if="dr.is_approved === false" class="muted">• was pending</span>
              </div>
              <div v-if="dr.photos?.length" class="photos-scroller" @wheel.passive="hWheel">
                <div v-for="ph in dr.photos" :key="ph.id || ph.image_url" class="photo-wrap">
                  <img :src="toPublicUrl(ph.image_url)" alt="deleted activity photo" @click="openLightbox(toPublicUrl(ph.image_url))" title="Click to view" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { inject } from 'vue'
import { REPORTS_CTX } from '@/pages/reports/context'
import { formatDateOnly, formatDateTime } from '@/shared/lib/date'
import { formatCoords } from '@/shared/lib/coords'
import { formatSignTypeLabel } from '@/shared/domain/pinUtils'
import { toPublicUrl } from '@/shared/data/photoStorage'

const ctx = inject(REPORTS_CTX)
const { selectedDeleted, deletedReports, loadingDeletedReports, busyDeleted, restoreSelectedDeleted, purgeSelectedDeleted } = ctx.deleted
const { openLightbox, hWheel } = ctx.photos
const { gmapsLink } = ctx.minimap
</script>

<style scoped>
.info-card {
  background: #2a2a2a; border: 1px solid #3a3a3a; border-radius: 10px; padding: 12px; min-height: 0;
  display: grid; grid-template-rows: auto auto 1fr; overflow: hidden;
}
.info-card, .info-head, .desc { min-width: 0; }
.info-card, .info-scroll, .desc { overflow-x: hidden; }
.info-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 8px; padding-bottom: 8px; border-bottom: 1px solid #3a3a3a; position: sticky; top: 0; background: #2a2a2a; z-index: 1; }
.id-date .ids { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
.ids { margin-top: 6px; display: flex; gap: 6px; flex-wrap: wrap; }
.badge { background: #444; color: #ffd700; padding: 2px 6px; border-radius: 6px; font-size: .8em; }
.badge-major { background: #3a2f00; color: #ffd54f; border: 1px solid #6a5715; }
.time { font-size: .9em; opacity: .8; }
.muted { opacity: .85; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-start; }
.approve { background: #28a745; color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; }
.approve:disabled { background: #555; color: #ddd; border: 1px solid #666; cursor: not-allowed; opacity: .9; }
.danger { background: #ef5a67; color: #111; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; }
.danger:hover { background: #e74c59; }
.ghost { background: #444; color: #fff; border: 1px solid #555; padding: 6px 10px; border-radius: 6px; cursor: pointer; }
.ghost:hover { background: #4d4d4d; }
.link-btn { text-decoration: none; display: inline-flex; align-items: center; }
.mini { padding: 4px 6px; border: 1px solid #444; background: #303030; color: #eee; border-radius: 6px; cursor: pointer; }
.info-scroll { min-height: 0; overflow: auto; overflow-x: hidden; }
.desc { margin: 10px 0; white-space: pre-wrap; overflow-x: hidden; }
.lbl { display: block; margin-top: 8px; font-size: .9em; opacity: .9; }
.form-2col { display: grid; gap: 12px; }
@media (min-width: 1000px) and (max-width: 1199px) { .form-2col { grid-template-columns: repeat(2, minmax(240px, 1fr)); } }
.field-span { grid-column: 1 / -1; }
.w300 { max-width: 300px; width: 100%; }
.btn-row { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.coord-actions { max-width: 520px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 6px; }
.coord-action-link { text-decoration: none; justify-content: center; }
.inline-map-btn { vertical-align: middle; }
.gmaps-btn { display: inline-flex; align-items: center; justify-content: center; padding: 3px 6px; line-height: 0; }
.gmaps-icon { display: block; }
.pill { align-self: start; font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid #555; background: #333; color: #eee; text-transform: capitalize; }
.pill.plundered { background: #4a332b; color: #ffddb8; border-color: #7a584b; }
.pill.krakened { background: #233b46; color: #b8f0ff; border-color: #3e6473; }
.deleted-reports { display: grid; gap: 8px; }
.deleted-report { border: 1px solid #3a3a3a; border-radius: 8px; padding: 8px 10px; background: #262626; display: grid; gap: 4px; }
.deleted-report .primary { font-weight: 600; }
.photos-scroller { display: flex; gap: 8px; padding-bottom: 6px; overflow-x: auto; }
.photo-wrap { position: relative; flex: 0 0 auto; }
.photo-wrap img { width: 140px; height: 110px; object-fit: cover; border-radius: 8px; border: 1px solid #444; cursor: zoom-in; }
@media (max-width: 800px) {
  .info-card { flex: 1 1 auto; min-height: 0; padding: 10px; grid-template-rows: auto minmax(0, 1fr) auto; }
  .info-card .action-bar { order: 3; position: sticky; bottom: 0; margin: 0 -10px -10px; padding: 8px 10px calc(8px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid #3a3a3a; background: #2a2a2a; box-shadow: 0 -4px 10px rgba(0,0,0,.25); }
  .info-card .info-scroll { order: 2; }
}
@media (min-width: 1200px) { .info-card { max-width: 340px; } }
</style>
