<template>
  <div style="font-size: 14px;">
    <div class="pp-top">
      <span class="pp-typeline">
        Type: {{ labelType }}
        <span v-if="pending" class="pp-badge">(pending)</span>
      </span>
      <span class="pp-idline">ID: {{ friendlyId }}</span>
    </div>

    <div class="pp-box pp-signtext">{{ summaryText || '—' }}</div>

    <div v-if="canStylePin" class="pp-box">
      <label style="display:grid; gap:4px; min-width:0;">
        <span style="font-size:11px; color:#6b7280;">Color</span>
        <select v-model="editColor">
          <option v-for="opt in effectiveColorOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </label>
      <div style="display:flex; justify-content:flex-end; margin-top:6px;">
        <button
          class="pp-iconbtn"
          @click="$emit('save-pin-visuals', { iconColor: editColor })"
        >
          Save Style
        </button>
      </div>
    </div>

    <div :id="photosId" class="pp-photos"></div>

    <template v-if="isEditing">
      <div class="pp-box">
        <input v-model="editDesc" type="text" placeholder="Location description" />
        <div style="display: flex; gap: 8px; margin-top: 6px;">
          <button class="pp-iconbtn" @click="$emit('save-desc', editDesc)">Save</button>
          <button class="pp-iconbtn" @click="$emit('cancel-edit-desc')">Cancel</button>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="pp-box" style="display: flex; align-items: center; gap: 8px;">
        <div style="flex: 1 1 auto; min-width: 0;">{{ descValue || '—' }}</div>
        <button
          v-if="canModerate && !pending"
          class="pp-iconbtn"
          title="Edit location"
          @click="$emit('start-edit-desc')"
        >
          ✏️
        </button>
      </div>

      <div class="pp-sectionlabel" style="display: flex; align-items: center; justify-content: space-between;">
        <span>
          {{ cityStateLabel }}
          <button
            class="pp-iconbtn pp-bookmark"
            :class="{ active: isBookmarked }"
            :title="isBookmarked ? 'Remove bookmark' : 'Bookmark pin'"
            :aria-pressed="isBookmarked"
            :disabled="!canBookmark"
            @click="$emit('toggle-bookmark')"
          >🔖</button>
          <button
            class="pp-iconbtn"
            title="Copy link to this pin"
            :disabled="!canActions"
            @click="$emit('copy-app-pin-url')"
          >
            🔗
          </button>
          <button
            class="pp-iconbtn"
            title="Open in Google Maps"
            :disabled="!canActions"
            @click="$emit('open-map-at')"
          >
            🗺️
          </button>
        </span>
      </div>
    </template>

    <div style="display: flex; align-items: center; gap: 6px;">
      <div
        class="pp-box"
        style="
          flex: 0 0 auto;
          color: #6b7280;
          white-space: nowrap;
          padding-right: 10px;
        "
      >
        {{ coordStr }}
      </div>
    </div>

    <div class="pp-sectionlabel" style="display: flex; align-items: center;">
      <span>Activity history</span>
      <button class="pp-expander" title="Open full history" @click="$emit('open-pin-history', historySource)">▾</button>
    </div>

    <div v-if="reports.length" class="pp-box">
      <div
        v-for="(r, idx) in reports.slice(0, 5)"
        :key="r.id || `${r.report_type || 'report'}-${r.created_at || idx}`"
      >
        {{ formatHistoryRow(r) }}
      </div>
    </div>
    <div v-else class="pp-box" style="color: #6b7280;">No activity yet.</div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
      <button
        v-if="canModerate"
        class="pp-btn-compact pp-deletebtn"
        title="Delete pending activity or pin"
        @click="$emit('delete-pin')"
      >
        🗑
      </button>
      <template v-if="!isFinalLifecycle">
        <button class="pp-btn-tall" @click="$emit('open-report-for-pin', 'plundered')">🛠️ Plundered</button>
        <button class="pp-btn-tall" @click="$emit('open-report-for-pin', 'krakened')">🐙 Krakened</button>
      </template>
      <button class="pp-btn-compact" @click="$emit('copy-pin-from-existing')">🧬 Copy Pin</button>
      <button class="pp-btn-compact" @click="$emit('toggle-pin-drag')">🧲 Toggle Drag</button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { colorOptionRowsForPin, normalizeIconColorForPin } from '@/shared/domain/pinVisuals'

const props = defineProps({
  pending: { type: Boolean, default: false },
  labelType: { type: String, default: 'Unknown' },
  friendlyId: { type: String, default: '' },
  summaryText: { type: String, default: '' },
  photosId: { type: String, required: true },
  isEditing: { type: Boolean, default: false },
  descValue: { type: String, default: '' },
  canModerate: { type: Boolean, default: false },
  canBookmark: { type: Boolean, default: true },
  isBookmarked: { type: Boolean, default: false },
  canStylePin: { type: Boolean, default: false },
  canActions: { type: Boolean, default: false },
  cityStateLabel: { type: String, default: 'Location' },
  coordStr: { type: String, default: '—' },
  reports: { type: Array, default: () => [] },
  historySource: { type: String, default: '' },
  isFinalLifecycle: { type: Boolean, default: false },
  pinColor: { type: String, default: '' },
  pinIconType: { type: Number, default: null },
  pinIsMajorCampaign: { type: Boolean, default: false },
  pinSignType: { type: String, default: '' },
  colorOptions: { type: Array, default: () => [] },
})

defineEmits([
  'save-desc',
  'cancel-edit-desc',
  'start-edit-desc',
  'copy-app-pin-url',
  'open-map-at',
  'open-pin-history',
  'open-report-for-pin',
  'copy-pin-from-existing',
  'toggle-pin-drag',
  'save-pin-visuals',
  'toggle-bookmark',
  'delete-pin',
])

const editDesc = ref(props.descValue || '')
const editColor = ref(normalizeIconColorForPin({
  iconType: props.pinIconType,
  isMajorCampaign: props.pinIsMajorCampaign,
  signType: props.pinSignType,
  requestedColor: props.pinColor || '',
}))
const effectiveColorOptions = computed(() => {
  const rows = colorOptionRowsForPin({
    iconType: props.pinIconType,
    isMajorCampaign: props.pinIsMajorCampaign,
    signType: props.pinSignType,
  })
  return rows.length ? rows : props.colorOptions
})

watch(
  () => props.descValue,
  (v) => {
    editDesc.value = v || ''
  },
)
watch(
  () => props.pinColor,
  (v) => {
    editColor.value = normalizeIconColorForPin({
      iconType: props.pinIconType,
      isMajorCampaign: props.pinIsMajorCampaign,
      signType: props.pinSignType,
      requestedColor: v || '',
    })
  },
)

function formatHistoryRow(r) {
  const reportType = r?.report_type || 'report'
  const pending = r?.__pending ? ' (pending)' : ''
  const when = r?.occurred_on || r?.created_at
  if (!when) return `${reportType}${pending}`

  const d = new Date(when)
  const date = Number.isNaN(d.getTime()) ? '' : ` · ${d.toLocaleDateString()}`
  return `${reportType}${pending}${date}`
}
</script>
