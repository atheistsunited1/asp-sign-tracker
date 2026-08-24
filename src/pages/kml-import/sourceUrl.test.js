import { describe, it, expect } from 'vitest'
import { normalizeSourceUrl } from '@/pages/kml-import/sourceUrl.js'

describe('normalizeSourceUrl', () => {
  it('asks Google for an 800 px, quality-75 JPEG rendition', () => {
    expect(normalizeSourceUrl('https://mymaps.usercontent.google.com/hostedimage/m/*/3AAjQbR5U?authuser=0&fife=s16383'))
      .toBe('https://mymaps.usercontent.google.com/hostedimage/m/*/3AAjQbR5U?authuser=0&fife=s800-rj-l75')
  })
  it('adds the hint when a Google image URL has none, and honours a custom edge', () => {
    expect(normalizeSourceUrl('https://lh3.googleusercontent.com/abc')).toBe('https://lh3.googleusercontent.com/abc?fife=s800-rj-l75')
    expect(normalizeSourceUrl('https://lh3.googleusercontent.com/abc?fife=s16383', { maxEdge: 1600, quality: 85 })).toBe('https://lh3.googleusercontent.com/abc?fife=s1600-rj-l85')
  })
  it('leaves other hosts and junk alone', () => {
    expect(normalizeSourceUrl('https://example.com/p.jpg?fife=s16383')).toBe('https://example.com/p.jpg?fife=s16383')
    expect(normalizeSourceUrl('not a url')).toBe('not a url')
  })
})
