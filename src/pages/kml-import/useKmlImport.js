// KML import flow (plan #93 PR 3): one file → parse (pure) → layer + summary +
// flags → resolve flags inline → write pins/activities → queue photos.
//
// Ids are generated client-side so photo keys can be {pin}/{report}/… before the
// rows exist. Rows matching an existing pin (same sign text + coords to ~1 m)
// are listed as already imported and skipped, which makes re-uploads safe.
import { ref, shallowRef, computed } from 'vue'
import { parseKmlFile, summarize, duplicateKey, layerKind } from '@/pages/kml-import/parser/index.js'
import {
  fetchProfilesByInitials,
  insertPins,
  insertReports,
  listPhotoBucket,
  loadExistingPinRows,
} from '@/pages/kml-import/kmlImportService'
import { PHOTO_BUCKET } from '@/shared/data/photoStorage'
import { defaultColorForPin } from '@/shared/domain/pinVisuals'

export const MAX_FLAGS = 20
const CHUNK = 500
const todayIso = () => new Date().toISOString().slice(0, 10)
const newId = () => crypto.randomUUID()

export function useKmlImport({ currentUid, photoQueue }) {
  const fileName = ref('')
  const text = shallowRef('')
  const parsed = shallowRef(null)          // { layerName, detected, kind, rows, skipped, duplicates }
  const kindValue = ref(null)              // editable layer kind (value from LAYER_KINDS)
  const isMajorCampaign = ref(false)
  const existingKeys = shallowRef(new Set())
  const profiles = shallowRef(new Map())   // INITIALS → profiles.id
  const resolutions = ref({})              // row.key → { action: 'import'|'skip', date }
  const isLoading = ref(false)
  const isImporting = ref(false)
  const progress = ref({ done: 0, total: 0 })
  const error = ref('')
  const result = ref(null)

  function reset() {
    fileName.value = ''; text.value = ''; parsed.value = null; kindValue.value = null
    isMajorCampaign.value = false; resolutions.value = {}; error.value = ''; result.value = null
    progress.value = { done: 0, total: 0 }
    photoQueue.reset()
  }

  function parse() {
    const res = parseKmlFile(text.value, kindValue.value == null ? undefined : kindValue.value)
    res.rows.forEach((r, i) => { r.key = i })
    parsed.value = res
    if (kindValue.value == null) {
      kindValue.value = res.detected.kind
      isMajorCampaign.value = res.detected.isMajorCampaign
    }
    const next = {}
    for (const r of res.rows) if (r.flags.length) next[r.key] = resolutions.value[r.key] || { action: 'import', date: todayIso() }
    resolutions.value = next
  }

  async function loadFile(file) {
    reset()
    if (!file) return
    isLoading.value = true
    try {
      fileName.value = file.name
      text.value = await file.text()
      parse()
      const rows = await loadExistingPinRows()
      existingKeys.value = new Set(rows.map((p) => duplicateKey({ signText: p.sign_text, lat: p.lat, lng: p.lng })))
      profiles.value = await fetchProfilesByInitials(summarize(parsed.value.rows).initials)
    } catch (e) {
      parsed.value = null
      throw e
    } finally {
      isLoading.value = false
    }
  }

  function setKind(value) {
    kindValue.value = value
    if (text.value) parse()
  }

  const rows = computed(() => parsed.value?.rows || [])
  const alreadyImported = computed(() => rows.value.filter((r) => existingKeys.value.has(duplicateKey(r))))
  const fresh = computed(() => rows.value.filter((r) => !existingKeys.value.has(duplicateKey(r))))
  const flagged = computed(() => fresh.value.filter((r) => r.flags.length))
  const tooManyFlags = computed(() => flagged.value.length > MAX_FLAGS)
  const summary = computed(() => summarize(fresh.value))
  const unmatchedInitials = computed(() => summary.value.initials.filter((i) => !profiles.value.get(i)))
  const toImport = computed(() => fresh.value.filter((r) => resolutions.value[r.key]?.action !== 'skip'))
  const canImport = computed(() =>
    !!parsed.value && !!kindValue.value && !!currentUid.value && toImport.value.length > 0
    && !tooManyFlags.value && !isImporting.value && !isLoading.value && !result.value,
  )

  function setResolution(row, patch) {
    resolutions.value = { ...resolutions.value, [row.key]: { ...(resolutions.value[row.key] || {}), ...patch } }
  }

  /** Write pins + activities (chunked), queue photos, and start mirroring. */
  async function importAll() {
    if (!canImport.value) return
    isImporting.value = true
    error.value = ''
    try {
      const { error: bucketErr } = await listPhotoBucket(PHOTO_BUCKET, { path: '', limit: 1 })
      if (bucketErr) throw new Error(`Cannot access Storage bucket "${PHOTO_BUCKET}".`)

      const kind = layerKind(kindValue.value)
      const uid = currentUid.value
      const batches = []
      let pinsDone = 0, activitiesDone = 0, photosQueued = 0

      for (const r of toImport.value) {
        const res = resolutions.value[r.key]
        const pinId = newId()
        const acts = r.activities.map((a) => ({
          id: newId(),
          type: a.type,
          occurredOn: a.occurredOn || res?.date || todayIso(),
          submittedBy: a.initials ? (profiles.value.get(a.initials) ?? null) : null,
        }))
        const pin = {
          id: pinId,
          lat: r.lat,
          lng: r.lng,
          icon_type: kind.iconType,
          is_major_campaign: !!isMajorCampaign.value,
          icon_color: defaultColorForPin({ iconType: kind.iconType, isMajorCampaign: !!isMajorCampaign.value, signType: r.signType }),
          description: r.description || null,
          sign_text: r.signText || null,
          sign_type: r.signType,
          city: r.city || null,
          state: r.state || null,
          zip: r.zip || null,
          gsv_date: r.gsvDate || null,
          is_approved: true,
          approved_by: uid,
          submitted_by: acts.find((a) => a.submittedBy)?.submittedBy ?? null,
        }
        const reports = acts.map((a) => ({
          id: a.id,
          pin_id: pinId,
          report_type: a.type,
          occurred_on: a.occurredOn,
          submitted_by: a.submittedBy,
          is_approved: true,
          approved_by: uid,
        }))
        // Placemark photos belong to the earliest activity (the sighting).
        const photos = r.photos?.length ? { pinId, reportId: acts[0].id, urls: r.photos } : null
        batches.push({ pin, reports, photos, key: duplicateKey(r) })
      }

      progress.value = { done: 0, total: batches.length }
      for (let i = 0; i < batches.length; i += CHUNK) {
        const slice = batches.slice(i, i + CHUNK)
        const { error: pinErr } = await insertPins(slice.map((b) => b.pin))
        if (pinErr) throw pinErr
        pinsDone += slice.length
        const reports = slice.flatMap((b) => b.reports)
        const { error: repErr } = await insertReports(reports)
        if (repErr) throw repErr
        activitiesDone += reports.length
        const next = new Set(existingKeys.value)
        for (const b of slice) {
          next.add(b.key)
          if (b.photos) { photoQueue.enqueue(b.photos); photosQueued += b.photos.urls.length }
        }
        existingKeys.value = next
        progress.value = { done: Math.min(i + CHUNK, batches.length), total: batches.length }
      }

      result.value = { pins: pinsDone, activities: activitiesDone, photos: photosQueued }
      if (photosQueued) photoQueue.start()
      return result.value
    } catch (e) {
      error.value = e?.message || String(e)
      throw e
    } finally {
      isImporting.value = false
    }
  }

  return {
    // state
    fileName, parsed, kindValue, isMajorCampaign, isLoading, isImporting, progress, error, result, resolutions,
    // derived
    rows, alreadyImported, fresh, flagged, tooManyFlags, summary, unmatchedInitials, toImport, canImport,
    // actions
    loadFile, setKind, setResolution, importAll, reset,
  }
}
