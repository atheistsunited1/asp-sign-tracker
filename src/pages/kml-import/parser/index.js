// KML → import rows. Pure; the composable adds DB lookups and writes.
import { parseKmlDocument } from '@/pages/kml-import/parser/kml.js'
import { detectLayer, layerKind } from '@/pages/kml-import/parser/layer.js'
import { parseLegacyName, inferSignType } from '@/pages/kml-import/parser/name.js'
import { parseDescription } from '@/pages/kml-import/parser/description.js'
import { descriptionToText, toLines } from '@/pages/kml-import/parser/text.js'

export { parseKmlDocument } from '@/pages/kml-import/parser/kml.js'
export { detectLayer, layerKind, LAYER_KINDS } from '@/pages/kml-import/parser/layer.js'
export { parseDescription } from '@/pages/kml-import/parser/description.js'
export { descriptionToText, toLines } from '@/pages/kml-import/parser/text.js'

/** One Placemark → one import row (or `{ skipped: 'no-coords' }`). */
export function parsePlacemark(pm, kind) {
  if (!pm.coordinates) return { skipped: 'no-coords', name: pm.name }
  const { state, signText, city } = parseLegacyName(pm.name)
  const lines = toLines(descriptionToText(pm.description))
  const parsed = parseDescription(lines, kind || {})
  return {
    name: pm.name,
    state, city, signText,
    signType: inferSignType({ name: pm.name, description: parsed.description, layerSignType: kind?.signType || null }),
    lat: pm.coordinates.lat,
    lng: pm.coordinates.lng,
    photos: pm.photos,
    description: parsed.description || null,
    gsvDate: parsed.gsvDate,
    latestDate: parsed.latestDate,
    activities: parsed.activities,
    flags: parsed.flags,
    zip: zipIn(parsed.description),
  }
}

const zipIn = (s = '') => { const m = /\b(\d{5})(?:-\d{4})?\b/.exec(s || ''); return m ? m[1] : null }

/** Key for the "same placemark imported twice" guard: sign text + coords to ~1 m. */
export function duplicateKey({ signText = '', lat, lng } = {}) {
  return `${String(signText || '').trim().toLowerCase()}|${Number(lat).toFixed(5)}|${Number(lng).toFixed(5)}`
}

/**
 * Whole file → `{ layerName, layer, rows, skipped }` using the given layer kind
 * (defaults to the one detected from the layer name).
 */
export function parseKmlFile(text, kindValue = undefined) {
  const doc = parseKmlDocument(text)
  const detected = detectLayer(doc.layerName)
  const kind = layerKind(kindValue === undefined ? detected.kind : kindValue)
  const rows = [], skipped = [], duplicates = []
  const seen = new Set()
  for (const pm of doc.placemarks) {
    const r = parsePlacemark(pm, kind)
    if (r.skipped) { skipped.push(r); continue }
    // My Maps sometimes holds the same placemark twice; an exact repeat
    // (same text, coords and activities) is dropped, anything else is kept.
    const key = `${duplicateKey(r)}|${JSON.stringify(r.activities)}`
    if (seen.has(key)) { duplicates.push(r); continue }
    seen.add(key)
    rows.push(r)
  }
  return { layerName: doc.layerName, detected, kind, rows, skipped, duplicates }
}

/** Counts for the summary card. */
export function summarize(rows = []) {
  const byType = {}
  let activities = 0, dateSynthesized = 0, synthesized = 0, photos = 0
  const unknownInitials = new Set()
  for (const r of rows) {
    photos += r.photos?.length || 0
    for (const a of r.activities) {
      activities++
      byType[a.type] = (byType[a.type] || 0) + 1
      if (a.dateSynthesized) dateSynthesized++
      if (a.synthesized) synthesized++
      if (a.initials) unknownInitials.add(a.initials)
    }
  }
  return {
    pins: rows.length,
    activities,
    byType,
    dateSynthesized,
    synthesized,
    photos,
    flagged: rows.filter((r) => r.flags.length).length,
    withGsvDate: rows.filter((r) => r.gsvDate).length,
    initials: Array.from(unknownInitials).sort(),
  }
}
