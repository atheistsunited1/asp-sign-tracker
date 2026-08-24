<template>
  <!-- Legend: counts by type (rows) vs approved/pending (columns) -->
  <div
    id="counts-legend"
    class="counts-legend"
    :class="{ collapsed: !legendOpen }"
  >
    <button
      class="legend-title layer-btn"
      type="button"
      @click="legendOpen = !legendOpen"
      :aria-expanded="legendOpen"
      aria-controls="legend-body"
      title="Toggle legend"
    >
      Legend <span class="chev">{{ legendOpen ? '▾' : '▸' }}</span>
    </button>

    <div id="legend-body" v-show="legendOpen" class="legend-bodycard">
      <table>
        <colgroup>
          <col style="width:14px" />      <!-- dot -->
          <col style="width:56%" />           <!-- Type (narrowed ~20%) -->
          <col style="width:72px" />      <!-- Approved -->
          <col style="width:72px" />      <!-- Pending -->
        </colgroup>
        <thead>
          <tr>
            <th class="dot-col"></th>
            <th class="type-col">Type</th>
            <th>Approved</th>
            <th>Pending</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in legendRows"
            :key="r.key"
            class="legend-row"
            :class="{ off: !isLegendRowActive(r.key) }"
            role="button"
            tabindex="0"
            @click="onLegendRowToggle(r.key)"
            @keydown="onLegendRowKey($event, r.key)"
            :aria-pressed="isLegendRowActive(r.key)"
            :title="isLegendRowActive(r.key) ? 'Click to hide this category' : 'Click to show this category'"
          >
            <td class="dot-col">
              <span class="legend-dot" :style="dotStyle(r.key)"></span>
            </td>
            <td class="type-col">{{ r.label }}</td>
            <td>{{ counts.approved[r.key] || 0 }}</td>
            <td>{{ counts.pending[r.key]  || 0 }}</td>
          </tr>
        </tbody>
      </table>

      <div class="legend-footer">
        <div class="legend-toggles">
          <input
            id="lg-major"
            class="legend-toggle"
            type="checkbox"
            :checked="majorCampaignOnly"
            @change="majorCampaignOnly = $event.target.checked"
          />
          <label for="lg-major">Major Campaign Only</label>
        </div>
      </div>
    </div>
  </div>
  <!-- Click-away shield for the legend; closes it and swallows the click -->
  <div
    v-if="legendOpen"
    class="legend-backdrop"
    @click.stop.prevent="legendOpen = false"
  />
</template>

<script setup>
// Legend: counts by type (rows) vs approved/pending (columns), Major-campaign toggle, click-away backdrop.
// Reads the map page context (mapContext.js); extracted from MapPage.vue with its CSS.
import { inject } from 'vue'
import { MAP_CTX } from '@/pages/map/mapContext'
const ctx = inject(MAP_CTX)
const {
  counts,
  dotStyle,
  isLegendRowActive,
  legendOpen,
  legendRows,
  majorCampaignOnly,
  onLegendRowKey,
  onLegendRowToggle,
} = ctx
</script>

<style scoped src="./LegendPanel.css"></style>
