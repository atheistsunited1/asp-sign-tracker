<template>
  <div class="card restore-card">
    <div class="card-head"><strong>Pin Details</strong></div>
    <p class="muted card-subtext">review pin details</p>
    <div class="grid">
      <label>
        <span>Sign Text</span>
        <input v-model.trim="form.sign_text" type="text" />
      </label>
      <div class="campaign-switch-row">
        <input id="restore-major-campaign" v-model="form.is_major_campaign" class="form-switch" type="checkbox" />
        <label for="restore-major-campaign" class="form-switch-label">Major campaign</label>
      </div>
      <label>
        <span>Sign Type</span>
        <select v-model="form.sign_type">
          <option value="">Select sign type</option>
          <option v-for="opt in stOpts" :key="opt.v" :value="opt.v">{{ opt.l }}</option>
        </select>
      </label>
      <label class="full-row">
        <span>Pin Location Description (physical location / identifying info)</span>
        <textarea v-model.trim="form.description" rows="2" />
      </label>
      <label class="full-row">
        <span>Coordinates</span>
        <input v-model.trim="form.coords" type="text" placeholder="lat, lng" @blur="reverseGeocodeFromCoords({ silentInvalid: true, notifySuccess: false })" />
        <span class="muted field-note">{{ geoSummaryText }}</span>
      </label>
    </div>
  </div>
</template>

<script setup>
import { inject } from 'vue'
import { DELETED_PINS_CTX } from '@/pages/deleted-pins/context'
import { SIGN_TYPE_OPTIONS as stOpts } from '@/shared/domain/activityOptions'
const { form, geoSummaryText, reverseGeocodeFromCoords } = inject(DELETED_PINS_CTX).restore
</script>

<style scoped>
.card { border: 1px solid #363636; border-radius: 8px; background: #202020; padding: 10px; display: grid; gap: 8px; width: min(860px, 100%); justify-self: start; }
.card-head { display: flex; justify-content: flex-start; align-items: flex-start; gap: 8px; }
.card-subtext { margin: -2px 0 0; text-align: left; }
.muted { color: #bdbdbd; font-size: 12px; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(180px, 240px)); justify-content: start; gap: 8px; }
.full-row { grid-column: 1 / -1; }
.field-note { margin-top: 1px; }
label { display: grid; gap: 4px; font-size: 12px; color: #c9c9c9; }
input, select, textarea { width: 100%; box-sizing: border-box; border-radius: 6px; border: 1px solid #444; background: #171717; color: #eee; padding: 7px 8px; }
textarea { resize: vertical; }
.campaign-switch-row { position: relative; display: flex; align-items: center; min-height: 26px; }
.form-switch { position: absolute; opacity: 0; pointer-events: none; }
.form-switch-label { --track-off: #6a6f78; --track-on: #0b57d0; --knob: #ffffff; --border: #5a5f68; position: relative; display: inline-block; padding-left: 58px; line-height: 26px; min-height: 26px; cursor: pointer; color: #d9d9d9; font-size: 12px; font-weight: 600; user-select: none; }
.form-switch-label::before { content: ""; position: absolute; left: 0; top: 50%; width: 50px; height: 26px; margin-top: -13px; border-radius: 999px; background: var(--track-off); border: 1px solid var(--border); box-shadow: inset 0 1px 1px rgba(0,0,0,.1); transition: background-color .18s ease, border-color .18s ease; }
.form-switch-label::after { content: ""; position: absolute; left: 3px; top: 50%; width: 20px; height: 20px; margin-top: -10px; border-radius: 50%; background: var(--knob); border: 1px solid #d0d0d0; box-shadow: 0 1px 1px rgba(0,0,0,.14); transform: translateX(0); transition: transform .18s ease; }
.form-switch:checked + .form-switch-label::before { background: var(--track-on); border-color: var(--track-on); }
.form-switch:checked + .form-switch-label::after { transform: translateX(24px); }
.form-switch:focus-visible + .form-switch-label::before { outline: 2px solid rgba(11, 87, 208, .4); outline-offset: 2px; }
@media (max-width: 980px) { .grid { grid-template-columns: 1fr; } }
</style>
