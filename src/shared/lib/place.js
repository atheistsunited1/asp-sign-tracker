// "City, ST" display — one implementation (ADR-0004 §5).
export function formatPlace(city, state, fallback = '—') {
  const c = String(city || '').trim(), s = String(state || '').trim()
  if (c && s) return `${c}, ${s}`
  return c || s || fallback
}
/** Same, from a row that carries city/state. */
export function formatCityState(row = {}, fallback = '—') {
  return formatPlace(row?.city, row?.state, fallback)
}
