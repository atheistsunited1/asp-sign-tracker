import { describe, it, expect } from 'vitest'
import { buildDashboardModel } from '@/pages/dashboard/aggregate.js'

const P = 'period', V = 'previous'
const stats = {
  period: { from: '2026-01-01', to: '2026-03-31' },
  previous: { from: '2025-10-03', to: '2025-12-31' },
  snapshot: [
    { bucket: 'plundered', is_major_campaign: true, campaign: 'jicr', state: 'GA', n: 100 },
    { bucket: 'plundered', is_major_campaign: false, campaign: null, state: 'CA', n: 40 },
    { bucket: 'krakened', is_major_campaign: false, campaign: null, state: 'CA', n: 30 },
    { bucket: 'sighting', is_major_campaign: true, campaign: 'js', state: 'NC', n: 20 },
    { bucket: 'sighting', is_major_campaign: false, campaign: null, state: 'CA', n: 5 },
    { bucket: 'sighting', is_major_campaign: false, campaign: null, state: 'AR', n: 7 },
    { bucket: 'billboard', is_major_campaign: false, campaign: null, state: 'NC', n: 3 },
    { bucket: 'questionable', is_major_campaign: false, campaign: null, state: 'OK', n: 4 },
  ],
  activity: [
    { window: P, report_type: 'tracked_total', n: 209 }, { window: V, report_type: 'tracked_total', n: 190 },
    { window: P, report_type: 'first_sighting', is_major_campaign: true, campaign: 'jicr', state: 'GA', is_billboard: false, n: 12 },
    { window: P, report_type: 'first_sighting', is_major_campaign: false, campaign: null, state: 'CA', is_billboard: false, n: 7 },
    { window: V, report_type: 'first_sighting', is_major_campaign: false, campaign: null, state: 'CA', is_billboard: false, n: 30 },
    { window: P, report_type: 'plundered', is_major_campaign: true, campaign: 'jicr', state: 'GA', is_billboard: false, n: 10 },
    { window: P, report_type: 'plundered', is_major_campaign: true, campaign: 'js', state: 'NC', is_billboard: false, n: 2 },
    { window: P, report_type: 'plundered', is_major_campaign: false, campaign: null, state: 'CA', is_billboard: false, n: 3 },
    { window: V, report_type: 'plundered', is_major_campaign: true, campaign: 'jicr', state: 'GA', is_billboard: false, n: 8 },
    { window: P, report_type: 'krakened', is_major_campaign: false, campaign: null, state: 'CA', is_billboard: false, n: 4 },
    { window: P, report_type: 'sighting', is_major_campaign: false, campaign: null, state: 'CA', is_billboard: false, n: 9 },
  ],
  trend: [
    { quarter: '2025-Q4', report_type: 'plundered', n: 8 }, { quarter: '2026-Q1', report_type: 'plundered', n: 15 },
    { quarter: '2026-Q1', report_type: 'krakened', n: 4 }, { quarter: '2026-Q1', report_type: 'first_sighting', n: 19 },
    { quarter: '2025-Q4', report_type: 'backlog_end', n: 40 }, { quarter: '2026-Q1', report_type: 'backlog_end', n: 42 },
  ],
  members: [
    { window: P, username: 'pirate_a', report_type: 'plundered', n: 9 },
    { window: P, username: 'pirate_a', report_type: 'sighting', n: 2 },
    { window: P, username: 'pirate_b', report_type: 'plundered', n: 6 },
    { window: V, username: 'pirate_c', report_type: 'plundered', n: 99 },
  ],
}

describe('buildDashboardModel', () => {
  const m = buildDashboardModel(stats)

  it('headline: signs tracked and growth', () => {
    expect(m.tracked).toEqual({ total: 209, previousTotal: 190, added: 19, addedPrevious: 30, pct: 10 })
  })
  it('plunders: period/delta, major-campaign split, CA vs outside, snapshot totals', () => {
    expect(m.plundered.period).toBe(15)
    expect(m.plundered.previous).toBe(8)
    expect(m.plundered.delta).toBe(7)
    expect(m.plundered.pct).toBe(87.5)
    expect(m.plundered.major).toBe(12)
    expect(m.plundered.js).toBe(2)
    expect(m.plundered.jicr).toBe(10)
    expect(m.plundered.nonMajor).toBe(3)
    expect(m.plundered.ca).toBe(3)
    expect(m.plundered.outsideCa).toBe(12)
    expect(m.plundered.outsideCaNonMajor).toBe(0)
    expect(m.plundered.snapshot.total).toBe(140)
    expect(m.plundered.snapshot.major).toBe(100)
  })
  it('treasure in waiting: live backlog excludes billboards; period change = new − plundered − krakened', () => {
    expect(m.backlog.snapshot.total).toBe(32)
    expect(m.backlog.snapshot.major).toBe(20)
    expect(m.backlog.snapshot.caNonMajor).toBe(5)
    expect(m.backlog.snapshot.outsideCaNonMajor).toBe(7)
    expect(m.backlog.newSigns).toBe(19)
    expect(m.backlog.period).toBe(19 - 15 - 4)
    expect(m.backlog.major).toBe(12 - 12)
    expect(m.backlog.caNonMajor).toBe(7 - 3 - 4)
    expect(m.backlog.previous).toBe(30 - 8)
  })
  it('questionable and billboards', () => {
    expect(m.questionable.snapshot.total).toBe(4)
    expect(m.questionable.period).toBe(0)
    expect(m.billboards.total).toBe(3)
  })
  it('trend series align to sorted quarters with zeros filled', () => {
    expect(m.trend.quarters).toEqual(['2025-Q4', '2026-Q1'])
    expect(m.trend.plundered).toEqual([8, 15])
    expect(m.trend.krakened).toEqual([0, 4])
    expect(m.trend.newSigns).toEqual([0, 19])
    expect(m.trend.backlog).toEqual([40, 42])
  })
  it('per-state rows sorted by total with period activity', () => {
    expect(m.states[0]).toMatchObject({ state: 'GA', plundered: 100, total: 100, periodPlundered: 10, periodNew: 12 })
    const ca = m.states.find((s) => s.state === 'CA')
    expect(ca).toMatchObject({ sighting: 5, plundered: 40, krakened: 30, total: 75, periodPlundered: 3, periodKrakened: 4, periodNew: 7 })
  })
  it('leaderboard uses the period window only, sorted by plunders then total', () => {
    expect(m.members.map((x) => x.username)).toEqual(['pirate_a', 'pirate_b'])
    expect(m.members[0]).toMatchObject({ plundered: 9, sighting: 2, total: 11 })
  })
  it('tolerates an empty payload', () => {
    const e = buildDashboardModel({})
    expect(e.tracked.total).toBe(0)
    expect(e.trend.quarters).toEqual([])
    expect(e.states).toEqual([])
    expect(e.members).toEqual([])
  })
})
