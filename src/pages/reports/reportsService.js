// Reports page data access: the review feed (pending / approved pages + counts
// with filters), detail-card edits, and the report photo rows. Lifecycle
// workflows (approve, delete, restore, purge) are in
// shared/domain/activityLifecycleService.
import { photosRepo } from '@/shared/data/repos/photosRepo'
import { pinsRepo } from '@/shared/data/repos/pinsRepo'
import { reportsRepo } from '@/shared/data/repos/reportsRepo'

export const DEFAULT_REPORT_FILTERS = Object.freeze({
  q: '',
  reportTypes: [],
  signTypes: [],
  city: '',
  state: '',
  dateFrom: '',
  dateTo: '',
  username: '',
  initials: '',
  description: '',
  sign_text: '',
  majorCampaign: false,
})

const hasText = (v) => typeof v === 'string' && v.trim() !== ''

function normalizeFilters(filters = {}) {
  return {
    ...DEFAULT_REPORT_FILTERS,
    ...filters,
    reportTypes: Array.isArray(filters.reportTypes) ? filters.reportTypes : [],
    signTypes: Array.isArray(filters.signTypes) ? filters.signTypes : [],
  }
}

function deriveJoinFlags(filters = {}) {
  return {
    pinsInner: !!(hasText(filters.q) || filters.signTypes.length || hasText(filters.city) || hasText(filters.state) || filters.majorCampaign),
    submitterInner: !!(hasText(filters.username) || hasText(filters.initials)),
  }
}

const PIN_COLS = 'id,is_approved,friendly_id,description,lat,lng,sign_text,sign_type,icon_type,icon_color,city,state,gsv_date,is_major_campaign,submitted_by'

function buildReportsSelect({ pinsInner = false, submitterInner = false } = {}) {
  return [
    'id', 'created_at', 'report_type', 'occurred_on', 'submitted_by', 'pin_id', 'is_approved', 'approved_by',
    'photos(id,image_url,created_at)',
    pinsInner ? `pins:pin_id!inner(${PIN_COLS})` : `pins:pin_id(${PIN_COLS})`,
    submitterInner ? 'submitter:submitted_by!inner(username,initials,id)' : 'submitter:submitted_by(username,initials,id)',
    'approver:approved_by(username,id)',
  ].join(',')
}

function buildCountSelect({ pinsInner = false, submitterInner = false } = {}) {
  const pinsSel = pinsInner ? 'pins:pin_id!inner(id)' : 'pins:pin_id(id)'
  const submitterSel = submitterInner ? ',submitter:submitted_by!inner(id)' : ',submitter:submitted_by(id)'
  return `id, ${pinsSel}${submitterSel}`
}

function applyFiltersToQuery(q, filters = {}) {
  const like = (v) => `*${v}*`

  if (hasText(filters.q)) {
    const kw = filters.q.trim().replace(/[()]/g, '').split(',').join('\\,')
    q = q.or(`pins.sign_text.ilike.*${kw}*,pins.friendly_id.ilike.*${kw}*`)
  }
  if (filters.reportTypes.length) q = q.in('report_type', filters.reportTypes)
  if (filters.signTypes.length) {
    const quoted = filters.signTypes.map((v) => `"${v}"`).join(',')
    q = q.filter('pins.sign_type', 'in', `(${quoted})`)
  }
  if (hasText(filters.description)) q = q.ilike('pins.description', like(filters.description.trim()))
  if (hasText(filters.sign_text)) q = q.ilike('pins.sign_text', like(filters.sign_text.trim()))
  if (hasText(filters.username)) q = q.ilike('submitter.username', like(filters.username.trim()))
  // Initials are a code, not prose: exact (case-insensitive) match.
  if (hasText(filters.initials)) q = q.ilike('submitter.initials', filters.initials.trim())
  if (hasText(filters.city)) q = q.ilike('pins.city', `${filters.city.trim()}%`)
  // A 2-letter state code matches exactly; longer input is a prefix (regions, typos).
  if (hasText(filters.state)) {
    const st = filters.state.trim()
    q = q.ilike('pins.state', st.length === 2 ? st : `${st}%`)
  }
  // Activity dates are the domain date (occurred_on), not the row write time.
  if (filters.dateFrom) q = q.gte('occurred_on', filters.dateFrom)
  if (filters.dateTo) q = q.lte('occurred_on', filters.dateTo)
  if (filters.majorCampaign) q = q.eq('pins.is_major_campaign', true)
  return q
}

