// Text helpers for the KML importer: entity decoding, HTML → lines, and the two
// date shapes My Maps descriptions use (`MM/DD/YY` and `Mon YYYY`). Pure.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** Decode XML/HTML entities (named subset + numeric). */
export function decodeEntities(s = '') {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    const k = e.toLowerCase()
    return Object.prototype.hasOwnProperty.call(ENTITIES, k) ? ENTITIES[k] : m
  })
}

/**
 * Raw `<description>` content → plain text with newlines. Accepts CDATA or
 * entity-escaped HTML; strips images and tags.
 */
export function descriptionToText(raw = '') {
  const m = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(String(raw))
  let s = m ? m[1] : decodeEntities(raw)
  s = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr)>/gi, '\n')
    .replace(/<a\b[^>]*>\s*<img[\s\S]*?>\s*<\/a>/gi, '')
    .replace(/<img[\s\S]*?>/gi, '')
    .replace(/<\/?[^>]+>/g, '')
  return decodeEntities(s).split(String.fromCharCode(160)).join(' ').replace(/\r\n?/g, '\n')
}

const BARE_COORDS_RE = /^-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+\s*$/
const LEAD_JUNK_RE = /^[\s"“”'‘’•>\-–—]+/
const TAIL_QUOTES_RE = /[\s"“”'‘’]+$/

/**
 * Description text → trimmed, non-empty lines. Drops the legacy PIN_UUID header,
 * bare coordinate lines (the Placemark already has coordinates) and wrapping quotes.
 */
export function toLines(text = '') {
  const s = String(text).trim().replace(/^["“”]([\s\S]*)["“”]$/, '$1')
  return s
    .split('\n')
    .map((l) => l.replace(LEAD_JUNK_RE, '').replace(TAIL_QUOTES_RE, '').trim())
    .filter((l) => l && !BARE_COORDS_RE.test(l) && !/^PIN_UUID:/i.test(l))
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 }
const pad = (n) => String(n).padStart(2, '0')

export const DATE_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/g
export const MONTH_RE = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?,?\s+((?:19|20)\d{2})\b/gi

/** `M/D/YY` or `M/D/YYYY` → ISO date, or null when out of range. */
export function isoFromMdy(m, d, y) {
  let year = Number(y); if (year < 100) year += 2000
  const month = Number(m), day = Number(d)
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1990 || year > 2099) return null
  return `${year}-${pad(month)}-${pad(day)}`
}

/** All `MM/DD/YY` dates in a line, in order, as ISO strings. */
export function findDates(line = '') {
  const out = []
  for (const m of String(line).matchAll(DATE_RE)) {
    const iso = isoFromMdy(m[1], m[2], m[3])
    if (iso) out.push(iso)
  }
  return out
}

/** All `Mon YYYY` months in a line as ISO first-of-month dates. */
export function findMonths(line = '') {
  const out = []
  for (const m of String(line).matchAll(MONTH_RE)) {
    const mon = MONTHS[m[1].toLowerCase().slice(0, 4)] || MONTHS[m[1].toLowerCase().slice(0, 3)]
    if (mon) out.push(`${m[2]}-${pad(mon)}-01`)
  }
  return out
}

/** Latest ISO date in a list (lexical compare works for ISO), or null. */
export function maxIso(list = []) {
  let best = null
  for (const d of list) if (d && (!best || d > best)) best = d
  return best
}
