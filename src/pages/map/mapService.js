import { pinsRepo } from '@/shared/data/repos/pinsRepo'
import { photosRepo } from '@/shared/data/repos/photosRepo'
import { profilesRepo } from '@/shared/data/repos/profilesRepo'
import { reportsRepo } from '@/shared/data/repos/reportsRepo'
import { bookmarksRepo } from '@/shared/data/repos/bookmarksRepo'
import { getSession as getAuthSession, refreshSession as refreshAuthSession } from '@/shared/auth/authService'

export async function warmSupabaseConnection() {
  try { await refreshAuthSession() } catch {}
  try { await getAuthSession() } catch {}
  try { await pinsRepo.table().select('id').limit(1) } catch {}
}

export function fetchReportsForPin(pinId) {
  return reportsRepo
    .selectByPinId(pinId, 'id, pin_id, report_type, occurred_on, created_at, updated_at, is_approved')
    .eq('is_deleted', false)
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(50)
}


export async function fetchPinHistoryById(pinId, { cachedPin = null } = {}) {
  let pin = cachedPin
  if (!pin) {
    const { data: pinData, error: pinError } = await pinsRepo
      .selectById(pinId, 'id, lat, lng, friendly_id, description, sign_type, sign_text, gsv_date, is_approved')
    if (pinError) throw pinError
    pin = pinData || null
  }

  const { data: reportRows, error: reportsError } = await reportsRepo
    .selectByPinId(
      pinId,
      `
        id,
        created_at,
        occurred_on,
        report_type,
        is_approved,
        submitted_by,
        photos ( image_url, created_at )
      `,
    )
    .order('created_at', { ascending: true, foreignTable: 'photos' })

  if (reportsError) throw reportsError

  const userIds = [...new Set((reportRows || []).map(r => r.submitted_by).filter(Boolean))]
  let usernameById = new Map()
  if (userIds.length) {
    const { data: profiles, error: profilesError } = await profilesRepo
      .selectByIds(userIds, 'id, username')
    if (profilesError) throw profilesError
    for (const p of (profiles || [])) {
      usernameById.set(p.id, p.username || '')
    }
  }

  const reports = (reportRows || []).map(r => ({
    ...r,
    photos: r.photos || [],
    __pending: !r.is_approved,
    __username: usernameById.get(r.submitted_by) || '',
  }))

  return { pin, reports }
}

export function fetchPinsPage({ from, to, columns }) {
  return pinsRepo
    .selectPage({ columns, from, to, count: 'exact' })
    .eq('is_deleted', false)
}

export function fetchPinById(pinId) {
  return pinsRepo
    .table()
    .select('id, lat, lng, description, sign_text, sign_type, icon_type, icon_color, is_major_campaign')
    .eq('id', pinId)
    .eq('is_deleted', false)
    .maybeSingle()
}

export function updatePinById(pinId, payload) {
  return pinsRepo.updateById(pinId, payload)
}

export function insertReports(rows) {
  return reportsRepo.insert(rows)
}

export function fetchReportIdsForPin(pinId, { approvedOnly = false, limit = 50 } = {}) {
  let q = reportsRepo
    .table()
    .select('id')
    .eq('pin_id', pinId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (approvedOnly) q = q.eq('is_approved', true)
  return q
}

/** Guest-safe: approved reports of approved pins via SECURITY DEFINER RPC. */
export function fetchPublicReportsForPins(pinIds) {
  return reportsRepo.rpcPublicReportsForPins(pinIds)
}

/** Guest-safe: photos of approved reports via SECURITY DEFINER RPC. */
export function fetchPublicPhotosForReports(reportIds) {
  return photosRepo.rpcPublicPhotosForReports(reportIds)
}

export function fetchPhotoRowsForReportIds(reportIds, { limit = 100 } = {}) {
  return photosRepo
    .table()
    .select('image_url, created_at, report_id')
    .in('report_id', reportIds)
    .order('created_at', { ascending: false })
    .limit(limit)
}

export function fetchReportedPinIdsByUser(uid, { from, to } = {}) {
  return reportsRepo
    .table()
    .select('pin_id')
    .eq('submitted_by', uid)
    .not('pin_id', 'is', null)
    .eq('is_deleted', false)
    .order('pin_id', { ascending: true })
    .range(from, to)
}

export function fetchBookmarksForUser(userId) {
  return bookmarksRepo.selectByUser(userId, 'pin_id,created_at')
}

export function upsertBookmarkForUser(userId, pinId) {
  return bookmarksRepo.upsertByUserPin(userId, pinId)
}

export function deleteBookmarkForUser(userId, pinId) {
  return bookmarksRepo.deleteByUserPin(userId, pinId)
}
