<template>
  <section class="wrap">
    <div class="page-head">
      <h1>📥 KML Import</h1>
      <button
        class="ghost help-toggle"
        type="button"
        :class="{ active: helpOpen }"
        :aria-expanded="helpOpen"
        aria-controls="kml-help"
        @click="toggleHelp"
        title="Show or hide the import guide"
      >{{ helpOpen ? '✕ Close guide' : '? Guide' }}</button>
    </div>

    <div class="import-layout" :class="{ 'help-open': helpOpen }">
      <div class="import-main">
        <!-- 1. File -->
        <div class="uploader">
          <input type="file" accept=".kml,application/vnd.google-earth.kml+xml" :disabled="imp.isImporting.value" @change="onFile" />
          <span v-if="imp.isLoading.value" class="muted">Parsing…</span>
          <button class="ghost" v-if="imp.parsed.value" :disabled="imp.isImporting.value" @click="clearAll">Clear</button>
        </div>

        <div v-if="imp.error.value" class="error">❌ {{ imp.error.value }}</div>

        <template v-if="imp.parsed.value">
          <!-- 2. Layer (auto-detected, editable) -->
          <div class="card">
            <div class="card-title">Layer</div>
            <div class="layer-row">
              <span class="muted">Detected from <code>{{ imp.parsed.value.layerName || '(no layer name)' }}</code>:</span>
              <label>
                <select :value="imp.kindValue.value" @change="imp.setKind($event.target.value || null)" :disabled="imp.isImporting.value || !!imp.result.value">
                  <option :value="null" disabled>— Select layer type —</option>
                  <option v-for="k in LAYER_KINDS" :key="k.value" :value="k.value">{{ k.label }}</option>
                </select>
              </label>
              <label class="check">
                <input type="checkbox" v-model="imp.isMajorCampaign.value" :disabled="imp.isImporting.value || !!imp.result.value" />
                Major Campaign
              </label>
            </div>
            <div v-if="!imp.kindValue.value" class="muted warn">The layer name wasn't recognised — pick the layer type. It decides the pin state and which activity closes each pin.</div>
          </div>

          <!-- 3. Summary -->
          <div class="card">
            <div class="card-title">Summary</div>
            <div class="stats">
              <div class="stat"><b>{{ imp.fresh.value.length }}</b><span>new pins</span></div>
              <div class="stat"><b>{{ summary.activities }}</b><span>activities</span></div>
              <div class="stat" v-for="(n, t) in summary.byType" :key="t"><b>{{ n }}</b><span>{{ t }}</span></div>
              <div class="stat"><b>{{ summary.photos }}</b><span>photos</span></div>
              <div class="stat"><b>{{ summary.withGsvDate }}</b><span>with GSV date</span></div>
              <div class="stat" v-if="summary.dateSynthesized"><b>{{ summary.dateSynthesized }}</b><span>dates filled from the pin</span></div>
              <div class="stat" v-if="summary.synthesized"><b>{{ summary.synthesized }}</b><span>activities added by layer</span></div>
              <div class="stat" v-if="imp.alreadyImported.value.length"><b>{{ imp.alreadyImported.value.length }}</b><span>already imported (skipped)</span></div>
              <div class="stat" v-if="imp.parsed.value.duplicates.length"><b>{{ imp.parsed.value.duplicates.length }}</b><span>exact duplicates in file (skipped)</span></div>
              <div class="stat" v-if="imp.parsed.value.skipped.length"><b>{{ imp.parsed.value.skipped.length }}</b><span>without coordinates (skipped)</span></div>
            </div>
            <div v-if="imp.unmatchedInitials.value.length" class="muted">
              No member matches these initials (activities import without a member): <code>{{ imp.unmatchedInitials.value.join(', ') }}</code>
            </div>
          </div>

          <!-- 4. Flags -->
          <div class="card" v-if="imp.flagged.value.length">
            <div class="card-title">Needs a decision ({{ imp.flagged.value.length }})</div>
            <div v-if="imp.tooManyFlags.value" class="error">
              {{ imp.flagged.value.length }} pins have no date anywhere in their description (limit {{ MAX_FLAGS }}). Fix the layer in My Maps and re-export, then upload again.
            </div>
            <template v-else>
              <p class="muted">These pins have no date in their description. Import them with the date below, or skip them.</p>
              <div v-for="r in imp.flagged.value" :key="r.key" class="flag-row">
                <div class="flag-main">
                  <div class="flag-name">{{ r.name || '(no name)' }}</div>
                  <div class="flag-desc">{{ r.description || '— empty description —' }}</div>
                </div>
                <div class="flag-actions">
                  <select :value="imp.resolutions.value[r.key]?.action" @change="imp.setResolution(r, { action: $event.target.value })" :disabled="imp.isImporting.value || !!imp.result.value">
                    <option value="import">Import with date</option>
                    <option value="skip">Skip</option>
                  </select>
                  <input
                    type="date"
                    :value="imp.resolutions.value[r.key]?.date"
                    :disabled="imp.resolutions.value[r.key]?.action === 'skip' || imp.isImporting.value || !!imp.result.value"
                    @change="imp.setResolution(r, { date: $event.target.value })"
                  />
                </div>
              </div>
            </template>
          </div>

          <!-- 5. Import -->
          <div class="actions">
            <button class="ghost primary" :disabled="!imp.canImport.value" :title="importTitle" @click="onImport">
              {{ imp.isImporting.value ? `Importing… ${imp.progress.value.done}/${imp.progress.value.total}` : `Import ${imp.toImport.value.length} pins` }}
            </button>
            <span v-if="imp.result.value" class="chip ok">
              ✅ {{ imp.result.value.pins }} pins · {{ imp.result.value.activities }} activities · {{ imp.result.value.photos }} photos queued
            </span>
          </div>
        </template>

        <!-- Photo mirroring -->
        <div v-if="q.total || q.running || q.queued.length" class="card">
          <div class="card-title">Photo mirroring</div>
          <div class="progress-row">
            <div class="bar"><div :style="{ width: ((q.succeeded + q.failed) / Math.max(1, q.total) * 100).toFixed(1) + '%' }"></div></div>
            <div class="muted nowrap">
              {{ q.succeeded + q.failed }}/{{ q.total || (q.succeeded + q.failed + q.queued.length) }}
              (ok {{ q.succeeded }}, fail {{ q.failed }}, in-flight {{ q.inFlight }}, workers {{ q.concurrency }})<span v-if="q.stall"> · stalled</span>
            </div>
          </div>
          <div class="btn-row">
            <button class="ghost" @click="photoQueue.start()" :disabled="q.running">Start / Resume</button>
            <button class="ghost" @click="photoQueue.cancel()" :disabled="!q.running">Cancel</button>
            <button class="ghost" v-if="q.stall" @click="photoQueue.restartStalled()">Restart (stalled)</button>
          </div>
          <p class="muted">Stay on this page until the counter reaches the total — the uploads run in your browser.</p>
          <details class="log">
            <summary>Photo upload log</summary>
            <div class="log-body"><div v-for="(line, i) in q.logs" :key="i">{{ line }}</div></div>
          </details>
        </div>
      </div>

      <!-- Help drawer: user-initiated, dismissible; essentials first, reference collapsed -->
      <div v-if="helpOpen" class="help-scrim" @click="toggleHelp" aria-hidden="true"></div>
      <aside
        v-show="helpOpen"
        id="kml-help"
        class="import-sidebar"
        aria-label="KML import guide"
        @keydown.esc="toggleHelp"
      >
        <div class="guide-card">
          <div class="guide-eyebrow">Import guide</div>
          <h2>Importing a My Maps layer</h2>

          <div class="guide-section">
            <h3>Quick guide</h3>
            <ol class="guide-list">
              <li>Export <strong>one layer</strong> from My Maps as KML (not KMZ) and upload it here.</li>
              <li>Check the <strong>Layer</strong> row — the type and Major Campaign are read from the layer name; fix them if the name was unusual.</li>
              <li>Read the <strong>Summary</strong>. If pins <strong>need a decision</strong>, pick a date or skip each one.</li>
              <li><strong>Import</strong>, then let the photo counter finish before leaving.</li>
            </ol>
          </div>

          <div class="guide-section">
            <h3>What this does</h3>
            <ul class="guide-list">
              <li>Creates one <strong>approved pin</strong> per Placemark and one <strong>approved activity</strong> per dated event in its description — sightings, re-checks, plunders and krakenings, each with its own date and member.</li>
              <li>The <strong>layer type</strong> sets the pin state. A Plundered / Krakened layer always ends with that activity: if the text has no such line, one is added on the pin's latest date.</li>
              <li>Keeps the physical description as the pin <strong>Description</strong>; the newest <em>Mon YYYY</em> GSV mention becomes the pin's <strong>GSV date</strong>.</li>
              <li>Mirrors the Placemark's photos into storage after the import (attached to the first sighting).</li>
            </ul>
          </div>

          <div class="guide-section">
            <h3>What it doesn't do</h3>
            <ul class="guide-list">
              <li>Never merges into existing pins: a Placemark whose sign text and coordinates already exist is listed as <strong>already imported</strong> and skipped — re-uploading a file is safe.</li>
              <li>Doesn't geocode City / State / ZIP; those come from the Placemark name and text only.</li>
              <li>Doesn't queue anything for review — everything lands approved by you.</li>
            </ul>
          </div>

          <details class="guide-section guide-details">
            <summary>How a description is read</summary>
            <ul class="guide-list">
              <li><strong>Name</strong> → <code>STATE - Sign text (City)</code>.</li>
              <li>Lines starting with <em>Reported / Recorded / Investigated / Last checked / Last confirmed / Updated / a date:</em> are activities. <em>Reported … and plundered by ASP (XX)</em> is a sighting plus a plunder on the same day; <em>Updated …: Plundered 09/23/25 by ASP (XX)</em> uses the nested date.</li>
              <li><em>plundered / pillaged / removed by ASP</em> → <strong>plundered</strong>; <em>Krakened / taken by the Kraken / Huzzah for the Kraken</em> → <strong>krakened</strong> (also when it sits in a description sentence); in the Questionable layer sightings are <strong>questionable</strong>.</li>
              <li><strong>Member</strong> = the profile whose initials match <code>ASP (XX)</code> on that line; the pin is credited to its first attributed activity. Unknown initials import without a member (listed in the summary).</li>
              <li><em>Recidivist / repeat offender / previously … / a similar sign …</em> notes stay in the description and never create activities.</li>
              <li>An activity with no date of its own gets the pin's latest date; a pin with <strong>no date at all</strong> needs a decision. More than {{ MAX_FLAGS }} of those and the file is refused.</li>
              <li><strong>Sign type</strong> from keywords (sticker/barnacle, banner, graffiti, cross, literature, sign). Photos from <code>gx_media_links</code>.</li>
            </ul>
          </details>
        </div>
      </aside>
    </div>
  </section>
