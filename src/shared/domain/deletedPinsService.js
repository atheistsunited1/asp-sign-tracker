// Reads for soft-deleted pins and their deleted activities (Reports "Deleted"
// tab and the Deleted pins page). Restore/purge live in activityLifecycleService.
import { pinsRepo } from '@/shared/data/repos/pinsRepo'
import { reportsRepo } from '@/shared/data/repos/reportsRepo'

function normalizeDeletedPinFilters(filters = {}) {
  const s = (v) => (typeof v === 'string' ? v.trim() : '')
  return { q: s(filters.q), city: s(filters.city), state: s(filters.state), deletedFrom: s(filters.deletedFrom), deletedTo: s(filters.deletedTo) }
}

export async function fetchDeletedPinsPage({ from = 0, to = 99, filters = {} } = {}) {
  const f = normalizeDeletedPinFilters(filters)
  let q = pinsRepo
    .table()
    .select(
      'id, friendly_id, sign_text, sign_type, description, city, state, lat, lng, is_major_campaign, icon_type, icon_color, deleted_at, updated_at, created_at',
      { count: 'exact' },
    )
    .eq('is_deleted', true)
    .order('deleted_at', { ascending: false, nullsFirst: false })
    .range(from, to)

  if (f.q) {
    const kw = f.q.replace(/[()]/g, '').split(',').join('\\,')
    q = q.or(`friendly_id.ilike.*${kw}*,sign_text.ilike.*${kw}*,description.ilike.*${kw}*`)
  }
  if (f.city) q = q.ilike('city', `${f.city}%`)
  if (f.state) q = q.ilike('state', `${f.state}%`)
  if (f.deletedFrom) q = q.gte('deleted_at', `${f.deletedFrom}T00:00:00.000Z`)
  if (f.deletedTo) q = q.lte('deleted_at', `${f.deletedTo}T23:59:59.999Z`)
  return q
}

export function fetchDeletedReportsByPin(pinId) {
  return reportsRepo
    .table()
    .select(`
      id, pin_id, report_type, occurred_on, submitted_by, approved_by, is_approved,
      is_deleted, deleted_at, created_at, updated_at,
      photos ( id, image_url, created_at )
    `)
    .eq('pin_id', pinId)
    .eq('is_deleted', true)
    .order('created_at', { ascending: false })
}