function scoped(q, { normalizedFilters, pinsInner, myOnlyUserId, filters, applyFilters }) {
  if (pinsInner) q = q.eq('pins.is_deleted', false)
  if (myOnlyUserId) q = q.eq('submitted_by', myOnlyUserId)
  if (filters) q = applyFiltersToQuery(q, normalizedFilters)
  if (typeof applyFilters === 'function') q = applyFilters(q) || q
  return q
}

async function fetchReportsCount({ approved = false, pinsInner = false, submitterInner = false, myOnlyUserId = null, filters = null, applyFilters = null } = {}) {
  const normalizedFilters = normalizeFilters(filters || {})
  const flags = deriveJoinFlags(normalizedFilters)
  const effPins = pinsInner || flags.pinsInner, effSub = submitterInner || flags.submitterInner
  const q = reportsRepo
    .table()
    .select(buildCountSelect({ pinsInner: effPins, submitterInner: effSub }), { count: 'exact', head: true })
    .eq('is_approved', approved)
    .eq('is_deleted', false)
  return scoped(q, { normalizedFilters, pinsInner: effPins, myOnlyUserId, filters, applyFilters })
}

export function fetchSubmittedCount(params = {}) {
  return fetchReportsCount({ ...params, approved: false })
}

async function fetchReportsPage({ approved = false, select = null, from = 0, to = 99, ascending = true, pinsInner = false, submitterInner = false, myOnlyUserId = null, filters = null, applyFilters = null } = {}) {
  const normalizedFilters = normalizeFilters(filters || {})
  const flags = deriveJoinFlags(normalizedFilters)
  const effPins = pinsInner || flags.pinsInner, effSub = submitterInner || flags.submitterInner
  const q = reportsRepo
    .table()
    .select(select || buildReportsSelect({ pinsInner: effPins, submitterInner: effSub }))
    .eq('is_approved', approved)
    .eq('is_deleted', false)
    .order('occurred_on', { ascending })
    .order('created_at', { ascending })
    .range(from, to)
  return scoped(q, { normalizedFilters, pinsInner: effPins, myOnlyUserId, filters, applyFilters })
}

/** Pending review, oldest first. */
export function fetchSubmittedPage(params = {}) {
  return fetchReportsPage({ ...params, approved: false, ascending: true })
}
/** Approved, newest first. */
export function fetchApprovedPage(params = {}) {
  return fetchReportsPage({ ...params, approved: true, ascending: false })
}

export function fetchReportPinLink(reportId) {
  return reportsRepo.table().select('id, pin_id').eq('id', reportId).single()
}

// ---- detail card edits ---------------------------------------------------------

export function updatePinForSaveEdits(pinId, payload) {
  return pinsRepo
    .table()
    .update(payload)
    .eq('id', pinId)
    .select('id, lat, lng, sign_text, sign_type, icon_type, icon_color, city, state, gsv_date, description')
    .single()
}

export function updateReportForSaveEdits(reportId, payload) {
  return reportsRepo
    .table()
    .update(payload)
    .eq('id', reportId)
    .select('id, report_type, updated_at')
    .single()
}

// ---- report photos -------------------------------------------------------------

export function fetchPhotoRowsByReportId(reportId, { ascending = null } = {}) {
  return photosRepo.listByReportId(reportId, { ascending })
}

export function deletePhotoById(photoId) {
  return photosRepo.deleteById(photoId)
}
