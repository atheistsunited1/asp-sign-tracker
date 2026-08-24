<template>
  <aside class="side-tray" :class="{ open }" @click.self="$emit('close')">
    <div class="side-tray-panel">
      <div class="side-tray-header">
        <strong>{{ title }}</strong>
        <button class="tray-x" @click="$emit('close')" aria-label="Close">✖</button>
      </div>
      <slot />
    </div>
  </aside>
</template>

<script setup>
// Right-side tray shell used by the Account and Settings trays (#133).
defineProps({ open: { type: Boolean, default: false }, title: { type: String, default: '' } })
defineEmits(['close'])
</script>

<style>
/* Moved from App.vue (#133). Global, not scoped — these selectors are also matched by other pages
   (e.g. .tray-x / .tray-section in the map tray), so scoping would change them. */
/* Right-side trays (account / settings) */
.side-tray {
  position: fixed;
  top: calc(var(--topbar-h) + env(safe-area-inset-top, 0px));
  right: 0; bottom: 0; left: 0;
  background: rgba(0,0,0,.4);
  opacity: 0; pointer-events: none;
  transition: opacity .15s ease;
  z-index: 2999;
}
.side-tray.open { opacity: 1; pointer-events: auto; }
.side-tray-panel{
  position:absolute; top:0; right:0; bottom:0; width: 300px;
  background:#242424; border-left:1px solid #333;
  padding: 14px;
  display:flex; flex-direction:column; gap:10px;
}
.side-tray-header{ display:flex; align-items:center; justify-content:space-between;}
.tray-x{
  border:1px solid #3a3a3a; background:#303030; color:#ddd; border-radius:6px; padding:4px 8px; cursor:pointer;
}
</style>
