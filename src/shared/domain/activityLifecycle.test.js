import { describe, it, expect } from 'vitest'
import { isAuditType, isTerminalType, lifecycleTypeOrDefault, finalFromReportType, finalFromIconType, chronological, validateRestoreOrder } from './activityLifecycle.js'
import { ICON_TYPES } from './pinVisuals.js'

describe('activity lifecycle rules', () => {
  it('classifies types', () => {
    expect(isAuditType('deleted')).toBe(true)
    expect(isAuditType('Restored')).toBe(true)
    expect(isAuditType('sighting')).toBe(false)
    expect(isTerminalType('plundered')).toBe(true)
    expect(isTerminalType('KRAKENED')).toBe(true)
    expect(isTerminalType('questionable')).toBe(false)
    expect(lifecycleTypeOrDefault('Plundered')).toBe('plundered')
    expect(lifecycleTypeOrDefault('relocated')).toBe('sighting')
    expect(lifecycleTypeOrDefault('')).toBe('sighting')
  })
  it('maps report types and icon types to terminal states', () => {
    expect(finalFromReportType('krakened')).toBe('krakened')
    expect(finalFromReportType('Plundered!')).toBe('plundered')
    expect(finalFromReportType('sighting')).toBeNull()
    expect(finalFromIconType(ICON_TYPES.PLUNDERED)).toBe('plundered')
    expect(finalFromIconType(ICON_TYPES.KRAKENED)).toBe('krakened')
    expect(finalFromIconType(ICON_TYPES.REPORTED_SIGNS)).toBeNull()
  })
  it('orders by occurred_on then created_at', () => {
    const rows = [
      { id: 'b', occurred_on: '2026-02-01', created_at: '2026-08-01T00:00:00Z' },
      { id: 'a', occurred_on: '2026-01-01', created_at: '2026-08-02T00:00:00Z' },
      { id: 'c', occurred_on: '2026-02-01', created_at: '2026-07-01T00:00:00Z' },
    ]
    expect(chronological(rows).map((r) => r.id)).toEqual(['a', 'c', 'b'])
  })
  it('restore guard: terminal must be last; audit rows ignored', () => {
    expect(validateRestoreOrder([
      { id: 1, report_type: 'sighting', occurred_on: '2026-01-01' },
      { id: 2, report_type: 'plundered', occurred_on: '2026-02-01' },
      { id: 3, report_type: 'deleted', occurred_on: '2026-03-01' },
    ]).ok).toBe(true)
    const bad = validateRestoreOrder([
      { id: 1, report_type: 'plundered', occurred_on: '2026-01-01' },
      { id: 2, report_type: 'sighting', occurred_on: '2026-02-01' },
    ])
    expect(bad.ok).toBe(false)
    expect(bad.terminal.id).toBe(1)
    expect(bad.next.id).toBe(2)
    expect(validateRestoreOrder([]).ok).toBe(true)
  })
})
