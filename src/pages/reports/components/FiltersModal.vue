<template>
  <div
    v-if="open"
    class="modal-overlay"
    @click="$emit('close')"
    @keydown.esc.prevent="$emit('close')"
    tabindex="-1"
    aria-modal="true"
    role="dialog"
  >
    <div class="modal-panel" @click.stop>
      <header class="modal-head">
        <h2>Filters</h2>
        <button class="ghost" @click="$emit('close')">✖</button>
      </header>
      <div class="modal-body">
        <label class="lbl">
          <input type="checkbox" v-model="draft.myOnly" />
          <span style="margin-left:8px">⭐ My activity only</span>
        </label>
        <label class="lbl">
          <input type="checkbox" v-model="draft.majorCampaign" />
          <span style="margin-left:8px">📣 Major campaign only</span>
        </label>

        <label class="lbl">Keyword</label>
        <input type="text" v-model="draft.q" placeholder="Sign text or Pin ID…" />

        <label class="lbl">Activity Type</label>
        <div class="seg">
          <label class="seg-item" v-for="o in rtOpts" :key="o.v">
            <input type="checkbox" :value="o.v" v-model="draft.reportTypes">
            <span>{{ o.l }}</span>
          </label>
        </div>

        <label class="lbl">Sign Type</label>
        <div class="seg small">
          <label class="seg-item" v-for="o in stOpts" :key="o.v">
            <input type="checkbox" :value="o.v" v-model="draft.signTypes">
            <span>{{ o.l }}</span>
          </label>
        </div>

        <label class="lbl">Sign text</label>
        <input type="text" v-model="draft.sign_text" placeholder="contains…" />

        <label class="lbl">Description</label>
        <input type="text" v-model="draft.description" placeholder="contains…" />

        <div class="two">
          <div>
            <label class="lbl">City</label>
            <input type="text" v-model="draft.city" placeholder="e.g., Portland" />
          </div>
          <div>
            <label class="lbl">State / Region</label>
            <input type="text" v-model="draft.state" placeholder="e.g., OR" />
          </div>
        </div>

        <!-- Activity date range (occurred_on) -->
        <div class="two">
          <div>
            <label class="lbl">Activity date from</label>
            <input type="date" v-model="draft.dateFrom" />
          </div>
          <div>
            <label class="lbl">Activity date to</label>
            <input type="date" v-model="draft.dateTo" />
          </div>
        </div>

        <label class="lbl">Username</label>
        <input type="text" v-model="draft.username" placeholder="e.g., alice" />

        <label class="lbl">Initials</label>
        <input type="text" v-model="draft.initials" placeholder="e.g., AB" />
      </div>

      <footer class="modal-foot">
        <button class="ghost" @click="$emit('reset')">Reset filters</button>
        <span class="flex1"></span>
        <button class="ghost" @click="$emit('close')">Cancel</button>
        <button class="approve" @click="$emit('apply')">Apply</button>
      </footer>
    </div>
  </div>
</template>

<script setup>
// Filters modal for the Reports feed. `draft` is the reactive draft object from
// useReportFilters (edited in place; apply/reset/close are emitted to the page).
import { rtOpts, stOpts } from '@/pages/reports/useReportDetail'
defineProps({
  open: { type: Boolean, default: false },
  draft: { type: Object, required: true },
})
defineEmits(['close', 'apply', 'reset'])
</script>

<style scoped>
.modal-overlay { position: fixed; inset: 0; z-index: 6000; background: rgba(0,0,0,.55); display: grid; place-items: center; }
.modal-panel {
  width: min(720px, 94vw); max-height: 90vh; background: #222; color: #eee; border: 1px solid #3a3a3a; border-radius: 12px;
  display: grid; grid-template-rows: auto 1fr auto; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,.45);
}
.modal-head, .modal-foot { padding: 10px 12px; background: #1f1f1f; border-bottom: 1px solid #333; }
.modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.modal-head h2 { margin: 0; }
.modal-foot { border-top: 1px solid #333; border-bottom: none; display: flex; gap: 8px; align-items: center; }
.flex1 { flex: 1; }
.modal-body { padding: 12px; overflow: auto; display: grid; gap: 12px; }
.modal-body input[type="text"], .modal-body input[type="date"] {
  width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 8px; border: 1px solid #444; background: #1c1c1c; color: #eee;
}
.modal-body .two { display: grid; gap: 12px; }
@media (min-width: 640px) { .modal-body .two { grid-template-columns: 1fr 1fr; } }
.lbl { display: block; margin-top: 8px; font-size: .9em; opacity: .9; }
.seg { display: flex; flex-wrap: wrap; gap: 6px; }
.seg-item { position: relative; }
.seg-item input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.seg-item span { display: inline-block; padding: 8px 12px; border: 1px solid #444; border-radius: 999px; background: #222; color: #eee; font-size: 12px; user-select: none; }
.seg.small .seg-item span { padding: 6px 10px; font-size: 12px; }
.seg-item input:checked + span { background: #1e90ff; border-color: #1e90ff; color: #fff; }
.ghost { background: #444; color: #fff; border: 1px solid #555; padding: 6px 10px; border-radius: 6px; cursor: pointer; }
.ghost:hover { background: #4d4d4d; }
.approve { background: #28a745; color: white; border: none; padding: 6px 10px; border-radius: 6px; cursor: pointer; }
.modal-panel button:focus-visible, input:focus-visible, .seg-item span:focus-visible { outline: 2px solid #ffd54f; outline-offset: 2px; box-shadow: 0 0 0 3px rgba(255, 213, 79, .25); }
</style>
