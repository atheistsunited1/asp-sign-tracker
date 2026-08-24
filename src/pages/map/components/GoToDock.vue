<template>
  <!-- Left edge dock: handle + the search entry controls (Jump-to, Search/Filter, Clear).
       Docking slides the group off-screen; the Search & Filters tray itself is unaffected. -->
  <button
    v-show="!searchOpen"
    class="left-dock-handle"
    type="button"
    :aria-expanded="!leftDockCollapsed"
    aria-controls="left-dock"
    :title="leftDockCollapsed ? 'Show search controls' : 'Hide search controls'"
    @click="toggleLeftDock"
  >{{ leftDockCollapsed ? '▸' : '◂' }}</button>

  <div id="left-dock" class="left-dock" :class="{ docked: leftDockCollapsed }" :aria-hidden="leftDockCollapsed">
  <div class="goto-map-wrap" aria-label="Go To">
    <div class="goto-map-input-wrap">
      <input
        ref="coordInputEl"
        v-model="coordInput"
        @input="onGoToInput"
        @focus="goToFocused = true"
        @blur="goToFocused = false"
        @keydown.down.prevent="moveGoToSuggestion(1)"
        @keydown.up.prevent="moveGoToSuggestion(-1)"
        @keydown.enter.prevent="onGoToEnter"
        class="goto-map-input"
        :placeholder="goToFocused ? 'Jump to pin id, city/state, zip, coordinate, or map url' : 'Jump to…'"
        aria-label="Go to pin/city/state/zip/coordinate"
      />
      <ul v-if="goToSuggestions.length" class="suggest-list goto-map-suggest">
        <li
          v-for="(s, i) in goToSuggestions"
          :key="`${s.type}:${s.key || i}`"
          :class="{ active: i === goToSelIndex }"
          @mousedown.prevent.stop="chooseGoToSuggestion(i)"
          @mouseenter="goToSelIndex = i"
        >
          <div class="coord-line">
            <template v-if="s.type === 'pin'">
              Pin: {{ s.label }}
            </template>
            <template v-else-if="s.type === 'coords'">
              {{ s.label }}
            </template>
            <template v-else-if="s.type === 'zip'">
              ZIP: {{ s.label }}
            </template>
            <template v-else>
              {{ s.label }}
            </template>
          </div>
          <div class="addr-line" v-if="s.sub">{{ s.sub }}</div>
        </li>
      </ul>
    </div>
  </div>

  <!-- Mini expand button (visible only when tray is closed) -->
  <button
    v-if="!searchOpen"
    class="search-expand-btn"
    type="button"
    @click="searchOpen = true"
    title="Open search & filters"
  >
    Search/Filter
  </button>

  <!-- Clear pill visible when search is active and tray is closed -->
  <button
    v-if="!searchOpen && hasSearchState"
    class="search-clear-btn"
    type="button"
    @click="clearSearchAndTrayFilters"
    title="Clear search, go-to, and tray filters"
  >
    Clear search ✕
  </button>
  </div><!-- /left-dock -->
</template>

<script setup>
// Left dock: handle + Jump-to box (suggestions), Search/Filter button and the Clear pill.
// Reads the map page context (mapContext.js); extracted from MapPage.vue with its CSS.
import { inject } from 'vue'
import { MAP_CTX } from '@/pages/map/mapContext'
const ctx = inject(MAP_CTX)
const {
  chooseGoToSuggestion,
  clearSearchAndTrayFilters,
  coordInput,
  coordInputEl,
  goToFocused,
  goToSelIndex,
  goToSuggestions,
  hasSearchState,
  leftDockCollapsed,
  moveGoToSuggestion,
  onGoToEnter,
  onGoToInput,
  searchOpen,
  toggleLeftDock,
} = ctx
</script>

<style scoped src="./GoToDock.css"></style>
