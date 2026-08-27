// Writes KML shaped like a Google My Maps layer export (see
// src/features/kml-import/__fixtures__ and example-kml-exports/): one Document
// = one layer, one Placemark per pin named `STATE - Sign text (City)`, a
// description in the line grammar the importer reads back (so an export can be
// re-imported losslessly), photo links in ExtendedData `gx_media_links`, plus
// explicit ExtendedData fields. Pure.
import { MAX_PLACEMARKS_PER_FILE } from '@/pages/export/constants.js'

export const BUCKET_STYLES = Object.freeze({
  sighting:     { id: 'icon-1670-0288D1', color: 'ffd18802', label: 'Sighting (still up)' },
  plundered:    { id: 'icon-1881-0F9D58', color: 'ff589d0f', label: 'Plundered' },
  krakened:     { id: 'icon-1819-7CB342', color: 'ff42b37c', label: 'Krakened' },
  questionable: { id: 'icon-1594-9C27B0', color: 'ffb0279c', label: 'Questionable legality' },
})

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** ISO date → MM/DD/YY (My Maps line grammar). */
export function mdy(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : ''
}
/** ISO date → 'Mon YYYY'. */
export function monYear(iso) {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso || ''))
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : ''
}

export function escapeXml(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
const cdata = (s = '') => `<![CDATA[${String(s).replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`

/** `STATE - Sign text (City)` as My Maps names are written. */
export function placemarkName(pin = {}) {
  const text = (pin.sign_text || '').trim() || 'Unknown sign'
  const state = (pin.state || '').trim()
  const city = (pin.city || '').trim()
  return `${state ? `${state} - ` : ''}${text}${city ? ` (${city})` : ''}`
}

const who = (a) => (a.initials ? ` by ASP (${String(a.initials).toUpperCase()})` : '')

/**
 * Activity lines in the My Maps grammar the importer parses:
 *   Reported MM/DD/YY by ASP (XX).            first sighting / questionable
 *   Last checked MM/DD/YY by ASP (XX).        later sightings
 *   Updated MM/DD/YY: Plundered by ASP (XX)! Huzzah!
 *   Updated MM/DD/YY: Per ASP (XX) the sign is no longer there - Krakened!
 */
export function activityLines(activities = []) {
  const acts = [...activities].sort((a, b) => String(a.occurred_on).localeCompare(String(b.occurred_on)))
  const lines = []
  let reported = false
  for (const a of acts) {
    const d = mdy(a.occurred_on)
    switch (a.type) {
      case 'plundered':
        lines.push(`Updated ${d}: Plundered${who(a)}! Huzzah!`); break
      case 'krakened':
        lines.push(`Updated ${d}:${a.initials ? ` Per ASP (${String(a.initials).toUpperCase()})` : ''} the sign is no longer there - Krakened!`); break
      default: // sighting, questionable
        if (!reported) { lines.push(`Reported ${d}${who(a)}.`); reported = true }
        else lines.push(`Last checked ${d}${who(a)}.`)
    }
  }
  return lines
}

/** Full description text: activity lines, physical description, latest GSV month. */
export function descriptionText(row) {
  const lines = activityLines(row.activities || [])
  const desc = String(row.pin?.description || '').trim()
  if (desc) lines.push(...desc.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
  if (row.pin?.gsv_date) lines.push(`GSV dated ${monYear(row.pin.gsv_date)}.`)
  return lines.join('\n')
}

function dataEl(name, value) {
  if (value == null || value === '') return ''
  return `        <Data name="${name}">\n          <value>${cdata(value)}</value>\n        </Data>\n`
}

/** One `<Placemark>` for an export row `{ pin, activities, photos }`. */
export function placemarkXml(row) {
  const p = row.pin || {}
  const acts = [...(row.activities || [])].sort((a, b) => String(a.occurred_on).localeCompare(String(b.occurred_on)))
  const style = BUCKET_STYLES[p.bucket] || BUCKET_STYLES.sighting
  const ext =
    dataEl('gx_media_links', (row.photos || []).join(' ')) +
    dataEl('pin_id', p.id) + dataEl('friendly_id', p.friendly_id) + dataEl('bucket', p.bucket) +
    dataEl('is_major_campaign', p.is_major_campaign ? 'true' : 'false') + dataEl('campaign', p.campaign) +
    dataEl('sign_type', p.sign_type) + dataEl('zip', p.zip) + dataEl('gsv_date', p.gsv_date) +
    dataEl('first_activity', acts[0]?.occurred_on) + dataEl('last_activity', acts[acts.length - 1]?.occurred_on) +
    dataEl('activity_count', String(acts.length))
  return `    <Placemark>
      <name>${escapeXml(placemarkName(p))}</name>
      <description>${cdata(descriptionText(row).replace(/\n/g, '<br>'))}</description>
      <styleUrl>#${style.id}-normal</styleUrl>
      <ExtendedData>
${ext}      </ExtendedData>
      <Point>
        <coordinates>
          ${Number(p.lng)},${Number(p.lat)},0
        </coordinates>
      </Point>
    </Placemark>
`
}

function stylesXml() {
  return Object.values(BUCKET_STYLES).map((s) => `    <Style id="${s.id}-normal">
      <IconStyle>
        <color>${s.color}</color>
        <scale>1</scale>
        <Icon><href>https://www.gstatic.com/mapspro/images/stock/503-wht-blank_maps.png</href></Icon>
      </IconStyle>
      <LabelStyle><scale>0</scale></LabelStyle>
    </Style>
`).join('')
}

/** A complete KML document for `rows` named `layerName`. */
export function kmlDocument(layerName, rows = []) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(layerName)}</name>
    <description/>
${stylesXml()}${rows.map(placemarkXml).join('')}  </Document>
</kml>
`
}

/**
 * Split rows into My Maps-sized files: `[{ filename, text }]`. One file when
 * it fits, else `-partNN` suffixes.
 */
export function kmlFiles(baseName, layerName, rows = [], perFile = MAX_PLACEMARKS_PER_FILE) {
  if (rows.length <= perFile) return [{ filename: `${baseName}.kml`, text: kmlDocument(layerName, rows) }]
  const out = []
  const parts = Math.ceil(rows.length / perFile)
  for (let i = 0; i < parts; i++) {
    const nn = String(i + 1).padStart(2, '0')
    out.push({ filename: `${baseName}-part${nn}.kml`, text: kmlDocument(`${layerName} (part ${i + 1}/${parts})`, rows.slice(i * perFile, (i + 1) * perFile)) })
  }
  return out
}
