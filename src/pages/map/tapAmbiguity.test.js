// Tests for the pure geographic tap-ambiguity decision logic (issue #18).
import { describe, it, expect } from 'vitest'
import {
  TAP_AMBIGUITY_RADIUS_M,
  findGeographicallyClosePins,
  isAmbiguousTap,
} from '@/pages/map/tapAmbiguity'

// ~1e-5 deg latitude ≈ 1.11 m. Offsets below are chosen well inside/outside 20 m.
const tap = { lat: 34.05, lng: -118.24 }
const metersNorth = (m) => ({ lat: tap.lat + m / 111_320, lng: tap.lng })

describe('findGeographicallyClosePins', () => {
  it('returns pins within the radius, nearest first', () => {
    const pins = [
      { id: 'far10', ...metersNorth(10) },
      { id: 'near2', ...metersNorth(2) },
      { id: 'out', ...metersNorth(50) },
    ]
    expect(findGeographicallyClosePins(tap, pins).map((p) => p.id)).toEqual(['near2', 'far10'])
  })

  it('includes ~the radius boundary and excludes just beyond it', () => {
    expect(findGeographicallyClosePins(tap, [{ id: 'edge', ...metersNorth(TAP_AMBIGUITY_RADIUS_M - 0.5) }])).toHaveLength(1)
    expect(findGeographicallyClosePins(tap, [{ id: 'out', ...metersNorth(TAP_AMBIGUITY_RADIUS_M + 2) }])).toHaveLength(0)
  })

  it('is geographic: the same offsets match regardless of any zoom notion', () => {
    // 12 m east at this latitude (1 deg lng ≈ 111,320 · cos(lat) m)
    const east12 = { lat: tap.lat, lng: tap.lng + 12 / (111_320 * Math.cos((tap.lat * Math.PI) / 180)) }
    expect(findGeographicallyClosePins(tap, [east12])).toHaveLength(1)
  })

  it('ignores entries and taps with non-finite coordinates', () => {
    expect(findGeographicallyClosePins(tap, [{ id: 'bad', lat: NaN, lng: 0 }, { id: 'ok', ...metersNorth(1) }])).toHaveLength(1)
    expect(findGeographicallyClosePins({ lat: NaN, lng: 0 }, [{ id: 'ok', ...metersNorth(1) }])).toEqual([])
    expect(findGeographicallyClosePins(null, [{ id: 'ok', ...metersNorth(1) }])).toEqual([])
  })

  it('honours a custom radius', () => {
    const pins = [{ id: 'a', ...metersNorth(40) }]
    expect(findGeographicallyClosePins(tap, pins, 50)).toHaveLength(1)
    expect(findGeographicallyClosePins(tap, pins, 30)).toHaveLength(0)
  })
})

describe('isAmbiguousTap', () => {
  it('needs at least two close pins', () => {
    expect(isAmbiguousTap([])).toBe(false)
    expect(isAmbiguousTap([{ id: 'a' }])).toBe(false)
    expect(isAmbiguousTap([{ id: 'a' }, { id: 'b' }])).toBe(true)
    expect(isAmbiguousTap(null)).toBe(false)
  })
})
