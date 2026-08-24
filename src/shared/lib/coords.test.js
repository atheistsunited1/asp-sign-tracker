// Tests for the shared coordinate module extracted from ReportForm/BulkPhotoReports.
// Expected values are known-good literals (worked examples), not recomputed.
import { describe, it, expect } from 'vitest'
import { parseCoords, parseCoordsFlexible, parseLatLng, formatCoords } from '@/shared/lib/coords'

describe('parseCoords', () => {
  it('parses a "lat, lng" pair', () => {
    expect(parseCoords('40.7128, -74.0060')).toEqual({ lat: 40.7128, lng: -74.006 })
  })

  it('parses a space-separated pair', () => {
    expect(parseCoords('40.7128 -74.0060')).toEqual({ lat: 40.7128, lng: -74.006 })
  })

  it('swaps to lat,lng when the first number can only be a longitude', () => {
    // Sydney given lng-first
    expect(parseCoords('151.2093, -33.8688')).toEqual({ lat: -33.8688, lng: 151.2093 })
  })

  it('clamps latitude to [-90, 90]', () => {
    expect(parseCoords('95, 100')).toEqual({ lat: 90, lng: 100 })
  })

  it('wraps longitude into [-180, 180)', () => {
    expect(parseCoords('40, 190')).toEqual({ lat: 40, lng: -170 })
  })

  it('returns null when there is no coordinate pair', () => {
    expect(parseCoords('not coordinates')).toBeNull()
    expect(parseCoords('')).toBeNull()
  })
})

describe('parseLatLng', () => {
  it('parses a "lat, lng" pair like parseCoords', () => {
    expect(parseLatLng('40.7128, -74.0060')).toEqual({ lat: 40.7128, lng: -74.006 })
  })

  it('returns { lat: NaN, lng: NaN } when there is no coordinate pair', () => {
    expect(parseLatLng('not coordinates')).toEqual({ lat: NaN, lng: NaN })
    expect(parseLatLng('')).toEqual({ lat: NaN, lng: NaN })
  })
})

describe('parseCoordsFlexible', () => {
  it('accepts a plain pair', () => {
    expect(parseCoordsFlexible('40.7128, -74.0060')).toEqual({ lat: 40.7128, lng: -74.006 })
  })

  it('accepts Google-style "@lat,lng" in a URL path', () => {
    expect(parseCoordsFlexible('https://www.google.com/maps/@40.712800,-74.006000,15z'))
      .toEqual({ lat: 40.7128, lng: -74.006 })
  })

  it('reads common "lat,lng" query params', () => {
    expect(parseCoordsFlexible('https://www.google.com/maps/search/?api=1&query=40.712800%2C-74.006000'))
      .toEqual({ lat: 40.7128, lng: -74.006 })
  })

  it('reads explicit lat/lng query keys, tolerating a missing scheme', () => {
    expect(parseCoordsFlexible('example.com/map?lat=40.7128&lng=-74.006'))
      .toEqual({ lat: 40.7128, lng: -74.006 })
  })

  it('returns null for text with no coordinates', () => {
    expect(parseCoordsFlexible('https://example.com/about')).toBeNull()
    expect(parseCoordsFlexible('hello')).toBeNull()
  })
})

describe('formatCoords', () => {
  it('formats to 6 decimal places as "lat, lng"', () => {
    expect(formatCoords(40.7128, -74.006)).toBe('40.712800, -74.006000')
  })
})
