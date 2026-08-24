import { describe, it, expect } from 'vitest'
import { quarterOf, quarterRange, shiftQuarter, lastQuarters, previousWindow, periodLabel, daysBetween } from '@/pages/dashboard/quarters.js'

describe('quarters', () => {
  it('maps dates to quarters and back', () => {
    expect(quarterOf('2026-01-15')).toBe('2026-Q1')
    expect(quarterOf('2026-12-31')).toBe('2026-Q4')
    expect(quarterRange('2026-Q1')).toEqual({ from: '2026-01-01', to: '2026-03-31' })
    expect(quarterRange('2024-Q1')).toEqual({ from: '2024-01-01', to: '2024-03-31' })
    expect(quarterRange('2026-Q2')).toEqual({ from: '2026-04-01', to: '2026-06-30' })
    expect(quarterRange('nope')).toBeNull()
  })
  it('shifts across year boundaries and lists the trailing quarters', () => {
    expect(shiftQuarter('2026-Q1', -1)).toBe('2025-Q4')
    expect(shiftQuarter('2025-Q4', 1)).toBe('2026-Q1')
    expect(lastQuarters('2026-Q1', 8)).toEqual(['2024-Q2', '2024-Q3', '2024-Q4', '2025-Q1', '2025-Q2', '2025-Q3', '2025-Q4', '2026-Q1'])
  })
  it('computes the preceding window of equal length', () => {
    expect(daysBetween('2026-01-01', '2026-03-31')).toBe(90)
    expect(previousWindow('2026-01-01', '2026-03-31')).toEqual({ from: '2025-10-03', to: '2025-12-31' })
    expect(previousWindow('2026-03-01', '2026-03-07')).toEqual({ from: '2026-02-22', to: '2026-02-28' })
  })
  it('labels exact quarters by name and other ranges literally', () => {
    expect(periodLabel('2026-01-01', '2026-03-31')).toBe('2026-Q1')
    expect(periodLabel('2026-01-01', '2026-02-15')).toBe('2026-01-01 → 2026-02-15')
  })
})
