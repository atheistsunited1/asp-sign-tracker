<!-- src/components/ToastHost.vue -->
<script setup>
import { onBeforeUnmount } from 'vue'
import { provideToast } from '@/shared/ui/useToast' // same path everywhere

const { state } = provideToast()

// optional: clear any pending timeout when host unmounts
onBeforeUnmount(() => {
  if (state._t) clearTimeout(state._t)
})
</script>

<template>
  <slot />
  <div v-if="state.show" class="toast" :class="state.type">{{ state.message }}</div>
</template>

<style scoped>
.toast{
  position: fixed;
  /* ⬇️ sit just below the app's top bar (uses your --topbar-h var) */
  top: calc(var(--topbar-h, 56px) + env(safe-area-inset-top, 0px) + 10px);
  left: 50%;
  transform: translateX(-50%);
  bottom: auto;                 /* was bottom: 16px; */

  background: #1e90ff;
  color: #fff;
  border: 1px solid rgba(255,255,255,.25);
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 14px;

  z-index: 10000;                /* above Leaflet controls (1000) & map; below modals */
  pointer-events: none;         /* don’t block map clicks */
  box-shadow: 0 6px 18px rgba(0,0,0,.25);
}
.toast.info    { background:#1e90ff; }
.toast.success { background:#28a745; }
.toast.error   { background:#dc3545; }
.toast.warn    { background:#d97706; }
</style>