</template>

<script setup>
import { ref, inject, computed } from 'vue'
import { useToast } from '@/shared/ui/useToast'
import { errorToUserMessage } from '@/shared/lib/errors'
import { logger } from '@/shared/lib/logger'
import { LAYER_KINDS } from '@/pages/kml-import/parser/index.js'
import { useKmlImport, MAX_FLAGS } from '@/pages/kml-import/useKmlImport'
import { usePhotoMirrorQueue } from '@/pages/kml-import/usePhotoMirrorQueue'

const user = inject('user', null)
const currentUid = computed(() => user?.value?.id ?? null)
const { show: showToast } = useToast()

const photoQueue = usePhotoMirrorQueue()
const q = photoQueue.q
const imp = useKmlImport({ currentUid, photoQueue })
const summary = computed(() => imp.summary.value)

// Help drawer: open on first visit only, then remember the user's choice.
const HELP_LS = 'kmlImport.helpOpen'
const helpOpen = ref((() => {
  try { const v = localStorage.getItem(HELP_LS); return v == null ? true : v === '1' } catch { return true }
})())
function toggleHelp() {
  helpOpen.value = !helpOpen.value
  try { localStorage.setItem(HELP_LS, helpOpen.value ? '1' : '0') } catch {}
}

const importTitle = computed(() => {
  if (!imp.parsed.value) return 'Upload a KML first'
  if (!currentUid.value) return 'Sign in to import'
  if (!imp.kindValue.value) return 'Pick the layer type'
  if (imp.tooManyFlags.value) return 'Too many pins without dates'
  if (imp.result.value) return 'Done — upload another file to import more'
  if (!imp.toImport.value.length) return 'Nothing new to import'
  return 'Write pins, activities and queue photos'
})

