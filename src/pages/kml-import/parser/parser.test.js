import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseDescription } from '@/pages/kml-import/parser/description.js'
import { descriptionToText, toLines, findDates, findMonths, maxIso } from '@/pages/kml-import/parser/text.js'
import { parseLegacyName, inferSignType } from '@/pages/kml-import/parser/name.js'
import { detectLayer, layerKind } from '@/pages/kml-import/parser/layer.js'
import { parseKmlDocument } from '@/pages/kml-import/parser/kml.js'
import { parseKmlFile, summarize, duplicateKey } from '@/pages/kml-import/parser/index.js'

const fixture = (n) => readFileSync(new URL(`../__fixtures__/${n}`, import.meta.url), 'utf8')
const lines = (s) => toLines(descriptionToText(s))
const PLUNDER = layerKind('plundered'), KRAKEN = layerKind('krakened'), QUESTIONABLE = layerKind('questionable'), REPORTED = layerKind('reported')

describe('text helpers', () => {
  it('turns CDATA html into lines, dropping images, bare coords, PIN_UUID and wrapping quotes', () => {
    const raw = '<![CDATA["PIN_UUID: 8a0b4c7e-1d2f-4a3b-9c8d-0e1f2a3b4c5d<br>Reported 03/02/25 by ASP (XX).<br>34.0001, -118.0001<br>Yellow sign &amp; pole.<br><img src="x" />"]]>'
    expect(lines(raw)).toEqual(['Reported 03/02/25 by ASP (XX).', 'Yellow sign & pole.'])
  })
  it('decodes entity-escaped html too', () => {
    expect(lines('Reported 05/12/26 by ASP (YY).&lt;br&gt;Yellow barnacle.')).toEqual(['Reported 05/12/26 by ASP (YY).', 'Yellow barnacle.'])
  })
  it('finds MM/DD/YY dates and Mon YYYY months', () => {
    expect(findDates('Reported 03/02/25 by ASP via BF FB dated 1/9/2026.')).toEqual(['2025-03-02', '2026-01-09'])
    expect(findMonths('via GSV dated Sep 2024; Aug/Dec 2021; Sept. 2023')).toEqual(['2024-09-01', '2021-12-01', '2023-09-01'])
    expect(findDates('case 311-25762583')).toEqual([])
    expect(maxIso(['2024-01-01', '2025-06-30', null])).toBe('2025-06-30')
  })
})

describe('parseLegacyName / inferSignType', () => {
  it('splits STATE - text (City) with fallbacks', () => {
    expect(parseLegacyName('"CA - Jesus Saves (Los Angeles)"')).toEqual({ state: 'CA', signText: 'Jesus Saves', city: 'Los Angeles' })
    expect(parseLegacyName('CA - Jesus The Way... (sticker, x2)')).toEqual({ state: 'CA', signText: 'Jesus The Way...', city: 'sticker, x2' })
    expect(parseLegacyName('Prepare to Meet God')).toEqual({ state: '', signText: 'Prepare to Meet God', city: '' })
  })
  it('infers sign types by keyword precedence and layer override', () => {
    expect(inferSignType({ name: 'NC - Jesus Is Coming... sticker (Atlanta)' })).toBe('sticker')
    expect(inferSignType({ name: 'GA - Jesus Saves', description: 'Yellow barnacle on a pole' })).toBe('sticker')
    expect(inferSignType({ name: 'OK - Repent banner' })).toBe('banner')
    expect(inferSignType({ name: 'NC - Jesus Saves billboard Lamar 0815' })).toBe('sign')
    expect(inferSignType({ name: 'X', description: 'Yellow sign on a pole' })).toBe('sign')
    expect(inferSignType({ name: 'X', description: 'something', layerSignType: 'sticker' })).toBe('sticker')
    expect(inferSignType({ name: 'X', description: 'nothing known' })).toBe('other')
  })
})

describe('detectLayer', () => {
  it('maps My Maps layer names to kinds', () => {
    expect(detectLayer('Reported Signs')).toEqual({ kind: 'reported', isMajorCampaign: false })
    expect(detectLayer('Major Campaign Signs Reported')).toEqual({ kind: 'reported', isMajorCampaign: true })
    expect(detectLayer('Major Campaign signs removed but not by ASP')).toEqual({ kind: 'krakened', isMajorCampaign: true })
    expect(detectLayer('Major Plunders - JICR 2026+')).toEqual({ kind: 'plundered', isMajorCampaign: true })
    expect(detectLayer('Street Pirate Plunders')).toEqual({ kind: 'plundered', isMajorCampaign: false })
    expect(detectLayer('Sightings of Questionable Legality')).toEqual({ kind: 'questionable', isMajorCampaign: false })
    expect(detectLayer('Untitled layer')).toEqual({ kind: null, isMajorCampaign: false })
  })
})

