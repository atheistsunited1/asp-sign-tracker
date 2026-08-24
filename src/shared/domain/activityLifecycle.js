// Activity lifecycle rules (pure). An Activity's type is one of the lifecycle
// types (sighting · plundered · krakened · questionable) or an audit marker
// (deleted · restored · relocated). Plundered/krakened are terminal: a pin's
// story ends there, so a terminal activity must be the latest one.
import { ICON_TYPES } from '@/shared/domain/pinVisuals'

export const LIFECYCLE_TYPES = Object.freeze(['sighting', 'plundered', 'krakened', 'questionable'])
export const TERMINAL_TYPES = Object.freeze(['plundered', 'krakened'])
export const AUDIT_TYPES = Object.freeze(['deleted', 'restored'])

const norm = (t) => String(t || '').trim().toLowerCase()

export function isAuditType(reportType = '') {
  return AUDIT_TYPES.includes(norm(reportType))
}
export function isTerminalType(reportType = '') {
  return TERMINAL_TYPES.includes(norm(reportType))
}
/** Any free-text report type → a lifecycle type (unknown → sighting). */
export function lifecycleTypeOrDefault(t = '') {
  const v = norm(t)
  return LIFECYCLE_TYPES.includes(v) ? v : 'sighting'
}
/** 'plundered' | 'krakened' | null — the terminal state a report type intends (loose match). */
export function finalFromReportType(t) {
  const s = norm(t)
  if (s.includes('kraken')) return 'krakened'
  if (s.includes('plunder')) return 'plundered'
  return null
}
/** 'plundered' | 'krakened' | null — the terminal state a pin's icon_type encodes. */
export function finalFromIconType(iconType) {
  if (iconType === ICON_TYPES.PLUNDERED) return 'plundered'
  if (iconType === ICON_TYPES.KRAKENED) return 'krakened'
  return null
}

/** Rows sorted by domain date (occurred_on), then write time — oldest first. */
export function chronological(rows = []) {
  return [...rows].sort((a, b) =>
    String(a?.occurred_on || '').localeCompare(String(b?.occurred_on || ''))
    || (new Date(a?.created_at || 0).getTime() - new Date(b?.created_at || 0).getTime()))
}

/**
 * The restore guard: among non-audit rows in chronological order, a terminal
 * activity may only be the last one. Returns { ok, terminal, next } where
 * `terminal` is the offending terminal row and `next` the row that follows it.
 */
export function validateRestoreOrder(rows = []) {
  const chrono = chronological(rows.filter((r) => !isAuditType(r?.report_type)))
  const i = chrono.findIndex((r) => isTerminalType(r?.report_type))
  if (i !== -1 && i < chrono.length - 1) return { ok: false, terminal: chrono[i], next: chrono[i + 1] }
  return { ok: true, terminal: null, next: null }
}
