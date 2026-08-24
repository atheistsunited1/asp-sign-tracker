import { describe, it, expect } from 'vitest'
import {
  isPendingPin, deriveSubmissionVisuals, buildPinInsertPayload, buildPendingPinUpdate,
  buildMergedReportPayload, buildReportInsertPayload, noteStamp, appendDatedNote,
} from './activitySubmission'

describe('isPendingPin', () => {
  it('is true for unapproved pins and nearby candidates flagged pending', () => {
    expect(isPendingPin({ is_approved: false })).toBe(true)
    expect(isPendingPin({ kind: 'pending' })).toBe(true)
    expect(isPendingPin({ is_approved: true })).toBe(false)
    expect(isPendingPin(null)).toBe(false)
  })
})

describe('deriveSubmissionVisuals', () => {
  it('takes the major-campaign flag and fallback sign type from the existing pin', () => {
    const v = deriveSubmissionVisuals({ reportType: 'sighting', signType: '', existingPin: { is_major_campaign: true, sign_type: 'billboard' } })
    expect(v.isMajor).toBe(true)
    expect(v.iconType).toBeDefined()
    expect(typeof v.iconColor).toBe('string')
  })
  it('is not major without an existing pin', () => {
    expect(deriveSubmissionVisuals({ reportType: 'plundered' }).isMajor).toBe(false)
  })
})

describe('payload builders', () => {
  const visuals = { iconType: 'reported', iconColor: '#abc', isMajor: false }
  const fields = { reportType: 'sighting', signText: 'Jesus Saves', signType: 'sign', locationDescription: 'I-95 exit 12' }

  it('buildPinInsertPayload sets the provisional id only when given', () => {
    const row = buildPinInsertPayload({ id: 'p1', lat: 1, lng: 2, fields, city: 'X', state: 'NC', submitter: 'u1', visuals })
    expect(row).toEqual({
      id: 'p1', lat: 1, lng: 2, description: 'I-95 exit 12', sign_text: 'Jesus Saves', sign_type: 'sign',
      city: 'X', state: 'NC', is_approved: false, submitted_by: 'u1', icon_type: 'reported', icon_color: '#abc',
    })
    expect(buildPinInsertPayload({ lat: 1, lng: 2, fields: {}, submitter: 'u1', visuals })).not.toHaveProperty('id')
    expect(buildPinInsertPayload({ lat: 1, lng: 2, fields: {}, submitter: 'u1', visuals }).sign_text).toBeNull()
  })

  it('buildPendingPinUpdate prefers typed fields, then the existing pin, then null', () => {
    const u = buildPendingPinUpdate({ lat: 3, lng: 4, fields: { signText: '' }, existingPin: { sign_text: 'Old', sign_type: 'banner' }, visuals, now: 'T' })
    expect(u).toEqual({ lat: 3, lng: 4, icon_type: 'reported', icon_color: '#abc', sign_text: 'Old', sign_type: 'banner', description: null, updated_at: 'T' })
  })

  it('buildMergedReportPayload keeps the original type when none is typed', () => {
    expect(buildMergedReportPayload({ reportType: '', originalPending: { report_type: 'krakened' }, now: 'T' })).toEqual({ report_type: 'krakened', updated_at: 'T' })
    expect(buildMergedReportPayload({ reportType: 'plundered', originalPending: { report_type: 'krakened' }, now: 'T' }).report_type).toBe('plundered')
  })

  it('buildReportInsertPayload', () => {
    expect(buildReportInsertPayload({ id: 'r1', pinId: 'p1', reportType: 'sighting', submitter: 'u1' }))
      .toEqual({ id: 'r1', pin_id: 'p1', report_type: 'sighting', submitted_by: 'u1', is_approved: false })
    expect(buildReportInsertPayload({ pinId: 'p1', reportType: '', submitter: 'u1' })).toEqual({ pin_id: 'p1', report_type: null, submitted_by: 'u1', is_approved: false })
  })
})

describe('appendDatedNote', () => {
  const d = new Date(2026, 7, 22) // 08/22/26
  it('stamps mm/dd/yy', () => expect(noteStamp(d)).toBe('08/22/26'))
  it('appends on a new line, or starts the description', () => {
    expect(appendDatedNote('Near the bridge', 'sign moved', d)).toBe('Near the bridge\n08/22/26: sign moved')
    expect(appendDatedNote('', '  sign moved ', d)).toBe('08/22/26: sign moved')
  })
  it('returns the base untouched for an empty note', () => {
    expect(appendDatedNote('Near the bridge', '   ', d)).toBe('Near the bridge')
  })
})