describe('parseDescription', () => {
  it('reads a reported pin: sighting + re-checks + update, gsv_date = latest month', () => {
    const r = parseDescription(lines('"Reported 05/24/24 by ASP (AZ).<br>Last checked 06/05/26; Aug 2025 GSV.<br>Yellow sign on a tall utility pole. Visible back to Aug 2022 GSV but not Nov 2021.<br>Updated 09/20/24: As of GSV dated Aug 2024, the snipe sign was still there."'), REPORTED)
    expect(r.activities).toEqual([
      { type: 'sighting', occurredOn: '2024-05-24', initials: 'AZ' },
      { type: 'sighting', occurredOn: '2024-09-20', initials: null },
      { type: 'sighting', occurredOn: '2026-06-05', initials: null },
    ])
    expect(r.description).toBe('Yellow sign on a tall utility pole. Visible back to Aug 2022 GSV but not Nov 2021.')
    expect(r.gsvDate).toBe('2025-08-01')
    expect(r.flags).toEqual([])
  })
  it('reads "Reported … and plundered by" as sighting + plunder on the same date', () => {
    const r = parseDescription(lines('Reported 01/17/26 and plundered by ASP (SMSM)! Huzzah!<br>Yellow barnacle on a pole.'), PLUNDER)
    expect(r.activities).toEqual([
      { type: 'sighting', occurredOn: '2026-01-17', initials: 'SMSM' },
      { type: 'plundered', occurredOn: '2026-01-17', initials: 'SMSM' },
    ])
  })
  it('credits reporter and plunderer separately and prefers the nested plunder date', () => {
    const r = parseDescription(lines('Reported 08/24/25 by ASP (JR) based on a tip and plundered by ASP (PR)! Huzzah!<br>Updated 10/03/25: Plundered 09/23/25 by ASP (QQ)! Huzzah!'), PLUNDER)
    expect(r.activities).toEqual([
      { type: 'sighting', occurredOn: '2025-08-24', initials: 'JR' },
      { type: 'plundered', occurredOn: '2025-08-24', initials: 'PR' },
      { type: 'plundered', occurredOn: '2025-09-23', initials: 'QQ' },
    ])
  })
  it('reads kraken updates, bare-date updates and "Per ASP (XX) … taken by the Kraken"', () => {
    const r = parseDescription(lines('Reported 09/30/23 by ASP (CV).<br>Yellow sign.<br>Updated 02/19/25: As of GSV dated Feb 2025, the sign was still there.<br>06/05/26: AS of GSV dated Jan 2026 the snipe sign was no longer there - Krakened!<br>Updated 09/30/24: Per ASP (QQ) the pesky barnacle is no longer there - taken by the Kraken!'), KRAKEN)
    expect(r.activities).toEqual([
      { type: 'sighting', occurredOn: '2023-09-30', initials: 'CV' },
      { type: 'krakened', occurredOn: '2024-09-30', initials: 'QQ' },
      { type: 'sighting', occurredOn: '2025-02-19', initials: null },
      { type: 'krakened', occurredOn: '2026-06-05', initials: null },
    ])
    expect(r.gsvDate).toBe('2026-01-01')
  })
  it('synthesizes the terminal activity from a description sentence, dated by the latest date (D6)', () => {
    const r = parseDescription(lines('Reported 03/02/25 by ASP (CG) via GSV dated Aug 2023.<br>Yellow sign at the SE corner. Not visible on the Mar 2024 GSV image nor Jul 2022 - taken by the Kraken!'), KRAKEN)
    expect(r.activities).toEqual([
      { type: 'sighting', occurredOn: '2025-03-02', initials: 'CG' },
      { type: 'krakened', occurredOn: '2025-03-02', initials: null, dateSynthesized: true },
    ])
    expect(r.description).toContain('taken by the Kraken')
    expect(r.gsvDate).toBe('2024-03-01')
  })
  it('synthesizes a missing terminal activity for a terminal layer', () => {
    const r = parseDescription(lines('Reported 07/06/25 by ASP (XX).<br>Yellow sign. Visible on the Jun 2024 GSV image but not Jan 2023.'), PLUNDER)
    expect(r.activities).toEqual([
      { type: 'sighting', occurredOn: '2025-07-06', initials: 'XX' },
      { type: 'plundered', occurredOn: '2025-07-06', initials: null, synthesized: true },
    ])
    expect(r.flags).toEqual([])
  })
  it('ignores history notes and asides (recidivist, previously, similar sign, "before plunder")', () => {
    const r = parseDescription(lines('Reported 01/21/26 and plundered by ASP (JR)! Huzzah!<br>Recidivist locale; last plundered 01/06/26.<br>Repeat offender location - previously reported 07/24/22 and Krakened.<br>A similar sign was pillaged by ASP at this same location on 08/19/23.<br>Likely put up on 03/18/24 - 5 days before plunder!'), PLUNDER)
    expect(r.activities.map((a) => [a.type, a.occurredOn])).toEqual([['sighting', '2026-01-21'], ['plundered', '2026-01-21']])
    expect(r.description.split('\n')).toHaveLength(4)
  })
  it('uses questionable as the sighting type in that layer and treats "Reported to …" as description', () => {
    const r = parseDescription(lines('Reported 05/12/23 by ASP via web article.<br>Large concrete sign.<br>Reported to NYC311 - case 311-25762583.<br>Updated 08/20/25: Visible on the Feb 2025 GSV image.'), QUESTIONABLE)
    expect(r.activities).toEqual([
      { type: 'questionable', occurredOn: '2023-05-12', initials: null },
      { type: 'questionable', occurredOn: '2025-08-20', initials: null },
    ])
    expect(r.description).toBe('Large concrete sign.\nReported to NYC311 - case 311-25762583.')
  })
  it('flags a pin with no date anywhere and still yields one activity', () => {
    const r = parseDescription(lines('Large concrete sign placed some time ago.'), REPORTED)
    expect(r.activities).toEqual([{ type: 'sighting', occurredOn: null, initials: null, synthesized: true }])
    expect(r.flags).toEqual(['no-date'])
    expect(parseDescription([], KRAKEN).flags).toEqual(['no-date'])
  })
})

