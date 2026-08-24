// Placemark name → { state, signText, city } and sign-type inference. Pure.
//
// Names are `STATE - Sign text (City)` with optional wrapping quotes; missing parts
// fall back (no state / no city; whole name as sign text).

const stripQuotes = (s = '') => String(s).trim().replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, '')

export function parseLegacyName(name = '') {
  const s = stripQuotes(name)
  const full = /^([A-Z]{2})\s*-\s*(.*?)\s*(?:\(\s*(.+?)\s*\))?\s*$/.exec(s)
  if (full) {
    return { state: full[1].toUpperCase(), signText: stripQuotes(full[2]), city: stripQuotes(full[3] || '') }
  }
  const cityMatch = /\(\s*(.+?)\s*\)\s*$/.exec(s)
  const city = cityMatch ? stripQuotes(cityMatch[1]) : ''
  const body = cityMatch ? s.slice(0, cityMatch.index).trim() : s
  const lead = /^([A-Z]{2})\s*-\s*(.+)$/.exec(body)
  if (lead) return { state: lead[1].toUpperCase(), signText: stripQuotes(lead[2]), city }
  return { state: '', signText: stripQuotes(body), city }
}

export const SIGN_TYPES = Object.freeze(['sign', 'billboard', 'sticker', 'banner', 'graffiti', 'stationary', 'literature', 'cross', 'other'])

const hasAny = (s, words) => words.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(String(s || '')))

/**
 * Sign type from name + description keywords (precedence as the legacy importer),
 * with the Billboards layer forcing `billboard`.
 */
export function inferSignType({ name = '', description = '', layerSignType = null } = {}) {
  if (layerSignType) return layerSignType
  if (hasAny(name, ['billboard']) || hasAny(description, ['billboard'])) return 'billboard'
  if (hasAny(name, ['sticker', 'stickers']) || hasAny(description, ['sticker', 'stickers', 'barnacle'])) return 'sticker'
  if (hasAny(name, ['banner']) || hasAny(description, ['banner'])) return 'banner'
  if (hasAny(name, ['graffiti', 'grafitti', 'paint', 'painted']) || hasAny(description, ['graffiti', 'grafitti', 'paint', 'painted'])) return 'graffiti'
  if (hasAny(name, ['cross', 'crosses']) || hasAny(description, ['cross', 'crosses'])) return 'cross'
  if (hasAny(name, ['literature']) || hasAny(description, ['literature'])) return 'literature'
  if (hasAny(name, ['sign', 'signs', 'coroplast', 'jesus']) || hasAny(description, ['sign', 'signs', 'coroplast', 'jesus'])) return 'sign'
  return 'other'
}
