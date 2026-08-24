<template>
  <!-- Settings Tray (only page-scoped items for now) -->
  <SideTray :open="settingsOpen" title="Settings" @close="settingsOpen = false">
    <fieldset v-if="canToggleDebug" class="tray-section">
      <legend class="tray-legend">Diagnostics</legend>
      <label class="row">
        <input type="checkbox" v-model="debugEnabled" @change="persistDebugEnabled" />
        <span>Enable debug logging</span>
      </label>
    </fieldset>
  </SideTray>
</template>

<script setup>
// Settings tray: debug-logging toggle for admins (useDebugSettings).
import { inject } from 'vue'
import { APP_SHELL_CTX } from '@/app/shellContext'
import SideTray from '@/app/components/SideTray.vue'

const { nav, debug } = inject(APP_SHELL_CTX)
const { settingsOpen } = nav
const { debugEnabled, canToggleDebug, persistDebugEnabled } = debug
</script>

<style>
/* Moved from App.vue. Global, not scoped — these selectors are also matched by other pages
   (e.g. .tray-x / .tray-section in the map tray), so scoping would change them. */
.tray-section{ border:1px solid #3a3a3a; border-radius:10px; padding:10px; }
.tray-legend{ font-size:12px; color:#bbb; padding:0 6px; }
</style>
