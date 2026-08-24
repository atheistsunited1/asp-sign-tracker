// Pure rules of an activity submission (report form + bulk photos): which
// visuals a new/merged pin gets, the row payloads, and the dated quick-update
// note. No I/O — see activitySubmissionService.js for the workflow.
import { defaultColorForPin, iconTypeForReportType } from '@/shared/domain/pinVisuals'

/** A pin is "pending" when it is not approved yet (nearby candidates may also carry kind: 'pending'). */
export function isPendingPin(pin) {
  return !!pin && (pin.is_approved === false || pin.kind === 'pending')
}

/** Icon type / major-campaign flag / colour for a submission against an optional existing pin. */
export function deriveSubmissionVisuals({ reportType, signType = '', existingPin = null } = {}) {
  const iconType = iconTypeForReportType(reportType)
  const isMajor = !!existingPin?.is_major_campaign
  const iconColor = defaultColorForPin({
    iconType,
    isMajorCampaign: isMajor,
    signType: signType || existingPin?.sign_type || '',
  })
  return { iconType, isMajor, iconColor }
}

/** Row for a NEW pending pin. `id` is only set when the caller minted it up front (photo keys). */
export function buildPinInsertPayload({ id = null, lat, lng, fields = {}, city = null, state = null, submitter, visuals }) {
  return {
    ...(id ? { id } : {}),
    lat, lng,
    description: fields.locationDescription || null,
    sign_text: fields.signText || null,
    sign_type: fields.signType || null,
    city, state,
    is_approved: false,
    submitted_by: submitter,
    icon_type: visuals.iconType,
    icon_color: visuals.iconColor,
  }
}

/** Update applied to an existing PENDING pin when a submission merges into it. */
export function buildPendingPinUpdate({ lat, lng, fields = {}, existingPin = null, visuals, now = new Date().toISOString() }) {
  return {
    lat, lng,
    icon_type: visuals.iconType,
    icon_color: visuals.iconColor,
    sign_text: fields.signText || existingPin?.sign_text || null,
    sign_type: fields.signType || existingPin?.sign_type || null,
    description: fields.locationDescription || existingPin?.description || null,
    updated_at: now,
  }
}

/** Update applied to the oldest pending report of that pin. */
export function buildMergedReportPayload({ reportType, originalPending = null, now = new Date().toISOString() }) {
  return { report_type: reportType || originalPending?.report_type || null, updated_at: now }
}

/** Row for a NEW pending report. */
export function buildReportInsertPayload({ id = null, pinId, reportType, submitter }) {
  return {
    ...(id ? { id } : {}),
    pin_id: pinId,
    report_type: reportType || null,
    submitted_by: submitter,
    is_approved: false,
  }
}

/** "mm/dd/yy" stamp used for quick-update notes. */
export function noteStamp(date = new Date()) {
  const d = date
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${String(d.getFullYear()).slice(-2)}`
}

/** Append a dated note to a pin description: "<base>\n<mm/dd/yy>: <note>". Empty notes return `base`. */
export function appendDatedNote(base, note, date = new Date()) {
  const n = String(note || '').trim()
  const b = String(base || '').trim()
  if (!n) return b
  const line = `${noteStamp(date)}: ${n}`
  return b ? `${b}\n${line}` : line
}
