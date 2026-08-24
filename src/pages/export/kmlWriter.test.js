import { describe, it, expect } from 'vitest'
import { mdy, monYear, placemarkName, activityLines, descriptionText, kmlDocument, kmlFiles, escapeXml } from '@/pages/export/kmlWriter.js'
import { parseKmlFile } from '@/pages/kml-import/parser/index.js'

const row = {
  pin: {
    id: '11111111-1111-4111-8111-111111111111', friendly_id: 'P-1A', lat: 34.0001, lng: -118.0001,
    sign_text: 'Jesus Saves', sign_type: 'sign', description: 'Yellow sign on a utility pole.\nSouth side of Main St.',
    city: 'Springfield', state: 'CA', zip: '90001', gsv_date: '2025-11-01', is_major_campaign: true, campaign: 'js', bucket: 'plundered',
  },
  activities: [
    { type: 'plundered', occurred_on: '2026-01-20', initials: 'YY', username: 'yy' },
    { type: 'sighting', occurred_on: '2025-03-02', initials: 'XX', username: 'xx' },
    { type: 'sighting', occurred_on: '2026-01-10', initials: null, username: null },
  ],
  photos: ['https://example.test/storage/v1/object/public/sign-photos/p/r/a.jpg', 'https://example.test/storage/v1/object/public/sign-photos/p/r/b.jpg'],
}

describe('kmlWriter helpers', () => {
  it('formats dates and names like My Maps', () => {
    expect(mdy('2026-01-20')).toBe('01/20/26')
    expect(monYear('2025-11-01')).toBe('Nov 2025')
    expect(placemarkName(row.pin)).toBe('CA - Jesus Saves (Springfield)')
    expect(placemarkName({ sign_text: 'Trust Jesus' })).toBe('Trust Jesus')
    expect(escapeXml('a & <b> "c"')).toBe('a &amp; &lt;b&gt; &quot;c&quot;')
  })
  it('writes activity lines in the importer grammar, chronologically', () => {
    expect(activityLines(row.activities)).toEqual([
      'Reported 03/02/25 by ASP (XX).',
      'Last checked 01/10/26.',
      'Updated 01/20/26: Plundered by ASP (YY)! Huzzah!',
    ])
    expect(activityLines([{ type: 'krakened', occurred_on: '2026-02-01', initials: 'QQ' }])).toEqual([
      'Updated 02/01/26: Per ASP (QQ) the sign is no longer there - Krakened!',
    ])
    expect(descriptionText(row).split('\n')).toEqual([
      'Reported 03/02/25 by ASP (XX).', 'Last checked 01/10/26.', 'Updated 01/20/26: Plundered by ASP (YY)! Huzzah!',
      'Yellow sign on a utility pole.', 'South side of Main St.', 'GSV dated Nov 2025.',
    ])
  })
})

describe('kmlDocument round-trips through the importer', () => {
  const kml = kmlDocument('Plundered — CA', [row])
  it('is a My Maps-shaped document', () => {
    expect(kml).toContain('<name>Plundered — CA</name>')
    expect(kml).toContain('<name>CA - Jesus Saves (Springfield)</name>')
    expect(kml).toContain('<styleUrl>#icon-1881-0F9D58-normal</styleUrl>')
    expect(kml).toContain('<Data name="gx_media_links">')
    expect(kml).toContain('<coordinates>\n          -118.0001,34.0001,0')
  })
  it('parses back with the same bucket, dates, initials, photos and description', () => {
    const res = parseKmlFile(kml)
    expect(res.detected).toEqual({ kind: 'plundered', isMajorCampaign: false })
    expect(res.rows).toHaveLength(1)
    const r = res.rows[0]
    expect(r).toMatchObject({ state: 'CA', city: 'Springfield', signText: 'Jesus Saves', lat: 34.0001, lng: -118.0001, gsvDate: '2025-11-01' })
    expect(r.photos).toEqual(row.photos)
    expect(r.activities).toEqual([
      { type: 'sighting', occurredOn: '2025-03-02', initials: 'XX' },
      { type: 'sighting', occurredOn: '2026-01-10', initials: null },
      { type: 'plundered', occurredOn: '2026-01-20', initials: 'YY' },
    ])
    expect(r.description).toBe('Yellow sign on a utility pole.\nSouth side of Main St.\nGSV dated Nov 2025.')
  })
  it('round-trips a krakened pin', () => {
    const k = { ...row, pin: { ...row.pin, bucket: 'krakened' }, activities: [{ type: 'sighting', occurred_on: '2025-03-02', initials: 'XX' }, { type: 'krakened', occurred_on: '2026-02-01', initials: 'QQ' }] }
    const res = parseKmlFile(kmlDocument('Krakened', [k]))
    expect(res.rows[0].activities).toEqual([
      { type: 'sighting', occurredOn: '2025-03-02', initials: 'XX' },
      { type: 'krakened', occurredOn: '2026-02-01', initials: 'QQ' },
    ])
  })
})

describe('kmlFiles', () => {
  it('keeps one file when it fits and splits above the per-file cap', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ ...row, pin: { ...row.pin, id: `id-${i}`, friendly_id: `P-${i}` } }))
    expect(kmlFiles('asp-test', 'Layer', rows, 10).map((f) => f.filename)).toEqual(['asp-test.kml'])
    const parts = kmlFiles('asp-test', 'Layer', rows, 2)
    expect(parts.map((f) => f.filename)).toEqual(['asp-test-part01.kml', 'asp-test-part02.kml', 'asp-test-part03.kml'])
    expect(parts[0].text).toContain('<name>Layer (part 1/3)</name>')
    expect(parseKmlFile(parts[2].text).rows).toHaveLength(1)
  })
})
