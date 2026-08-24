// Activity lifecycle workflows — approve, soft delete (+ audit), restore,
// hard delete, purge, and keeping the pin's lifecycle state in step with its
// latest activity. Used by the Reports page, the Deleted pins page and the map.
// Row access is governed by RLS (ADR-0001); this module only sequences writes.
import { photosRepo } from '@/shared/data/repos/photosRepo'
import { pinsRepo } from '@/shared/data/repos/pinsRepo'
import { reportsRepo } from '@/shared/data/repos/reportsRepo'
import { supabase } from '@/shared/data/supabase'
import { keyFromPublicUrl } from '@/shared/data/photoStorage'
import { defaultColorForPin, iconTypeForReportType } from '@/shared/domain/pinVisuals'
import { lifecycleTypeOrDefault } from '@/shared/domain/activityLifecycle'

// ---- reads used by the workflows / approval UI --------------------------------

/** Latest approved terminal activity (plundered/krakened) for a pin, by domain date. */
export function fetchLatestFinalForPin(pinId) {
  return reportsRepo
    .table()
    .select('occurred_on, created_at, report_type')
    .eq('pin_id', pinId)
    .eq('is_approved', true)
    .eq('is_deleted', false)
    .in('report_type', ['plundered', 'krakened'])
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
}

/** Fresh read of a report + its pin + photos right before approval. */
export function fetchReportForApproval(reportId) {
  return reportsRepo
    .table()
    .select(`
      id, pin_id, report_type, occurred_on, submitted_by, is_approved, created_at,
      photos ( id, image_url ),
      pins:pin_id (
        id, is_approved, friendly_id, description, lat, lng,
        sign_text, sign_type, icon_type, icon_color, city, state, gsv_date, submitted_by
      )
    `)
    .eq('id', reportId)
    .eq('is_deleted', false)
    .single()
}

function nonAuditReportsForPinQuery(pinId) {
  return reportsRepo
    .table()
    .select('id, pin_id, report_type, is_approved, created_at')
    .eq('pin_id', pinId)
    .eq('is_deleted', false)
    .not('report_type', 'in', '("deleted","restored")')
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false })
}

export function fetchActiveNonAuditReportsForPin(pinId, { limit = 200 } = {}) {
  return nonAuditReportsForPinQuery(pinId).limit(limit)
}

export function countActiveNonAuditReportsForPin(pinId) {
  return reportsRepo
    .table()
    .select('id', { head: true, count: 'exact' })
    .eq('pin_id', pinId)
    .eq('is_deleted', false)
    .not('report_type', 'in', '("deleted","restored")')
}

// ---- approval -----------------------------------------------------------------

export function updatePinForApproval(pinId, payload) {
  return pinsRepo
    .table()
    .update(payload)
    .eq('id', pinId)
    .select('id,is_approved,icon_type,icon_color,lat,lng,city,state,sign_text,sign_type,updated_at')
    .single()
}

export function markReportApproved(reportId, payload) {
  return reportsRepo.updateById(reportId, payload)
}

/** Audit rows written when a reviewer moves an approved pin. */
export function insertRelocateReport(rows) {
  return reportsRepo.insert(rows)
}

/** Recompute the pin's icon_type/colour/approval from its latest non-audit activity. */
export async function syncPinLifecycleFromLatestNonAuditReport(pinId) {
  const { data: pinRow, error: pinErr } = await pinsRepo
    .table()
    .select('id, is_major_campaign, sign_type')
    .eq('id', pinId)
    .maybeSingle()
  if (pinErr) throw pinErr
  if (!pinRow) return { updated: false, latestReport: null, payload: null }

  const { data: latestLifecycle, error: latestErr } = await reportsRepo
    .table()
    .select('report_type, is_approved, created_at')
    .eq('pin_id', pinId)
    .eq('is_deleted', false)
    .not('report_type', 'in', '("deleted","restored")')
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latestErr) throw latestErr
  if (!latestLifecycle) return { updated: false, latestReport: null, payload: null }

  const nowIso = new Date().toISOString()
  const nextIconType = iconTypeForReportType(latestLifecycle.report_type || 'sighting')
  const nextColor = defaultColorForPin({
    iconType: nextIconType,
    isMajorCampaign: !!pinRow.is_major_campaign,
    signType: pinRow.sign_type || '',
  })
  const payload = {
    is_approved: latestLifecycle.is_approved === true,
    icon_type: nextIconType,
    icon_color: nextColor,
    updated_at: nowIso,
  }
  const { error: pinUpdateErr } = await pinsRepo.updateById(pinId, payload)
  if (pinUpdateErr) throw pinUpdateErr

  return { updated: true, latestReport: latestLifecycle, payload }
}

