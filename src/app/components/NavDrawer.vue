<template>
  <!-- Side Drawer -->
  <aside class="drawer" :class="{ open: menuOpen }" @click.self="menuOpen = false">
    <div class="drawer-panel">
      <div class="drawer-head">
        <h3 class="drawer-title">Menu</h3>
        <button class="tray-x" @click="menuOpen = false" aria-label="Close menu">✖</button>
      </div>

      <ul class="drawer-list">
        <li>
          <button class="drawer-item" @click="goReports">📝 Reports</button>
        </li>
        <li v-if="isAdmin">
          <button class="drawer-item" @click="goBulkPhotoReports">📷 Bulk Photo Reports</button>
        </li>
        <li v-if="isAdmin">
          <button class="drawer-item" @click="goManageUsers">👥 Users</button>
        </li>
        <li v-if="canUseMapOps">
          <button class="drawer-item" @click="goDashboard">📊 Dashboard</button>
        </li>
        <li v-if="canUseMapOps">
          <button class="drawer-item" @click="goKmlImport">📥 Import KML</button>
        </li>
        <li v-if="canUseMapOps">
          <button class="drawer-item" @click="goExport">⬇️ Export</button>
        </li>
        <li v-if="canUseMapOps">
          <button class="drawer-item" @click="goDeletedPins">🗂 Deleted Pins</button>
        </li>
      </ul>
    </div>
  </aside>
</template>

<script setup>
// Menu drawer (#133): route actions with their role gates live in useShellNav.
import { inject } from 'vue'
import { APP_SHELL_CTX } from '@/app/shellContext'
const { isAdmin, canUseMapOps, nav } = inject(APP_SHELL_CTX)
const { menuOpen, goReports, goBulkPhotoReports, goManageUsers, goDashboard, goKmlImport, goExport, goDeletedPins } = nav
</script>

<style>
/* Moved from App.vue (#133). Global, not scoped — these selectors are also matched by other pages
   (e.g. .tray-x / .tray-section in the map tray), so scoping would change them. */
/* --- drawer --- */
.drawer {
  position: fixed;
  /* start the overlay *below* the top bar */
  top: calc(var(--topbar-h) + env(safe-area-inset-top, 0px));
  right: 0;
  bottom: 0;
  left: 0;
  background: rgba(0,0,0,0.4);
  opacity: 0;
  pointer-events: none;
  transition: opacity .15s ease;
  z-index: 2999; /* below the topbar, which is fine since we offset top */
}
.drawer.open {
  opacity: 1;
  pointer-events: auto;
}
.drawer-panel {
  width: 260px;
  height: 100%;
  background: #242424;
  border-right: 1px solid #333;
  padding: 18px 14px 14px;
  display: flex;
  flex-direction: column;
}
.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.drawer-title {
  margin: 0;
  color: #ffd54f;
}
.drawer-list {
  list-style: none;
  padding: 0;
  margin: 0;
  flex: 1;
}
.drawer-item {
  width: 100%;
  text-align: left;
  background: #303030;
  color: #eee;
  border: 1px solid #3a3a3a;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 8px;
  cursor: pointer;
}
.drawer-item:hover { background: #383838; }
</style>
