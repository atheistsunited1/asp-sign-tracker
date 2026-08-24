<template>
  <div class="card deleted-reports-card">
    <div class="card-head"><strong>Existing activities</strong></div>
    <p class="muted card-subtext">selected activities to restore with pin</p>
    <div class="reports-list">
      <div v-for="r in displayReports" :key="r.id" class="report-row">
        <div class="report-main">
          <strong>{{ r.report_type || 'report' }}</strong>
          <span class="muted">{{ formatDateTime(r.occurred_on || r.created_at) }}</span>
          <span class="muted">photos: {{ (r.photos || []).length }}</span>
          <span v-if="isAuditType(r.report_type)" class="muted">audit</span>
        </div>
        <div class="report-actions">
          <div class="report-include-switch-wrap">
            <input :id="`include-report-${r.id}`" class="report-include-switch" type="checkbox" :disabled="isAuditType(r.report_type)" :checked="selectedReportIdSet.has(r.id)" @change="toggleReportSelection(r.id)" />
            <label :for="`include-report-${r.id}`" class="report-include-switch-label" :class="{ audit: isAuditType(r.report_type) }">{{ isAuditType(r.report_type) ? 'Audit' : 'Include' }}</label>
          </div>
          <button class="btn tiny ghost" :disabled="isAuditType(r.report_type)" @click="toggleReportEdit(r)">{{ isEditingReport(r.id) ? 'Done' : 'Edit' }}</button>
          <button v-if="isEditingReport(r.id) && isReportDirty(r)" class="btn tiny ghost" @click="resetReportDraft(r)">Reset</button>
          <button class="btn tiny danger report-force-btn" @click="openForceDeleteReport(r)">Force Delete (ACTIVITY + PHOTOS)</button>
        </div>
        <div v-if="isEditingReport(r.id) && !isAuditType(r.report_type)" class="report-edit-grid">
          <label>
            <span>Activity Type</span>
            <select v-model="reportDrafts[r.id].report_type">
              <option v-for="opt in rtOpts" :key="opt.v" :value="opt.v">{{ opt.l }}</option>
            </select>
          </label>
        </div>
        <div v-if="r.displayPhotos?.length" class="report-photo-strip">
          <button v-for="(p, i) in r.displayPhotos" :key="`rp-${r.id}-${p.id || i}`" type="button" class="report-photo-btn" @click="openPhotoViewerForReport(r, i)" :title="`Open photo ${i + 1}`">
            <img :src="p.image_url" :alt="`activity photo ${i + 1}`" loading="lazy" />
          </button>
        </div>
      </div>
      <div v-if="loadingDeletedReports" class="muted pad">Loading deleted activities...</div>
      <div v-else-if="!displayReports.length" class="muted pad">No deleted activities for this pin.</div>
    </div>
  </div>
</template>

<script setup>
import { inject } from 'vue'
import { DELETED_PINS_CTX } from '@/pages/deleted-pins/context'
import { formatDateTime } from '@/shared/lib/date'
import { isAuditType } from '@/shared/domain/activityLifecycle'
import { ACTIVITY_TYPE_OPTIONS as rtOpts } from '@/shared/domain/activityOptions'
const ctx = inject(DELETED_PINS_CTX)
const { displayReports, loadingDeletedReports } = ctx.list
const { selectedReportIdSet, reportDrafts, toggleReportSelection, toggleReportEdit, isEditingReport, isReportDirty, resetReportDraft } = ctx.restore
const { openForceDeleteReport } = ctx.forceDelete
const { openPhotoViewerForReport } = ctx.viewer
</script>

<style scoped>
.card { border: 1px solid #363636; border-radius: 8px; background: #202020; padding: 10px; display: grid; gap: 8px; width: min(860px, 100%); justify-self: start; }
.card-head { display: flex; justify-content: flex-start; align-items: flex-start; gap: 8px; }
.card-subtext { margin: -2px 0 0; text-align: left; }
.muted { color: #bdbdbd; font-size: 12px; }
.pad { padding: 8px; }
.reports-list { display: grid; gap: 8px; max-height: clamp(180px, 34vh, 340px); overflow: auto; padding-right: 2px; }
.report-row { border: 1px solid #343434; border-radius: 8px; padding: 8px; display: grid; grid-template-columns: 1fr auto; align-items: start; gap: 6px; background: #272727; }
.report-main { display: grid; grid-template-columns: repeat(4, auto); align-items: center; justify-content: start; gap: 8px; }
.report-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.report-include-switch-wrap { position: relative; display: inline-flex; align-items: center; min-height: 26px; }
.report-include-switch { position: absolute; opacity: 0; pointer-events: none; }
.report-include-switch-label { --track-off: #6a6f78; --track-on: #2b8c3e; --knob: #ffffff; --border: #5a5f68; position: relative; display: inline-block; padding-left: 58px; line-height: 26px; min-height: 26px; min-width: 118px; cursor: pointer; color: #e1e1e1; font-size: 11px; font-weight: 700; user-select: none; }
.report-include-switch-label::before { content: ""; position: absolute; left: 0; top: 50%; width: 50px; height: 26px; margin-top: -13px; border-radius: 999px; background: var(--track-off); border: 1px solid var(--border); box-shadow: inset 0 1px 1px rgba(0,0,0,.1); transition: background-color .18s ease, border-color .18s ease; }
.report-include-switch-label::after { content: ""; position: absolute; left: 3px; top: 50%; width: 20px; height: 20px; margin-top: -10px; border-radius: 50%; background: var(--knob); border: 1px solid #d0d0d0; box-shadow: 0 1px 1px rgba(0,0,0,.14); transform: translateX(0); transition: transform .18s ease; }
.report-include-switch:checked + .report-include-switch-label::before { background: var(--track-on); border-color: var(--track-on); }
.report-include-switch:checked + .report-include-switch-label::after { transform: translateX(24px); }
.report-include-switch:focus-visible + .report-include-switch-label::before { outline: 2px solid rgba(43, 140, 62, .35); outline-offset: 2px; }
.report-include-switch-label.audit { opacity: 0.75; cursor: not-allowed; }
.report-edit-grid { display: grid; gap: 8px; grid-column: 1 / -1; grid-template-columns: minmax(160px, 240px) 1fr; padding-top: 4px; }
.report-photo-strip { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
.report-photo-btn { border: 1px solid #3d3d3d; background: #151515; border-radius: 6px; padding: 0; cursor: pointer; width: 56px; height: 42px; overflow: hidden; }
.report-photo-btn img { width: 100%; height: 100%; object-fit: cover; display: block; }
label { display: grid; gap: 4px; font-size: 12px; color: #c9c9c9; }
select { width: 100%; box-sizing: border-box; border-radius: 6px; border: 1px solid #444; background: #171717; color: #eee; padding: 7px 8px; }
.btn { border: 1px solid #555; background: #3b3b3b; color: #fff; border-radius: 8px; padding: 6px 10px; cursor: pointer; }
.btn.ghost { background: #2d2d2d; }
.btn.danger { background: #c64956; border-color: #c64956; }
.btn.tiny { padding: 4px 8px; font-size: 12px; }
.report-force-btn { justify-self: start; padding: 3px 7px; font-size: 11px; line-height: 1.2; white-space: nowrap; }
@media (max-width: 980px) { .report-row { grid-template-columns: 1fr; } .report-actions { justify-content: flex-start; } }
</style>
