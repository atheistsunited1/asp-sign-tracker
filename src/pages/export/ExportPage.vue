<template>
  <section class="wrap">
    <div class="page-head">
      <h1>⬇️ Export</h1>
      <span class="muted">KML (My Maps shape) or CSV of approved pins with their activities and photo links.</span>
    </div>

    <div class="card">
      <div class="card-title">1. Select</div>
      <div class="filters">
        <fieldset class="group">
          <legend>Buckets</legend>
          <label v-for="b in BUCKETS" :key="b.value" class="check">
            <input type="checkbox" :checked="x.buckets.value.includes(b.value)" @change="x.toggleBucket(b.value)" /> {{ b.label }}
          </label>
        </fieldset>
        <label class="field">Major Campaign
          <select v-model="x.major.value">
            <option v-for="o in MAJOR_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </label>
        <label class="field">State
          <input v-model="x.state.value" maxlength="2" placeholder="e.g. CA" style="width:70px; text-transform:uppercase" />
        </label>
        <label class="field">Activity between
          <span class="range"><input type="date" v-model="x.from.value" /> <span>→</span> <input type="date" v-model="x.to.value" /></span>
        </label>
        <button class="ghost primary" :disabled="x.loading.value || !x.buckets.value.length" @click="x.preview()">
          {{ x.loading.value ? 'Loading…' : (x.rows.value ? 'Refresh preview' : 'Preview') }}
        </button>
      </div>
      <p class="muted small">Date range keeps pins with at least one activity in the range; leave empty for everything. Only approved, non-deleted pins are exported.</p>
    </div>

    <div v-if="x.error.value" class="error">❌ {{ x.error.value }}</div>

    <div class="card" v-if="x.rows.value">
      <div class="card-title">2. Preview <span v-if="x.stale.value" class="warn">— filters changed, refresh the preview</span></div>
      <div class="stats">
        <div class="stat"><b>{{ x.rows.value.length.toLocaleString() }}</b><span>pins</span></div>
        <div class="stat" v-for="b in BUCKETS" :key="b.value" v-show="x.countsByBucket.value[b.value]"><b>{{ (x.countsByBucket.value[b.value] || 0).toLocaleString() }}</b><span>{{ b.label }}</span></div>
        <div class="stat"><b>{{ x.photoCount.value.toLocaleString() }}</b><span>photo links</span></div>
        <div class="stat" v-if="x.parts.value > 1"><b>{{ x.parts.value }}</b><span>KML parts (≤ {{ MAX_PLACEMARKS_PER_FILE.toLocaleString() }} each)</span></div>
      </div>
      <div class="muted small">Layer name: <code>{{ x.selectionLabel.value }}</code></div>
      <details v-if="x.rows.value.length" class="sample">
        <summary>First {{ Math.min(10, x.rows.value.length) }} placemarks</summary>
        <ul>
          <li v-for="r in x.rows.value.slice(0, 10)" :key="r.pin.id"><code>{{ r.pin.friendly_id }}</code> {{ placemarkName(r.pin) }} <span class="muted">· {{ r.activities.length }} activit{{ r.activities.length === 1 ? 'y' : 'ies' }} · {{ r.photos.length }} photo{{ r.photos.length === 1 ? '' : 's' }}</span></li>
        </ul>
      </details>
    </div>

    <div class="card" v-if="x.rows.value && x.rows.value.length">
      <div class="card-title">3. Download</div>
      <div class="dl">
        <label class="check"><input type="radio" value="kml" v-model="x.format.value" /> KML — Google My Maps / Earth / GIS<span class="muted small"> (name <code>STATE - Sign text (City)</code>, description in the My Maps line grammar, photo links in <code>gx_media_links</code>, extra fields in ExtendedData; split into parts of {{ MAX_PLACEMARKS_PER_FILE.toLocaleString() }})</span></label>
        <label class="check"><input type="radio" value="csv" v-model="x.format.value" /> CSV — one row per pin<span class="muted small"> (name, description, coordinates, photo URLs + bucket, campaign, dates, activity counts)</span></label>
        <button class="ghost primary" :disabled="x.stale.value" @click="x.download()">Download {{ x.format.value.toUpperCase() }}</button>
        <span class="muted small">files: <code>{{ x.fileBase.value }}{{ x.format.value === 'csv' ? '.csv' : (x.parts.value > 1 ? '-partNN.kml' : '.kml') }}</code></span>
      </div>
      <p class="muted small">My Maps import: one KML file per layer, each ≤ {{ MAX_PLACEMARKS_PER_FILE.toLocaleString() }} placemarks. The same files re-import into this app via Import KML.</p>
    </div>
  </section>
</template>

<script setup>
import { useExport } from '@/pages/export/useExport'
import { BUCKETS, MAJOR_OPTIONS, MAX_PLACEMARKS_PER_FILE } from '@/pages/export/constants'
import { placemarkName } from '@/pages/export/kmlWriter'

const x = useExport()
</script>

<style scoped>
.wrap { padding:20px; color:#eee; min-height:100vh; background:#1e1e1e; }
h1 { margin:0; color:#ffd700; font-size:18px; }
.page-head { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin-bottom:12px; }
.card { background:#242424; border:1px solid #333; border-radius:10px; padding:12px 14px; margin-bottom:12px; }
.card-title { font-weight:600; color:#f7cf57; margin-bottom:8px; }
.filters { display:flex; gap:16px; align-items:flex-end; flex-wrap:wrap; }
.group { border:1px solid #3a3a3a; border-radius:8px; padding:6px 10px; display:flex; gap:12px; flex-wrap:wrap; }
.group legend { font-size:12px; opacity:.8; padding:0 4px; }
.check { display:flex; align-items:center; gap:6px; }
.field { display:flex; flex-direction:column; gap:4px; font-size:13px; }
.range { display:flex; gap:6px; align-items:center; }
select, input { background:#1b1b1b; color:#eee; border:1px solid #444; border-radius:6px; padding:6px 8px; }
.ghost { background:#333; color:#eee; border:1px solid #444; border-radius:6px; padding:6px 10px; cursor:pointer; }
.ghost[disabled] { opacity:.5; cursor:not-allowed; }
.ghost.primary { background:#1e90ff; border-color:#1e90ff; color:#fff; font-weight:600; }
.error { background:#5b1a1a; border:1px solid #8a2a2a; padding:10px; border-radius:8px; margin:8px 0; }
.muted { opacity:.8; }
.small { font-size:12px; }
.warn { color:#ffd700; font-weight:400; font-size:13px; }
.stats { display:flex; flex-wrap:wrap; gap:8px 18px; margin-bottom:6px; }
.stat { display:flex; flex-direction:column; min-width:72px; }
.stat b { font-size:18px; color:#fff; }
.stat span { font-size:12px; opacity:.75; }
.sample ul { margin:6px 0 0; padding-left:18px; font-size:13px; }
.dl { display:flex; flex-direction:column; gap:8px; align-items:flex-start; }
code { background:#1b1b1b; padding:1px 4px; border-radius:4px; }
</style>