// ---- soft delete (30-day restore window) ---------------------------------------

export function softDeleteReport(reportId) {
  return reportsRepo.updateById(reportId, { is_deleted: true, deleted_at: new Date().toISOString() })
}

export async function softDeletePinWithAudit(pinId, { actorUserId = null, reason = '' } = {}) {
  const nowIso = new Date().toISOString()
  const deletePayload = { is_deleted: true, deleted_at: nowIso, updated_at: nowIso }

  const { error: pinErr } = await pinsRepo.updateById(pinId, deletePayload)
  if (pinErr) throw pinErr

  const { error: reportsErr } = await reportsRepo
    .table()
    .update(deletePayload)
    .eq('pin_id', pinId)
    .eq('is_deleted', false)
  if (reportsErr) throw reportsErr

  const { error: auditErr } = await reportsRepo
    .table()
    .insert({
      pin_id: pinId,
      report_type: 'deleted',
      submitted_by: actorUserId,
      approved_by: actorUserId,
      is_approved: true,
      is_deleted: true,
      deleted_at: nowIso,
    })
  if (auditErr) throw auditErr
}

// ---- restore ------------------------------------------------------------------

export async function restoreDeletedPin({
  pinId,
  actorUserId,
  selectedDeletedReportIds = [],
  selectedReportOverrides = {},
  newReport = null,
  pinPatch = {},
} = {}) {
  const reportIds = Array.isArray(selectedDeletedReportIds)
    ? [...new Set(selectedDeletedReportIds.filter(Boolean))]
    : []
  const reportOverrideMap = reportIds.reduce((acc, reportId) => {
    const raw = selectedReportOverrides?.[reportId]
    if (!raw || typeof raw !== 'object') return acc
    acc[reportId] = { report_type: lifecycleTypeOrDefault(raw.report_type) }
    return acc
  }, {})
  const hasNewReport = !!(newReport && typeof newReport === 'object')
  if (!reportIds.length && !hasNewReport) {
    throw new Error('Restore requires at least one selected report or a new report payload.')
  }

  const nowIso = new Date().toISOString()
  let newReportId = null

  const { data: restoredPin, error: pinErr } = await pinsRepo
    .table()
    .update({ is_deleted: false, deleted_at: null, is_approved: true, updated_at: nowIso, ...pinPatch })
    .eq('id', pinId)
    .select('id, sign_type, is_major_campaign, icon_color, icon_type')
    .single()
  if (pinErr) throw pinErr

  if (reportIds.length) {
    const { error: repRestoreErr } = await reportsRepo
      .table()
      .update({ is_deleted: false, deleted_at: null, is_approved: true, approved_by: actorUserId || null, updated_at: nowIso })
      .eq('pin_id', pinId)
      .in('id', reportIds)
    if (repRestoreErr) throw repRestoreErr

    for (const reportId of Object.keys(reportOverrideMap)) {
      const { error: reportOverrideErr } = await reportsRepo
        .table()
        .update({
          report_type: reportOverrideMap[reportId].report_type,
          is_deleted: false, deleted_at: null, is_approved: true,
          approved_by: actorUserId || null, updated_at: nowIso,
        })
        .eq('pin_id', pinId)
        .eq('id', reportId)
      if (reportOverrideErr) throw reportOverrideErr
    }
  }

  if (hasNewReport) {
    const { data: newRepRow, error: newRepErr } = await reportsRepo
      .table()
      .insert({
        pin_id: pinId,
        report_type: lifecycleTypeOrDefault(newReport.report_type),
        submitted_by: actorUserId || null,
        approved_by: actorUserId || null,
        is_approved: true,
        is_deleted: false,
      })
      .select('id')
      .single()
    if (newRepErr) throw newRepErr
    newReportId = newRepRow?.id || null
  }

  const { error: restoreDeletedAuditErr } = await reportsRepo
    .table()
    .update({ is_deleted: false, deleted_at: null, is_approved: true, approved_by: actorUserId || null, updated_at: nowIso })
    .eq('pin_id', pinId)
    .eq('report_type', 'deleted')
    .eq('is_deleted', true)
  if (restoreDeletedAuditErr) throw restoreDeletedAuditErr

  const { error: restoredAuditErr } = await reportsRepo
    .table()
    .insert({
      pin_id: pinId,
      report_type: 'restored',
      submitted_by: actorUserId || null,
      approved_by: actorUserId || null,
      is_approved: true,
      is_deleted: false,
    })
  if (restoredAuditErr) throw restoredAuditErr

  const { data: latestLifecycle, error: latestErr } = await reportsRepo
    .table()
    .select('report_type, created_at')
    .eq('pin_id', pinId)
    .eq('is_deleted', false)
    .not('report_type', 'in', '("deleted","restored")')
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latestErr) throw latestErr

  const latestReportType = lifecycleTypeOrDefault(latestLifecycle?.report_type || newReport?.report_type || 'sighting')
  const nextIconType = iconTypeForReportType(latestReportType)
  const nextColor = defaultColorForPin({
    iconType: nextIconType,
    isMajorCampaign: !!restoredPin?.is_major_campaign,
    signType: restoredPin?.sign_type || '',
  })
  const { error: pinIconErr } = await pinsRepo.updateById(pinId, { icon_type: nextIconType, icon_color: nextColor, updated_at: nowIso })
  if (pinIconErr) throw pinIconErr

  return { pinId, newReportId, restoredReportCount: reportIds.length }
}

