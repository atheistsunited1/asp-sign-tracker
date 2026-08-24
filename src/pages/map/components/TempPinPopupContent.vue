<template>
  <div style="font-size: 14px;">
    <template v-if="mode === 'moved'">
      📍 Pin moved<br />
      {{ coordStr }}<br />
      <button @click="$emit('save-location')">💾 Save Location</button>
      <button @click="$emit('cancel-drag')">↩️ Cancel</button>
    </template>
    <template v-else>
      📍 New Pin<br />
      {{ coordStr }}<br />
      <button @click="$emit('report-sign')">📄 Report Sign</button>
      <button @click="$emit('remove-pin')">🗑️ Remove</button>
    </template>
  </div>
</template>

<script setup>
defineProps({
  mode: { type: String, default: 'new' },
  coordStr: { type: String, default: '' },
})

defineEmits(['save-location', 'cancel-drag', 'report-sign', 'remove-pin'])
</script>
