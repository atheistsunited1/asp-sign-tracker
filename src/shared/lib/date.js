// Date display helpers — the one place the app formats dates (ADR-0004 §5).
// Empty/invalid values render as the fallback ('—').
const DATE_ONLY = { year: 'numeric', month: 'short', day: 'numeric' }
const DATE_TIME = { ...DATE_ONLY, hour: '2-digit', minute: '2-digit' }
const MONTH_YEAR = { month: 'short', year: 'numeric' }

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Date-only values (`occurred_on`, `gsv_date`: "YYYY-MM-DD") are calendar dates, not instants — parse them in local
 * time. `new Date('2026-08-22')` would be UTC midnight and render as Aug 21 in US zones (#126).
 */
function toDate(v) {
  if (v == null || v === '') return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  const m = typeof v === 'string' ? DATE_ONLY_RE.exec(v.trim()) : null
  const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "Aug 22, 2026" */
export function formatDateOnly(v, fallback = '—') {
  const d = toDate(v); return d ? d.toLocaleDateString(undefined, DATE_ONLY) : fallback
}
/** "Aug 22, 2026, 03:15 PM" */
export function formatDateTime(v, fallback = '—') {
  const d = toDate(v); return d ? d.toLocaleString(undefined, DATE_TIME) : fallback
}
/** "Aug 2026" */
export function formatMonthYear(v, fallback = '—') {
  const d = toDate(v); return d ? d.toLocaleDateString(undefined, MONTH_YEAR) : fallback
}
