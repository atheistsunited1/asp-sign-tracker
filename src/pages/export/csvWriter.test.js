import { describe, it, expect } from 'vitest'
import Papa from 'papaparse'
import { csvRecord, csvText, CSV_COLUMNS } from '@/pages/export/csvWriter.js'

const row = {
  pin: { id: 'id-1', friendly_id: 'P-1', lat: 34.1, lng: -118.2, sign_text: 'Jesus, Saves', sign_type: 'sign', description: 'Line 1\nLine 2', city: 'LA', state: 'CA', zip: '', gsv_date: '2025-11-01', is_major_campaign: true, campaign: 'js', bucket: 'plundered' },
  activities: [{ type: 'plundered', occurred_on: '2026-01-20', initials: 'YY' }, { type: 'sighting', occurred_on: '2025-03-02', initials: 'XX' }],
  photos: ['https://x/a.jpg'],
}

describe('csvWriter', () => {
  it('flattens a pin with counts, dates and activity lines', () => {
    expect(csvRecord(row)).toMatchObject({
      friendly_id: 'P-1', name: 'CA - Jesus, Saves (LA)', bucket: 'plundered', is_major_campaign: 'true', campaign: 'js',
      first_activity: '2025-03-02', last_activity: '2026-01-20', n_sightings: 1, n_plundered: 1, n_krakened: 0,
      photo_urls: 'https://x/a.jpg', photo_count: 1,
      activity_lines: 'Reported 03/02/25 by ASP (XX).\nUpdated 01/20/26: Plundered by ASP (YY)! Huzzah!',
      description: 'Line 1\nLine 2',
    })
  })
  it('produces a BOM-prefixed CSV that parses back with the same columns', () => {
    const text = csvText([row])
    expect(text.charCodeAt(0)).toBe(0xfeff)
    const parsed = Papa.parse(text.slice(1), { header: true, skipEmptyLines: true })
    expect(parsed.meta.fields).toEqual([...CSV_COLUMNS])
    expect(parsed.data).toHaveLength(1)
    expect(parsed.data[0].name).toBe('CA - Jesus, Saves (LA)')
    expect(parsed.data[0].description).toBe('Line 1\nLine 2')
  })
})
