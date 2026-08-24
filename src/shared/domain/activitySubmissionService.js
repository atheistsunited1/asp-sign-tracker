// The activity-submission workflow shared by the report form and bulk photos:
// best-effort city/state → insert a pending pin OR merge into an existing
// pending pin (+ its oldest pending report) → insert a pending report →
// optional dated note → attach photo rows. Pure payload rules live in
// activitySubmission.js; photos in photoUploadService.js; notifications in
// activityNotificationService.js.
import { pinsRepo } from '@/shared/data/repos/pinsRepo'
import { reportsRepo } from '@/shared/data/repos/reportsRepo'
import { photosRepo } from '@/shared/data/repos/photosRepo'
import { profilesRepo } from '@/shared/data/repos/profilesRepo'
import { getSession } from '@/shared/auth/authService'
import { withTimeout } from '@/shared/lib/withTimeout'
import { reverseGeocodeCityState } from '@/shared/domain/geocode'
import {
  isPendingPin, deriveSubmissionVisuals, buildPinInsertPayload, buildPendingPinUpdate,
  buildMergedReportPayload, buildReportInsertPayload, appendDatedNote,
} from '@/shared/domain/activitySubmission'

const T = { revgeo: 7000, insertPin: 12000, findPending: 12000, updatePin: 12000, mergeReport: 12000, insertReport: 12000, appendNote: 12000, insertPhotos: 12000 }

// ---- data wrappers (abortable) ------------------------------------------------

export function insertPin(payload, signal) {
  let q = pinsRepo.insert([payload]).select('id, friendly_id, lat, lng, city, state')
  if (signal) q = q.abortSignal(signal)
  return q.single()
}

export function findOldestPendingReportByPinId(pinId, signal) {
  let q = reportsRepo.table()
    .select('id, report_type')
    .eq('pin_id', pinId).eq('is_approved', false).eq('is_deleted', false)
    .order('created_at', { ascending: true })
    .limit(1)
  if (signal) q = q.abortSignal(signal)
  return q
}

export function updatePinById(pinId, payload, signal) {
  let q = pinsRepo.updateById(pinId, payload)
  if (signal) q = q.abortSignal(signal)
  return q
}

export function updateReportById(reportId, payload, signal) {
  let q = reportsRepo.updateById(reportId, payload)
  if (signal) q = q.abortSignal(signal)
  return q
}

export function insertReport(payload, signal) {
  let q = reportsRepo.insert([payload]).select('id')
  if (signal) q = q.abortSignal(signal)
  return q.single()
}

/** Insert `photos` rows for uploaded public URLs; resolves { data: rows, error }. */
export function attachPhotoUrls(reportId, urls = [], signal) {
  const rows = (urls || []).filter(Boolean).map((url) => ({ report_id: reportId, image_url: url }))
  if (!rows.length) return Promise.resolve({ data: [], error: null })
  return withTimeout(photosRepo.insertRows(rows, signal).select('id, image_url'), T.insertPhotos, 'submit:insertPhotos')
}

export function getUsernameByUserId(uid) {
  if (!uid) return Promise.resolve({ data: null, error: null })
  return profilesRepo.selectById(uid, 'username')
}

/** Display name for notifications: injected profile username → profiles row → 'anonymous'. */
export async function resolveSubmitterName({ user, userProfile = null } = {}) {
  try {
    const injected = String(userProfile?.value?.username || '').trim()
    if (injected) return injected
    const uid = user?.value?.id
    if (!uid) return 'anonymous'
    const { data, error } = await getUsernameByUserId(uid)
    if (error) return 'anonymous'
    return data?.username || 'anonymous'
  } catch {
    return 'anonymous'
  }
}

/** After AFK: touch auth + db with short timeouts so the first real call isn't the slow one. Never throws. */
export async function warmSupabaseLite() {
  try { await withTimeout(getSession(), 4000, 'warm:auth') } catch {}
  try { await withTimeout(pinsRepo.table().select('id').limit(1), 4000, 'warm:db') } catch {}
}

// ---- the workflow ------------------------------------------------------------

