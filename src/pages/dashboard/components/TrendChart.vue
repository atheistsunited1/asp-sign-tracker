<template>
  <VChart class="trend-chart" :option="option" autoresize />
</template>

<script setup>
// Quarterly trend: grouped bars (plunders, krakenings, new signs, questionable)
// with the backlog as a line on a second axis. ECharts is registered with only
// the pieces this chart needs so the bundle stays small.
import { computed } from 'vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import VChart from 'vue-echarts'

use([CanvasRenderer, BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent])

const props = defineProps({
  quarters: { type: Array, default: () => [] },
  plundered: { type: Array, default: () => [] },
  krakened: { type: Array, default: () => [] },
  newSigns: { type: Array, default: () => [] },
  questionable: { type: Array, default: () => [] },
  backlog: { type: Array, default: () => [] },
})

const TEXT = '#d6dae0', GRID = '#333'

const option = computed(() => ({
  backgroundColor: 'transparent',
  textStyle: { color: TEXT },
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
  legend: { top: 0, textStyle: { color: TEXT } },
  grid: { left: 48, right: 56, top: 36, bottom: 28 },
  xAxis: { type: 'category', data: props.quarters, axisLine: { lineStyle: { color: GRID } }, axisLabel: { color: TEXT } },
  yAxis: [
    { type: 'value', name: 'per quarter', splitLine: { lineStyle: { color: GRID } }, axisLabel: { color: TEXT }, nameTextStyle: { color: TEXT } },
    { type: 'value', name: 'backlog', splitLine: { show: false }, axisLabel: { color: TEXT }, nameTextStyle: { color: TEXT } },
  ],
  series: [
    { name: 'Plundered', type: 'bar', data: props.plundered, itemStyle: { color: '#f2a65a' } },
    { name: 'Krakened', type: 'bar', data: props.krakened, itemStyle: { color: '#5ec8e5' } },
    { name: 'New signs', type: 'bar', data: props.newSigns, itemStyle: { color: '#ffd700' } },
    { name: 'Questionable', type: 'bar', data: props.questionable, itemStyle: { color: '#b39ddb' } },
    { name: 'Backlog (quarter end)', type: 'line', yAxisIndex: 1, data: props.backlog, smooth: true, itemStyle: { color: '#7ee081' }, lineStyle: { width: 2 } },
  ],
}))
</script>

<style scoped>
.trend-chart { width: 100%; height: 320px; }
</style>
