import { describe, it, expect, vi } from 'vitest'

// Only pure helpers are under test; mock the enrichment service so the import
// chain (nearbyPinsService → repos → supabase client) doesn't require
// VITE_SUPABASE_* env at module load — CI runs without a .env.
vi.mock('@/shared/domain/nearbyPinsService', () => ({ fetchNearbyPinsEnrichment: vi.fn() }))

import { lastActivityMs, sortPinsByLastActivity } from '@/shared/domain/pinUtils'

describe('lastActivityMs', () => {
  it('prefers last_activity_at over created_at', () => {
    const pin = { last_activity_at: '2026-08-03T00:00:00Z', created_at: '2020-01-01T00:00:00Z' }
    expect(lastActivityMs(pin)).toBe(Date.parse('2026-08-03T00:00:00Z'))
  })
  it('falls back to created_at', () => {
    expect(lastActivityMs({ created_at: '2020-01-01T00:00:00Z' })).toBe(Date.parse('2020-01-01T00:00:00Z'))
  })
  it('returns -Infinity for missing or unparseable dates', () => {
    expect(lastActivityMs({})).toBe(-Infinity)
    expect(lastActivityMs({ created_at: 'nope' })).toBe(-Infinity)
    expect(lastActivityMs(null)).toBe(-Infinity)
  })
})

describe('sortPinsByLastActivity', () => {
  it('orders newest-first by last activity, not by pin creation', () => {
    const stale = { id: 'a', created_at: '2026-08-01T00:00:00Z', last_activity_at: '2026-08-01T00:00:00Z' }
    const old = { id: 'b', created_at: '2019-01-01T00:00:00Z', last_activity_at: '2026-08-20T00:00:00Z' }
    const mid = { id: 'c', created_at: '2026-08-10T00:00:00Z' } // no reports loaded → created_at
    expect(sortPinsByLastActivity([stale, mid, old]).map(p => p.id)).toEqual(['b', 'c', 'a'])
  })
  it('breaks ties by distance and puts undated pins last', () => {
    const t = '2026-08-03T00:00:00Z'
    const far = { id: 'far', last_activity_at: t, __distanceMeters: 18 }
    const near = { id: 'near', last_activity_at: t, __distanceMeters: 3 }
    const undated = { id: 'undated', __distanceMeters: 1 }
    expect(sortPinsByLastActivity([undated, far, near]).map(p => p.id)).toEqual(['near', 'far', 'undated'])
  })
  it('does not mutate the input and tolerates non-arrays', () => {
    const input = [{ id: 'x', created_at: '2026-01-01T00:00:00Z' }, { id: 'y', created_at: '2026-02-01T00:00:00Z' }]
    const out = sortPinsByLastActivity(input)
    expect(input.map(p => p.id)).toEqual(['x', 'y'])
    expect(out.map(p => p.id)).toEqual(['y', 'x'])
    expect(sortPinsByLastActivity(null)).toEqual([])
  })
})