/**
 * Create or merge the pin + report rows for one submission.
 * @param {object} p
 * @param {number} p.lat  @param {number} p.lng
 * @param {string} p.submitter           auth user id
 * @param {{reportType?:string, signText?:string, signType?:string, locationDescription?:string}} p.fields
 * @param {string|null} p.existingPinId  set when the user chose an existing pin
 * @param {object|null} p.existingPin    that pin's row if known (drives merge + visuals)
 * @param {boolean} p.mergeIntoPending   merge into the existing pin when it is still pending
 * @param {string|null} p.provisionalPinId / p.provisionalReportId   ids minted before upload (photo keys)
 * @param {string} p.updateNote          quick-update note appended to an existing pin's description (non-fatal)
 * @param {AbortSignal} p.signal
 * @returns {{ pinId, reportId, pinRow, city, state, isExistingPin, merged, noteError }}
 */
export async function submitActivity({
  lat, lng, submitter, fields = {}, existingPinId = null, existingPin = null, mergeIntoPending = false,
  provisionalPinId = null, provisionalReportId = null, updateNote = '', signal = undefined,
} = {}) {
  const isExistingPin = !!(existingPinId || existingPin?.id)
  const targetId = existingPinId || existingPin?.id || null
  const shouldMerge = isExistingPin && mergeIntoPending && isPendingPin(existingPin)
  const visuals = deriveSubmissionVisuals({ reportType: fields.reportType, signType: fields.signType, existingPin })

  // Best-effort city/state (+ country, for notification routing) for NEW pins (never blocks).
  let city = null, state = null, country = null
  if (!isExistingPin) {
    try { ({ city, state, country } = await withTimeout(reverseGeocodeCityState(lat, lng), T.revgeo, 'submit:revgeo')) } catch {}
  }

  // A) new pin
  let pinId = targetId, pinRow = null
  if (!isExistingPin) {
    const { data, error } = await withTimeout(
      insertPin(buildPinInsertPayload({ id: provisionalPinId, lat, lng, fields, city, state, submitter, visuals }), signal),
      T.insertPin, 'submit:insertPin',
    )
    if (error) throw error
    pinRow = data
    pinId = data.id
    lat = data.lat; lng = data.lng
    city = data.city ?? city; state = data.state ?? state
  }

  // B) merge into the existing pending pin + its oldest pending report, else a fresh pending report
  let reportId = null, merged = false
  if (shouldMerge) {
    const { data: pendingRows, error: pendingErr } = await withTimeout(findOldestPendingReportByPinId(pinId, signal), T.findPending, 'submit:findPendingReport')
    if (pendingErr) throw pendingErr
    const originalPending = (pendingRows || [])[0] || null
    if (originalPending?.id) {
      const { error: pinUpdateErr } = await withTimeout(
        updatePinById(pinId, buildPendingPinUpdate({ lat, lng, fields, existingPin, visuals }), signal),
        T.updatePin, 'submit:updatePendingPin',
      )
      if (pinUpdateErr) throw pinUpdateErr
      const { error: mergeErr } = await withTimeout(
        updateReportById(originalPending.id, buildMergedReportPayload({ reportType: fields.reportType, originalPending }), signal),
        T.mergeReport, 'submit:mergePendingReport',
      )
      if (mergeErr) throw mergeErr
      reportId = originalPending.id
      merged = true
    }
  }
  if (!reportId) {
    const { data, error } = await withTimeout(
      insertReport(buildReportInsertPayload({ id: provisionalReportId, pinId, reportType: fields.reportType, submitter }), signal),
      T.insertReport, 'submit:insertReport',
    )
    if (error) throw error
    reportId = data.id
  }

  // B2) dated quick-update note on an existing pin — non-fatal, reported to the caller
  let noteError = null
  const note = String(updateNote || '').trim()
  if (isExistingPin && note) {
    const next = appendDatedNote(existingPin?.description || '', note)
    try {
      const { error } = await withTimeout(
        updatePinById(pinId, { description: next, updated_at: new Date().toISOString() }, signal),
        T.appendNote, 'submit:appendNote',
      )
      if (error) throw error
    } catch (e) { noteError = e }
  }

  return { pinId, reportId, pinRow, city, state, country, lat, lng, isExistingPin, merged, visuals, noteError }
}
