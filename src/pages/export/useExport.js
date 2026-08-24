// Export page state: filters → preview (one RPC call, rows kept in memory) →
// download KML (My Maps-sized parts) or CSV written from the cached rows.
import { ref, computed } from 'vue'
import { fetchExportPins } from '@/pages/export/exportService'
import { kmlFiles } from '@/pages/export/kmlWriter'
import { csvText } from '@/pages/export/csvWriter'
import { downloadAll, downloadText, KML_MIME, CSV_MIME } from '@/pages/export/download'
import { BUCKETS, MAX_PLACEMARKS_PER_FILE } from '@/pages/export/constants'

const todayIso = () => new Date().toISOString().slice(0, 10)

export function useExport() {
  const buckets = ref(BUCKETS.map((b) => b.value))
  const major = ref('all')
  const state = ref('')
  const from = ref('')
  const to = ref('')
  const format = ref('kml')

  const rows = ref(null)      // last preview result
  const loading = ref(false)
  const error = ref('')

  const filtersKey = computed(() => JSON.stringify({ b: [...buckets.value].sort(), m: major.value, s: state.value.trim().toUpperCase(), f: from.value, t: to.value }))
  const previewedKey = ref('')
  const stale = computed(() => !!rows.value && previewedKey.value !== filtersKey.value)

  const countsByBucket = computed(() => {
    const out = {}
    for (const r of rows.value || []) out[r.pin?.bucket] = (out[r.pin?.bucket] || 0) + 1
    return out
  })
  const photoCount = computed(() => (rows.value || []).reduce((n, r) => n + (r.photos?.length || 0), 0))
  const parts = computed(() => Math.max(1, Math.ceil((rows.value?.length || 0) / MAX_PLACEMARKS_PER_FILE)))

  /** Human layer name + file base from the current filters. */
  const selectionLabel = computed(() => {
    const b = buckets.value.length === BUCKETS.length ? 'All signs' : BUCKETS.filter((x) => buckets.value.includes(x.value)).map((x) => x.label).join(' + ')
    const bits = [b]
    if (major.value === 'only') bits.push('Major Campaign')
    if (major.value === 'exclude') bits.push('non-Major Campaign')
    if (state.value.trim()) bits.push(state.value.trim().toUpperCase())
    if (from.value || to.value) bits.push(`${from.value || '…'} → ${to.value || '…'}`)
    return bits.join(' — ')
  })
  const fileBase = computed(() => {
    const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const b = buckets.value.length === BUCKETS.length ? 'all' : buckets.value.join('+')
    return ['asp', slug(b), major.value !== 'all' ? major.value + '-major' : '', slug(state.value), from.value || to.value ? `${from.value || 'start'}_${to.value || 'now'}` : '', todayIso()].filter(Boolean).join('-')
  })

  async function preview() {
    if (!buckets.value.length) { error.value = 'Pick at least one bucket.'; return }
    loading.value = true; error.value = ''
    try {
      rows.value = await fetchExportPins({ buckets: buckets.value, major: major.value, state: state.value.trim().toUpperCase() || null, from: from.value || null, to: to.value || null })
      previewedKey.value = filtersKey.value
    } catch (e) {
      error.value = e?.message || String(e)
      rows.value = null
    } finally {
      loading.value = false
    }
  }

  async function download() {
    if (!rows.value?.length) return
    if (format.value === 'csv') {
      downloadText(`${fileBase.value}.csv`, csvText(rows.value), CSV_MIME)
    } else {
      await downloadAll(kmlFiles(fileBase.value, selectionLabel.value, rows.value), KML_MIME)
    }
  }

  function toggleBucket(v) {
    buckets.value = buckets.value.includes(v) ? buckets.value.filter((x) => x !== v) : [...buckets.value, v]
  }

  return {
    buckets, major, state, from, to, format,
    rows, loading, error, stale, countsByBucket, photoCount, parts, selectionLabel, fileBase,
    preview, download, toggleBucket,
  }
}
