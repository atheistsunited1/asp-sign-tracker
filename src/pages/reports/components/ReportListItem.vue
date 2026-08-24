<template>
  <button class="list-row" :class="{ active }" @click="$emit('select')">
    <div class="row-left">
      <img v-if="thumb" :src="thumb" alt="" class="thumb" loading="lazy" />
      <div v-else class="thumb placeholder">{{ placeholder }}</div>
    </div>
    <div class="row-main">
      <div class="primary">
        <span class="pill" :class="pillClass">{{ type }}</span>
        <span v-if="major" class="pill major" title="Major campaign">Major</span>
        <span v-if="friendlyId" class="muted">• {{ friendlyId }}</span>
      </div>
      <div class="secondary">{{ signText || '—' }}</div>
      <div class="secondary by">{{ place }} • {{ date }}</div>
    </div>
  </button>
</template>

<script setup>
// One row of the Reports feed (pending / approved / deleted lists).
import { computed } from 'vue'
const props = defineProps({
  type: { type: String, default: 'sighting' },   // activity type, or 'deleted' for deleted pins
  thumb: { type: String, default: '' },
  placeholder: { type: String, default: '🖼️' },
  major: { type: Boolean, default: false },
  friendlyId: { type: String, default: '' },
  signText: { type: String, default: '' },
  place: { type: String, default: '' },
  date: { type: String, default: '' },
  active: { type: Boolean, default: false },
})
defineEmits(['select'])
const pillClass = computed(() => String(props.type || 'sighting').toLowerCase())
</script>

<style scoped>
.list-row {
  display: grid; grid-template-columns: auto 1fr; gap: 10px; width: 100%; text-align: left;
  background: #262626; border: 1px solid #3a3a3a; border-radius: 8px; padding: 10px 12px;
  color: #ddd; cursor: pointer; min-height: 64px; align-items: center;
}
.list-row:hover { background: #2d2d2d; }
.list-row.active { border-color: #ffd700; box-shadow: 0 0 0 2px rgba(255,215,0,0.15) inset; }
.list-row:focus-visible { outline: 2px solid #ffd54f; outline-offset: 2px; border-color: #ffd700; box-shadow: 0 0 0 2px rgba(255,215,0,0.25) inset, 0 0 0 3px rgba(255, 213, 79, .25); }
.row-left { width: 56px; }
.thumb { width: 56px; height: 42px; object-fit: cover; border-radius: 6px; border: 1px solid #3a3a3a; background: #2a2a2a; }
.thumb.placeholder { display: flex; align-items: center; justify-content: center; font-size: 12px; color: #aaa; }
.row-main { min-width: 0; }
.row-main .primary { font-weight: 600; }
.row-main .secondary { font-size: 12px; opacity: .85; }
.row-main .by { opacity: .75; }
.muted { opacity: .85; }
.pill { align-self: start; font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid #555; background: #333; color: #eee; text-transform: capitalize; }
.pill.plundered { background: #4a332b; color: #ffddb8; border-color: #7a584b; }
.pill.krakened { background: #233b46; color: #b8f0ff; border-color: #3e6473; }
.pill.deleted { background: #3a1f1f; color: #ffb4b4; border-color: #5b2a2a; }
.pill.major { background: #51420b; color: #ffd54f; border-color: #6a5715; }
</style>
