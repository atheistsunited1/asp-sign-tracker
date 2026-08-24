<template>
  <section class="wrap">
    <div class="page-head">
      <h1>📊 Dashboard</h1>
      <div class="period">
        <div class="qpick" v-if="!d.isCustom.value">
          <button class="ghost" @click="d.stepQuarter(-1)" title="Previous quarter">‹</button>
          <select :value="d.quarter.value" @change="d.setQuarter($event.target.value)">
            <option v-for="q in quarterOptions" :key="q" :value="q">{{ q }}</option>
          </select>
          <button class="ghost" :disabled="!d.canGoForward.value" @click="d.stepQuarter(1)" title="Next quarter">›</button>
          <button class="ghost link" @click="customOpen = !customOpen">Custom range…</button>
        </div>
        <div class="qpick" v-else>
          <span class="chip">{{ d.label.value }}</span>
          <button class="ghost link" @click="d.setQuarter(d.currentQuarter); customOpen = false">Back to quarters</button>
          <button class="ghost link" @click="customOpen = !customOpen">Change…</button>
        </div>
        <form v-if="customOpen" class="custom" @submit.prevent="applyCustom">
          <input type="date" v-model="cFrom" required /> <span>→</span> <input type="date" v-model="cTo" required />
          <button class="ghost primary" type="submit">Apply</button>
        </form>
      </div>
    </div>

    <div v-if="d.error.value" class="error">❌ {{ d.error.value }}</div>
    <div v-if="d.loading.value && !m" class="muted">Loading…</div>

    <template v-if="m">
      <p class="muted compare">
        {{ d.label.value }} · compared with {{ d.previous.value.from }} → {{ d.previous.value.to }}
        <span v-if="d.loading.value"> · refreshing…</span>
      </p>

      <!-- KPI tiles -->
      <div class="tiles">
        <div class="tile">
          <div class="k">Signs tracked</div>
          <div class="v">{{ fmt(m.tracked.total) }}</div>
          <div class="s"><Delta :value="m.tracked.added" /> added · <Pct :value="m.tracked.pct" /> growth</div>
        </div>
        <div class="tile">
          <div class="k">Plundered (all time)</div>
          <div class="v">{{ fmt(m.plundered.snapshot.total) }}</div>
          <div class="s">+{{ fmt(m.plundered.period) }} this period · <Pct :value="m.plundered.pct" /> vs previous</div>
        </div>
        <div class="tile">
          <div class="k">Krakened (all time)</div>
          <div class="v">{{ fmt(m.krakened.snapshot.total) }}</div>
          <div class="s">+{{ fmt(m.krakened.period) }} this period · <Pct :value="m.krakened.pct" /> vs previous</div>
        </div>
        <div class="tile">
          <div class="k">Treasure in waiting</div>
          <div class="v">{{ fmt(m.backlog.snapshot.total) }}</div>
          <div class="s"><Delta :value="m.backlog.period" /> this period (new − plundered − krakened)</div>
        </div>
        <div class="tile">
          <div class="k">Questionable legality</div>
          <div class="v">{{ fmt(m.questionable.snapshot.total) }}</div>
          <div class="s">+{{ fmt(m.questionable.period) }} this period · <Pct :value="m.questionable.pct" /> vs previous</div>
        </div>
        <div class="tile">
          <div class="k">Billboards</div>
          <div class="v">{{ fmt(m.billboards.total) }}</div>
          <div class="s">{{ fmt(m.billboards.major) }} major campaign</div>
        </div>
      </div>

      <!-- Sections in the quarterly report's order -->
      <div class="cards">
        <section class="card" v-for="sec in sections" :key="sec.key">
          <div class="card-title">{{ sec.icon }} {{ sec.title }}</div>
          <div class="headline">
            <b>{{ fmt(sec.data.period) }}</b> {{ sec.unit }} this period
            <span class="muted">· previous {{ fmt(sec.data.previous) }} · <Delta :value="sec.data.delta" /><template v-if="sec.data.pct != null"> (<Pct :value="sec.data.pct" />)</template></span>
            <span class="muted" v-if="sec.totalLabel"> · {{ sec.totalLabel }} <b>{{ fmt(sec.total) }}</b></span>
          </div>
          <table class="split">
            <thead><tr><th></th><th>This period</th><th v-if="sec.snapshot">All time</th></tr></thead>
            <tbody>
              <tr><td>Major Campaign</td><td>{{ fmt(sec.data.major) }}</td><td v-if="sec.snapshot">{{ fmt(sec.snapshot.major) }}</td></tr>
              <tr class="sub"><td>· Jesus Saves</td><td>{{ fmt(sec.data.js) }}</td><td v-if="sec.snapshot">{{ fmt(sec.snapshot.js) }}</td></tr>
              <tr class="sub"><td>· Jesus Is Coming… (JICR)</td><td>{{ fmt(sec.data.jicr) }}</td><td v-if="sec.snapshot">{{ fmt(sec.snapshot.jicr) }}</td></tr>
              <tr class="sub" v-if="sec.data.otherMajor || sec.snapshot?.otherMajor"><td>· other major</td><td>{{ fmt(sec.data.otherMajor) }}</td><td v-if="sec.snapshot">{{ fmt(sec.snapshot.otherMajor) }}</td></tr>
              <tr><td>California (non-major)</td><td>{{ fmt(sec.data.caNonMajor) }}</td><td v-if="sec.snapshot">{{ fmt(sec.snapshot.caNonMajor) }}</td></tr>
              <tr><td>Other outside CA (non-major)</td><td>{{ fmt(sec.data.outsideCaNonMajor) }}</td><td v-if="sec.snapshot">{{ fmt(sec.snapshot.outsideCaNonMajor) }}</td></tr>
            </tbody>
          </table>
        </section>
      </div>

      <!-- Trend -->
      <section class="card">
        <div class="card-title">📈 Quarterly trend</div>
        <TrendChart v-bind="m.trend" />
        <p class="muted small">Backlog at quarter end is reconstructed from activity dates (signs seen by then minus plunders/krakenings by then, excluding billboards and questionable pins).</p>
      </section>

      <!-- States -->
      <section class="card">
        <div class="card-title">🗺️ By state</div>
        <div class="scroll-x">
          <table class="grid">
            <thead>
              <tr>
                <th v-for="c in stateCols" :key="c.key" @click="sortBy(c.key)" :class="{ sorted: sortKey === c.key }">{{ c.label }}<span v-if="sortKey === c.key"> {{ sortDir > 0 ? '▲' : '▼' }}</span></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in sortedStates" :key="s.state">
                <td v-for="c in stateCols" :key="c.key" :class="{ num: c.key !== 'state' }">{{ c.key === 'state' ? s.state : fmt(s[c.key]) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Members -->
      <section class="card">
        <div class="card-title">🏴‍☠️ Crew — this period</div>
        <div v-if="!m.members.length" class="muted">No attributed activity in this period.</div>
        <div v-else class="scroll-x">
          <table class="grid">
            <thead><tr><th>#</th><th>Pirate</th><th>Plundered</th><th>Sightings</th><th>Krakened</th><th>Questionable</th><th>Total</th></tr></thead>
            <tbody>
              <tr v-for="(u, i) in m.members.slice(0, 25)" :key="u.username">
                <td>{{ i + 1 }}</td><td>{{ u.username }}</td>
                <td class="num">{{ fmt(u.plundered) }}</td><td class="num">{{ fmt(u.sighting) }}</td><td class="num">{{ fmt(u.krakened) }}</td><td class="num">{{ fmt(u.questionable) }}</td><td class="num">{{ fmt(u.total) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </section>
</template>

<script setup>
import { ref, computed, h } from 'vue'
import { useDashboard } from '@/pages/dashboard/useDashboard'
import { lastQuarters } from '@/pages/dashboard/quarters'
import TrendChart from '@/pages/dashboard/components/TrendChart.vue'

const d = useDashboard()
const m = computed(() => d.model.value)

const quarterOptions = computed(() => lastQuarters(d.currentQuarter, 16).reverse())

const customOpen = ref(false)
const cFrom = ref(''), cTo = ref('')
function applyCustom() { d.setCustom(cFrom.value, cTo.value); customOpen.value = false }

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString())

// Tiny inline components for signed deltas / percentages
const Delta = (props) => h('span', { class: props.value > 0 ? 'up' : props.value < 0 ? 'down' : '' }, props.value == null ? '—' : (props.value > 0 ? '+' : '') + Number(props.value).toLocaleString())
Delta.props = ['value']
const Pct = (props) => h('span', { class: props.value > 0 ? 'up' : props.value < 0 ? 'down' : '' }, props.value == null ? 'n/a' : (props.value > 0 ? '+' : '') + props.value + '%')
Pct.props = ['value']

const sections = computed(() => m.value ? [
  { key: 'plundered', icon: '📦', title: 'Plunders', unit: 'plundered', data: m.value.plundered, snapshot: m.value.plundered.snapshot, total: m.value.plundered.snapshot.total, totalLabel: 'all time' },
  { key: 'krakened', icon: '🐙', title: 'Krakenings', unit: 'krakened', data: m.value.krakened, snapshot: m.value.krakened.snapshot, total: m.value.krakened.snapshot.total, totalLabel: 'all time' },
  { key: 'backlog', icon: '🏴‍☠️', title: 'Treasure in waiting', unit: 'net change', data: m.value.backlog, snapshot: m.value.backlog.snapshot, total: m.value.backlog.snapshot.total, totalLabel: 'waiting now' },
  { key: 'questionable', icon: '❓', title: 'Questionable legality', unit: 'added', data: m.value.questionable, snapshot: m.value.questionable.snapshot, total: m.value.questionable.snapshot.total, totalLabel: 'all time' },
] : [])

const stateCols = [
  { key: 'state', label: 'State' }, { key: 'total', label: 'Signs' },
  { key: 'sighting', label: 'Waiting' }, { key: 'plundered', label: 'Plundered' }, { key: 'krakened', label: 'Krakened' },
  { key: 'questionable', label: 'Questionable' }, { key: 'billboard', label: 'Billboards' },
  { key: 'periodNew', label: 'New (period)' }, { key: 'periodPlundered', label: 'Plundered (period)' }, { key: 'periodKrakened', label: 'Krakened (period)' },
]
const sortKey = ref('total'), sortDir = ref(-1)
function sortBy(k) { if (sortKey.value === k) sortDir.value *= -1; else { sortKey.value = k; sortDir.value = k === 'state' ? 1 : -1 } }
const sortedStates = computed(() => [...(m.value?.states || [])].sort((a, b) => {
  const x = a[sortKey.value], y = b[sortKey.value]
  return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sortDir.value
}))
</script>

<style scoped>
.wrap { padding:20px; color:#eee; min-height:100vh; background:#1e1e1e; }
h1 { margin:0; color:#ffd700; font-size:18px; }
.page-head { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:8px; }
.period { display:flex; flex-direction:column; gap:6px; align-items:flex-end; }
.qpick { display:flex; gap:6px; align-items:center; }
.qpick select, .custom input { background:#1b1b1b; color:#eee; border:1px solid #444; border-radius:6px; padding:6px 8px; }
.custom { display:flex; gap:6px; align-items:center; }
.ghost { background:#333; color:#eee; border:1px solid #444; border-radius:6px; padding:6px 10px; cursor:pointer; }
.ghost[disabled] { opacity:.5; cursor:not-allowed; }
.ghost.link { background:transparent; border-color:transparent; color:#f7cf57; text-decoration:underline; padding:4px 6px; }
.ghost.primary { background:#1e90ff; border-color:#1e90ff; color:#fff; }
.chip { display:inline-flex; align-items:center; padding:4px 8px; border-radius:999px; font-size:12px; background:#2a2a2a; border:1px solid #3a3a3a; }
.error { background:#5b1a1a; border:1px solid #8a2a2a; padding:10px; border-radius:8px; margin:8px 0; }
.muted { opacity:.8; }
.small { font-size:12px; }
.compare { margin:0 0 12px; }
.tiles { display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:10px; margin-bottom:14px; }
.tile { background:#242424; border:1px solid #333; border-radius:10px; padding:12px 14px; }
.tile .k { font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:#9aa3af; }
.tile .v { font-size:28px; font-weight:700; color:#fff; line-height:1.2; margin:4px 0; }
.tile .s { font-size:12px; opacity:.85; }
.cards { display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap:12px; margin-bottom:12px; }
.card { background:#242424; border:1px solid #333; border-radius:10px; padding:12px 14px; margin-bottom:12px; min-width:0; }
.card-title { font-weight:600; color:#f7cf57; margin-bottom:8px; }
.headline { margin-bottom:8px; }
.headline b { font-size:20px; color:#fff; }
table.split { width:100%; border-collapse:collapse; font-size:14px; }
table.split th, table.split td { text-align:right; padding:4px 6px; border-top:1px solid #2e2e2e; }
table.split th:first-child, table.split td:first-child { text-align:left; }
table.split tr.sub td:first-child { padding-left:16px; opacity:.85; }
.scroll-x { overflow-x:auto; }
table.grid { width:100%; border-collapse:collapse; font-size:13px; white-space:nowrap; }
table.grid th { position:sticky; top:0; background:#2a2a2a; text-align:left; padding:6px 8px; cursor:pointer; user-select:none; }
table.grid th.sorted { color:#f7cf57; }
table.grid td { padding:5px 8px; border-top:1px solid #2e2e2e; }
table.grid td.num { text-align:right; font-variant-numeric: tabular-nums; }
:deep(.up) { color:#7ee081; }
:deep(.down) { color:#ff7b7b; }
@media (max-width: 800px) {
  .period { align-items:stretch; }
  .tile .v { font-size:24px; }
}
</style>