// ---- hard delete / purge ------------------------------------------------------

/** Storage keys of every photo on the given reports (for cleanup after a hard delete). */
export async function collectPhotoPathsForReportIds(reportIds = []) {
  const ids = Array.isArray(reportIds) ? [...new Set(reportIds.filter(Boolean))] : []
  if (!ids.length) return []
  const { data, error } = await photosRepo.table().select('image_url').in('report_id', ids)
  if (error) throw error
  return (data || []).map((r) => keyFromPublicUrl(r?.image_url)).filter(Boolean)
}

export async function forceDeleteReportNow(reportId) {
  const { data: photos, error: photosErr } = await photosRepo.table().select('image_url').eq('report_id', reportId)
  if (photosErr) throw photosErr
  const photoPaths = (photos || []).map((r) => keyFromPublicUrl(r?.image_url)).filter(Boolean)

  const { error: deletePhotosErr } = await photosRepo.deleteByReportId(reportId)
  if (deletePhotosErr) throw deletePhotosErr

  const { error: deleteReportErr } = await reportsRepo.table().delete().eq('id', reportId)
  if (deleteReportErr) throw deleteReportErr

  return { photoPaths }
}

export async function forceDeletePinNow(pinId) {
  const { data: reportRows, error: repErr } = await reportsRepo.table().select('id').eq('pin_id', pinId)
  if (repErr) throw repErr
  const reportIds = (reportRows || []).map((r) => r.id).filter(Boolean)

  let photoPaths = []
  if (reportIds.length) {
    photoPaths = await collectPhotoPathsForReportIds(reportIds)
    const { error: deletePhotosErr } = await photosRepo.table().delete().in('report_id', reportIds)
    if (deletePhotosErr) throw deletePhotosErr
    const { error: deleteReportsErr } = await reportsRepo.table().delete().eq('pin_id', pinId)
    if (deleteReportsErr) throw deleteReportsErr
  }

  const { error: deletePinErr } = await pinsRepo.table().delete().eq('id', pinId)
  if (deletePinErr) throw deletePinErr

  return { photoPaths }
}

/** Admin-only RPC: hard-delete everything soft-deleted past the retention window. */
export async function purgeSoftDeletedRowsNow() {
  const { data, error } = await supabase.rpc('purge_soft_deleted_rows')
  if (error) throw error
  return data
}
