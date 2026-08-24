// CSV export: one row per pin, the My Maps CSV shape (name, description,
// coordinates, photos) plus explicit columns analysts want. Pure.
import Papa from 'papaparse'
import { placemarkName, descriptionText } from '@/pages/export/kmlWriter.js'

export const CSV_COLUMNS = Object.freeze([
  'friendly_id', 'pin_id', 'name', 'state', 'city', 'zip', 'lat', 'lng',
  'sign_text', 'sign_type', 'bucket', 'is_major_campaign', 'campaign', 'gsv_date',
  'description', 'activity_lines', 'first_activity', 'last_activity',
  'n_sightings', 'n_plundered', 'n_krakened', 'n_questionable', 'photo_urls', 'photo_count',
])

const count = (acts, type) => acts.filter((a) => a.type === type).length

/** Export row `{ pin, activities, photos }` → flat CSV record. */
export function csvRecord(row) {
  const p = row.pin || {}
  const acts = [...(row.activities || [])].sort((a, b) => String(a.occurred_on).localeCompare(String(b.occurred_on)))
  const photos = row.photos || []
  return {
    friendly_id: p.friendly_id || '',
    pin_id: p.id || '',
    name: placemarkName(p),
    state: p.state || '', city: p.city || '', zip: p.zip || '',
    lat: p.lat, lng: p.lng,
    sign_text: p.sign_text || '', sign_type: p.sign_type || '',
    bucket: p.bucket || '',
    is_major_campaign: p.is_major_campaign ? 'true' : 'false',
    campaign: p.campaign || '',
    gsv_date: p.gsv_date || '',
    description: p.description || '',
    activity_lines: descriptionText({ pin: { description: '' }, activities: acts }),
    first_activity: acts[0]?.occurred_on || '',
    last_activity: acts[acts.length - 1]?.occurred_on || '',
    n_sightings: count(acts, 'sighting'),
    n_plundered: count(acts, 'plundered'),
    n_krakened: count(acts, 'krakened'),
    n_questionable: count(acts, 'questionable'),
    photo_urls: photos.join(' '),
    photo_count: photos.length,
  }
}

/** CSV text (UTF-8 BOM so Excel opens it as UTF-8). */
export function csvText(rows = []) {
  return String.fromCharCode(0xfeff) + Papa.unparse(rows.map(csvRecord), { columns: [...CSV_COLUMNS], newline: '\r\n' })
}
