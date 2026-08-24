import { describe, it, expect } from 'vitest'
import { formatDateOnly, formatDateTime, formatMonthYear } from './date.js'

describe('date helpers', () => {
  it('format a date, a date-time and a month', () => {
    const d = new Date(2026, 7, 22, 15, 5)
    expect(formatDateOnly(d)).toMatch(/Aug 22, 2026/)
    expect(formatDateTime(d)).toMatch(/Aug 22, 2026/)
    expect(formatDateTime(d)).toMatch(/3:05|15:05/)
    expect(formatMonthYear(d)).toMatch(/Aug 2026/)
  })
  it('treats date-only strings as local calendar dates, not UTC midnight (#126)', () => {
    // In any zone west of UTC, new Date('2026-08-22') is the evening of Aug 21 — the bug this guards against.
    expect(formatDateOnly('2026-08-22')).toMatch(/Aug 22, 2026/)
    expect(formatMonthYear('2026-03-01')).toMatch(/Mar 2026/)
    expect(formatDateOnly(' 2026-12-31 ')).toMatch(/Dec 31, 2026/)
    // Instants keep their instant semantics.
    expect(formatDateOnly(new Date(2026, 7, 22))).toMatch(/Aug 22, 2026/)
  })
  it('accept ISO strings and fall back on empty/invalid', () => {
    expect(formatDateOnly('2026-08-22T12:00:00Z')).toMatch(/2026/)
    expect(formatDateOnly('')).toBe('—')
    expect(formatDateTime(null)).toBe('—')
    expect(formatMonthYear('nope', '-')).toBe('-')
  })
})