describe('parseKmlDocument / parseKmlFile', () => {
  it('reads layer name, placemarks, coords (lng,lat), photos from gx_media_links', () => {
    const doc = parseKmlDocument(fixture('reported-signs.kml'))
    expect(doc.layerName).toBe('Reported Signs')
    expect(doc.placemarks).toHaveLength(4)
    expect(doc.placemarks[0]).toMatchObject({
      name: 'CA - Jesus Saves (Springfield)',
      coordinates: { lat: 34.0001, lng: -118.0001 },
      photos: ['https://lh3.example.test/photo-a', 'https://lh3.example.test/photo-b'],
      styleUrl: '#icon-1670-0288D1-normal',
    })
    expect(doc.placemarks[1].photos).toEqual(['https://lh3.example.test/photo-d'])   // single CDATA-wrapped link
    expect(doc.placemarks[3].coordinates).toBeNull()
    expect(() => parseKmlDocument('<html></html>')).toThrow()
  })
  it('builds rows for a reported layer, skipping placemarks without coords and flagging date-less pins', () => {
    const res = parseKmlFile(fixture('reported-signs.kml'))
    expect(res.kind.value).toBe('reported')
    expect(res.rows).toHaveLength(3)
    expect(res.skipped).toHaveLength(1)
    const a = res.rows[0]
    expect(a).toMatchObject({ state: 'CA', city: 'Springfield', signText: 'Jesus Saves', signType: 'sign', gsvDate: '2025-11-01', lat: 34.0001, lng: -118.0001 })
    expect(a.activities.map((x) => x.occurredOn)).toEqual(['2025-03-02', '2025-11-14', '2026-01-10'])
    expect(a.description).toBe('Yellow sign nailed to a utility pole on the south side of Main St across from Oak Rd. Not visible on the Mar 2022 GSV image.')
    expect(res.rows[1]).toMatchObject({ signType: 'sticker', state: 'NC' })
    expect(res.rows[1].activities).toEqual([{ type: 'sighting', occurredOn: '2026-05-12', initials: 'YY' }])
    expect(res.rows[2].flags).toEqual(['no-date'])
    const s = summarize(res.rows)
    expect(s).toMatchObject({ pins: 3, activities: 5, byType: { sighting: 5 }, flagged: 1, photos: 3, withGsvDate: 2, initials: ['XX', 'YY'] })
  })
  it('builds rows for a plunder layer, drops exact duplicates, synthesizes plunders', () => {
    const res = parseKmlFile(fixture('major-plunders.kml'))
    expect(res.detected).toEqual({ kind: 'plundered', isMajorCampaign: true })
    expect(res.rows).toHaveLength(3)
    expect(res.duplicates).toHaveLength(1)
    expect(res.rows[0].activities).toEqual([
      { type: 'sighting', occurredOn: '2025-12-21', initials: 'XX' },
      { type: 'plundered', occurredOn: '2025-12-29', initials: 'YY' },
    ])
    expect(res.rows[1].activities.map((a) => a.type)).toEqual(['sighting', 'plundered'])
    expect(res.rows[1].description).toContain('Recidivist locale')
    expect(res.rows[2].activities[1]).toMatchObject({ type: 'plundered', occurredOn: '2025-07-06', synthesized: true })
    expect(summarize(res.rows).byType).toEqual({ sighting: 3, plundered: 3 })
  })
  it('re-parses with an overridden layer kind', () => {
    const res = parseKmlFile(fixture('major-plunders.kml'), 'krakened')
    expect(res.kind.value).toBe('krakened')
    expect(res.rows[2].activities[1]).toMatchObject({ type: 'krakened', synthesized: true })
  })
  it('duplicateKey matches to ~1 m', () => {
    expect(duplicateKey({ signText: 'Jesus Saves', lat: 34.000011, lng: -118.000009 })).toBe(duplicateKey({ signText: 'jesus saves ', lat: 34.00001, lng: -118.00001 }))
    expect(duplicateKey({ signText: 'A', lat: 34.0001, lng: -118 })).not.toBe(duplicateKey({ signText: 'A', lat: 34.0002, lng: -118 }))
  })
})
