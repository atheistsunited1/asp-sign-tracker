#!/usr/bin/env node
// Size guards of ADR-0004 §6: .vue ≤ 600 (routed pages ≤ 400), composables (use*.js) and services (*Service.js)
// ≤ 300 lines. Files above a guard must be listed in EXCEPTIONS with the reason / follow-up issue — the point is
// that growth is a decision, not an accident. Run: `node scripts/check-sizes.mjs` (part of `npm run lint`).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const LIMITS = { page: 400, vue: 600, composable: 300, service: 300 }

// path (posix, relative to repo root) → reason. Remove an entry once the file is back under its guard.
const EXCEPTIONS = {
  'src/pages/bulk-photos/BulkPhotosPage.vue': '522: 243-line template + 229 lines of styles + wiring',
  'src/pages/map/useGoTo.js': '421: verbatim extraction; further splits deferred',
  'src/pages/map/usePinActions.js': '406: verbatim extraction; further splits deferred',
  'src/pages/map/useLeafletMap.js': '376: 230-line onMounted wiring; further splits deferred',
  'src/pages/map/useMapSearch.js': '351: verbatim extraction; further splits deferred',
  'src/pages/map/usePinPopups.js': '342: verbatim extraction; further splits deferred',
  'src/pages/map/report-form/useSubmitReport.js': '349: submission orchestration + background guard + error formatting',
  'src/shared/domain/activityLifecycleService.js': '335: approve / soft-delete / restore / force-delete / purge in one service',
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

function kindOf(rel) {
  const base = rel.split('/').pop()
  if (rel.endsWith('.vue')) return /^src\/pages\/[^/]+\/[A-Z][A-Za-z]*Page\.vue$/.test(rel) ? 'page' : 'vue'
  if (/^use[A-Z].*\.js$/.test(base) && !base.endsWith('.test.js')) return 'composable'
  if (/Service\.js$/.test(base)) return 'service'
  return null
}

const root = process.cwd()
const files = walk(join(root, 'src')).map((p) => relative(root, p).split(sep).join('/'))
const over = [], stale = []
for (const rel of files) {
  const kind = kindOf(rel)
  if (!kind) continue
  const lines = readFileSync(rel, 'utf8').split('\n').length
  const limit = LIMITS[kind]
  if (lines > limit && !EXCEPTIONS[rel]) over.push(`${rel}: ${lines} lines > ${limit} (${kind}) — split by responsibility or add a documented exception`)
  if (lines <= limit && EXCEPTIONS[rel]) stale.push(`${rel}: ${lines} lines ≤ ${limit} — remove its EXCEPTIONS entry`)
}
for (const rel of Object.keys(EXCEPTIONS)) if (!files.includes(rel)) stale.push(`${rel}: listed in EXCEPTIONS but does not exist`)

if (over.length || stale.length) {
  for (const m of [...over, ...stale]) console.error('size-guard:', m)
  process.exit(1)
}
console.log(`size-guard: ok (${files.filter(kindOf).length} files checked, ${Object.keys(EXCEPTIONS).length} documented exceptions)`)
