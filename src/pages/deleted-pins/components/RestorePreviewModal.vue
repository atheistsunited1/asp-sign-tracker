<template>
  <div v-if="restorePreview.open" class="modal-overlay" @click.self="closeRestorePreview">
    <div class="modal-card restore-preview-card">
      <h3>Confirm Restore</h3>
      <p class="muted">{{ restorePreview.summary }}</p>

      <div class="preview-pin-details">
        <strong>Pin Details</strong>
        <div class="preview-pin-grid">
          <div><span class="k">Sign Text:</span> <span class="v">{{ restorePreview.pinDetails?.sign_text || '-' }}</span></div>
          <div><span class="k">Sign Type:</span> <span class="v">{{ formatSignTypeLabel(restorePreview.pinDetails?.sign_type, '-') }}</span></div>
          <div><span class="k">Major Campaign:</span> <span class="v">{{ restorePreview.pinDetails?.is_major_campaign ? 'Yes' : 'No' }}</span></div>
          <div><span class="k">Coords:</span> <span class="v">{{ restorePreview.pinDetails?.coords || '-' }}</span></div>
          <div class="full"><span class="k">Location:</span> <span class="v">{{ restorePreview.pinDetails?.description || '-' }}</span></div>
          <div class="full"><span class="k">Geo:</span> <span class="v">{{ restorePreview.pinDetails?.geo || '-' }}</span></div>
        </div>
      </div>

      <div class="preview-list-wrap">
        <strong>Activities</strong>
        <div class="preview-list preview-cards">
          <div
            v-for="row in restorePreview.rows" :key="`preview-${row.id}`"
            class="preview-card" :class="{ expanded: restorePreview.expandedReportId === row.id }"
            @click="togglePreviewExpand(row.id)"
          >
            <div class="preview-card-head">
              <span class="muted">{{ formatPreviewCollapsed(row) }}</span>
              <span class="preview-inc" :class="{ yes: row.included, no: !row.included }">{{ row.included ? 'Yes' : 'No' }}</span>
            </div>
            <div v-if="restorePreview.expandedReportId === row.id" class="preview-card-body">
              <div class="preview-fields">
                <div><span class="k">ID:</span> <span class="v">{{ row.id }}</span></div>
                <div><span class="k">Pin ID:</span> <span class="v">{{ row.pin_id || '-' }}</span></div>
                <div><span class="k">Type:</span> <span class="v">{{ row.report_type || '-' }}</span></div>
                <div><span class="k">Date:</span> <span class="v">{{ formatDateTime(row.occurred_on || row.created_at) }}</span></div>
                <div><span class="k">Created:</span> <span class="v">{{ formatDateTime(row.created_at) }}</span></div>
                <div><span class="k">Updated:</span> <span class="v">{{ formatDateTime(row.updated_at) }}</span></div>
                <div><span class="k">Submitted By:</span> <span class="v">{{ row.submitted_by || '-' }}</span></div>
                <div><span class="k">Approved By:</span> <span class="v">{{ row.approved_by || '-' }}</span></div>
                <div><span class="k">Approved:</span> <span class="v">{{ row.is_approved ? 'Yes' : 'No' }}</span></div>
                <div><span class="k">Deleted:</span> <span class="v">{{ row.is_deleted ? 'Yes' : 'No' }}</span></div>
                <div><span class="k">Deleted At:</span> <span class="v">{{ formatDateTime(row.deleted_at) }}</span></div>
              </div>
              <div v-if="row.displayPhotos?.length" class="preview-photo-strip">
                <button v-for="(p, i) in row.displayPhotos" :key="`pp-${row.id}-${p.id || i}`" type="button" class="report-photo-btn" @click.stop="openPhotoViewerForReport(row, i)" :title="`Open photo ${i + 1}`">
                  <img :src="p.image_url" :alt="`activity photo ${i + 1}`" loading="lazy" />
                </button>
              </div>
              <div v-else class="muted">No photos.</div>
            </div>
          </div>
          <div v-if="!restorePreview.rows.length" class="muted">No activities.</div>
        </div>
      </div>

      <div class="preview-toggle-switch">
        <input id="purge-unselected-switch" v-model="restorePreview.purgeUnselected" class="form-switch form-switch-red" type="checkbox" />
        <label for="purge-unselected-switch" class="form-switch-label form-switch-label-red">Purge-delete unselected activities now (and their photos)</label>
      </div>

      <div class="row-actions">
        <button class="btn ghost" :disabled="busyRestore" @click="closeRestorePreview">Cancel</button>
        <button class="btn success" :disabled="busyRestore" @click="confirmRestoreFromPreview">{{ busyRestore ? 'Restoring...' : 'Confirm Restore' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { inject } from 'vue'
import { DELETED_PINS_CTX } from '@/pages/deleted-pins/context'
import { formatSignTypeLabel } from '@/shared/domain/pinUtils'
import { formatDateTime } from '@/shared/lib/date'
const ctx = inject(DELETED_PINS_CTX)
const { restorePreview, busyRestore, formatPreviewCollapsed, togglePreviewExpand, closeRestorePreview, confirmRestoreFromPreview } = ctx.restore
const { openPhotoViewerForReport } = ctx.viewer
</script>

<style scoped>
.modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55); display: grid; place-items: center; z-index: 5000; }
.modal-card { width: min(420px, 92vw); background: #222; border: 1px solid #3b3b3b; border-radius: 10px; padding: 12px; display: grid; gap: 10px; }
.modal-card h3 { margin: 0; }
.restore-preview-card { width: min(920px, 96vw); max-height: min(82vh, 740px); overflow: auto; }
.muted { color: #bdbdbd; font-size: 12px; }
.preview-list-wrap { display: grid; gap: 6px; }
.preview-pin-details { border: 1px solid #333; border-radius: 8px; background: #1b1b1b; padding: 10px; display: grid; gap: 8px; }
.preview-pin-grid { display: grid; grid-template-columns: repeat(2, minmax(240px, 1fr)); gap: 6px 10px; }
.preview-pin-grid .full { grid-column: 1 / -1; }
.k { color: #b3b3b3; font-weight: 600; }
.v { color: #ececec; }
.preview-list { border: 1px solid #333; border-radius: 8px; background: #1b1b1b; padding: 8px; max-height: 220px; overflow: auto; display: grid; gap: 6px; }
.preview-cards { gap: 8px; }
.preview-card { border: 1px solid #353535; border-radius: 8px; background: #202020; padding: 8px; display: grid; gap: 8px; cursor: pointer; }
.preview-card.expanded { border-color: #525252; background: #252525; }
.preview-card-head { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; }
.preview-card-body { display: grid; gap: 8px; }
.preview-fields { display: grid; grid-template-columns: repeat(2, minmax(220px, 1fr)); gap: 5px 10px; }
.preview-photo-strip { display: flex; flex-wrap: wrap; gap: 6px; }
.report-photo-btn { border: 1px solid #3d3d3d; background: #151515; border-radius: 6px; padding: 0; cursor: pointer; width: 56px; height: 42px; overflow: hidden; }
.report-photo-btn img { width: 100%; height: 100%; object-fit: cover; display: block; }
.preview-inc { display: inline-flex; align-items: center; justify-content: center; min-width: 40px; font-size: 11px; font-weight: 700; border-radius: 999px; padding: 2px 8px; border: 1px solid transparent; }
.preview-inc.yes { color: #d8ffd8; background: #2b8c3e33; border-color: #2b8c3e; }
.preview-inc.no { color: #ffd8dd; background: #c6495630; border-color: #c64956; }
.preview-toggle-switch { position: relative; display: flex; align-items: center; min-height: 26px; margin-top: 2px; }
.form-switch { position: absolute; opacity: 0; pointer-events: none; }
.form-switch-label { --track-off: #6a6f78; --track-on: #0b57d0; --knob: #ffffff; --border: #5a5f68; position: relative; display: inline-block; padding-left: 58px; line-height: 26px; min-height: 26px; cursor: pointer; color: #d9d9d9; font-size: 12px; font-weight: 600; user-select: none; }
.form-switch-label-red { --track-on: #c64956; }
.form-switch-label::before { content: ""; position: absolute; left: 0; top: 50%; width: 50px; height: 26px; margin-top: -13px; border-radius: 999px; background: var(--track-off); border: 1px solid var(--border); box-shadow: inset 0 1px 1px rgba(0,0,0,.1); transition: background-color .18s ease, border-color .18s ease; }
.form-switch-label::after { content: ""; position: absolute; left: 3px; top: 50%; width: 20px; height: 20px; margin-top: -10px; border-radius: 50%; background: var(--knob); border: 1px solid #d0d0d0; box-shadow: 0 1px 1px rgba(0,0,0,.14); transform: translateX(0); transition: transform .18s ease; }
.form-switch:checked + .form-switch-label::before { background: var(--track-on); border-color: var(--track-on); }
.form-switch:checked + .form-switch-label::after { transform: translateX(24px); }
.form-switch:focus-visible + .form-switch-label::before { outline: 2px solid rgba(11, 87, 208, .4); outline-offset: 2px; }
.row-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.btn { border: 1px solid #555; background: #3b3b3b; color: #fff; border-radius: 8px; padding: 6px 10px; cursor: pointer; }
.btn.ghost { background: #2d2d2d; }
.btn.success { background: #2b8c3e; border-color: #2b8c3e; }
@media (max-width: 980px) { .preview-pin-grid, .preview-fields { grid-template-columns: 1fr; } }
</style>