async function onFile(e) {
  const file = e.target.files?.[0]
  try {
    await imp.loadFile(file)
  } catch (err) {
    logger.error('KML parse failed', err)
    imp.error.value = errorToUserMessage(err, 'Could not parse KML file.')
    showToast(imp.error.value, 'error')
  } finally {
    e.target.value = ''
  }
}

async function onImport() {
  try {
    const r = await imp.importAll()
    if (r) showToast(`Imported ${r.pins} pins, ${r.activities} activities; ${r.photos} photos queued.`, 'success', 5000)
  } catch (err) {
    logger.error('KML import failed', err)
    const msg = errorToUserMessage(err, 'Import failed.')
    imp.error.value = `${msg} Imported so far: ${imp.progress.value.done}/${imp.progress.value.total} pins — re-upload the file to continue (done pins are skipped).`
    showToast(msg, 'error')
  }
}

function clearAll() { imp.reset() }
</script>

<style scoped>
.wrap { padding:20px; color:#eee; min-height:100vh; background:#1e1e1e; }
h1 { margin:0 0 12px; color:#ffd700; font-size: 18px; }
.page-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }
.page-head h1 { margin:0; }
.help-toggle { white-space:nowrap; }
.help-toggle.active { background:#3b3b3b; border-color:#f7cf57; color:#f7cf57; }
/* Desktop: push drawer — the guide takes a column beside the content when open. */
.import-layout { display:grid; grid-template-columns: minmax(0, 1fr); gap:18px; align-items:start; }
.import-layout.help-open { grid-template-columns: minmax(0, 1fr) 360px; }
.import-main { min-width:0; }
.import-sidebar { position: sticky; top: 20px; max-height: calc(100vh - 40px); overflow:auto; }
.help-scrim { display:none; }
.guide-list ol, ol.guide-list { padding-left:20px; }
.guide-details summary { cursor:pointer; font-size:14px; color:#f7cf57; font-weight:600; list-style:none; display:flex; align-items:center; gap:6px; }
.guide-details summary::before { content:'▸'; font-size:12px; transition: transform .15s ease; }
.guide-details[open] summary::before { transform: rotate(90deg); }
.guide-details summary::-webkit-details-marker { display:none; }
.guide-details[open] > .guide-list { margin-top:8px; }
.guide-card { border:1px solid #333; border-radius:12px; background:linear-gradient(180deg, #252525 0%, #1f1f1f 100%); padding:16px; box-shadow:0 8px 24px rgba(0,0,0,.18); }
.guide-eyebrow { font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:#f7cf57; margin-bottom:6px; }
.guide-card h2 { margin:0 0 8px; font-size:18px; color:#f3f4f6; }
.guide-section + .guide-section { margin-top:14px; padding-top:14px; border-top:1px solid #333; }
.guide-section h3 { margin:0 0 8px; font-size:14px; color:#f7cf57; }
.guide-list { margin:0; padding-left:18px; color:#d6dae0; line-height:1.45; }
.guide-list li + li { margin-top:8px; }

.uploader { display:flex; gap:10px; align-items:center; margin:10px 0 16px; flex-wrap:wrap; }
.ghost { background:#333; color:#eee; border:1px solid #444; border-radius:6px; padding:6px 10px; cursor:pointer; }
.ghost[disabled] { opacity:.6; cursor:not-allowed; }
.ghost.primary { background:#1e90ff; border-color:#1e90ff; color:#fff; font-weight:600; }
.error { background:#5b1a1a; border:1px solid #8a2a2a; padding:10px; border-radius:8px; margin:8px 0; }
.muted { opacity:.8; }
.muted.warn { color:#ffd700; opacity:1; margin-top:6px; }
.nowrap { white-space:nowrap; }
.card { border:1px solid #333; border-radius:10px; background:#242424; padding:12px 14px; margin:0 0 12px; }
.card-title { font-weight:600; color:#f7cf57; margin-bottom:8px; }
.layer-row { display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
.layer-row select, .flag-actions select, .flag-actions input { background:#1b1b1b; color:#eee; border:1px solid #444; border-radius:6px; padding:6px 8px; }
.check { display:flex; align-items:center; gap:6px; }
.stats { display:flex; flex-wrap:wrap; gap:8px 18px; margin-bottom:6px; }
.stat { display:flex; flex-direction:column; min-width:72px; }
.stat b { font-size:18px; color:#fff; }
.stat span { font-size:12px; opacity:.75; text-transform:capitalize; }
.flag-row { display:flex; gap:12px; align-items:flex-start; justify-content:space-between; padding:8px 0; border-top:1px solid #333; }
.flag-main { min-width:0; }
.flag-name { font-weight:600; }
.flag-desc { font-size:13px; opacity:.8; white-space:pre-wrap; max-height:4.5em; overflow:hidden; }
.flag-actions { display:flex; gap:8px; flex-shrink:0; }
.actions { display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin:8px 0 16px; }
.chip { display:inline-flex; align-items:center; gap:6px; padding:4px 8px; border-radius:999px; font-size:12px; line-height:1; background:#2a2a2a; border:1px solid #3a3a3a; color:#ddd; }
.chip.ok { border-color:#2e7d32; color:#b9f6ca; }
.progress-row { display:flex; gap:8px; align-items:center; margin:.25rem 0; }
.bar { flex:1; background:#2b2b2b; border-radius:6px; overflow:hidden; height:10px; }
.bar > div { height:100%; background:#1e90ff; }
.btn-row { display:flex; gap:8px; margin:.25rem 0; }
.log { max-height:180px; overflow:auto; background:#111; padding:.5rem; border:1px solid #333; border-radius:6px; }
.log summary { cursor:pointer; }
.log-body { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12px; line-height:1.35; }

/* Narrow: overlay drawer from the right with a scrim; Esc / scrim / ✕ closes. */
@media (max-width: 980px) {
  .import-layout, .import-layout.help-open { grid-template-columns: 1fr; }
  .help-scrim { display:block; position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:6000; }
  .import-sidebar {
    position:fixed; top: var(--topbar-h, 56px); right:0; bottom:0;
    width:min(420px, 92vw); max-height:none; overflow:auto; z-index:6001;
    box-shadow:-10px 0 30px rgba(0,0,0,.4); background:#1f1f1f;
  }
  .import-sidebar .guide-card { border-radius:0; border-width:0 0 0 1px; min-height:100%; }
  .flag-row { flex-direction:column; }
}
</style>
