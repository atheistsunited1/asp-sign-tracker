import { pinsRepo } from '@/shared/data/repos/pinsRepo'
import { reportsRepo } from '@/shared/data/repos/reportsRepo'

const PIN_COLUMNS_BASE = [
  'id',
  'friendly_id',
  'lat',
  'lng',
  'city',
  'state',
  'description',
  'sign_text',
  'sign_type',
  'icon_type',
  'is_approved',
  'updated_at',
  'created_at',
  'is_major_campaign',
  'campaign_class',
].join(',')
const PIN_COLUMNS_WITH_ZIP = `${PIN_COLUMNS_BASE},zip`
let supportsZipColumn = true

function normalizeText(v) {
  return String(v || '').trim()
}

function normalizeLower(v) {
  return normalizeText(v).toLowerCase()
}

function clampInt(n, min, max, fallback) {
  const x = Number(n)
  if (!Number.isFinite(x)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(x)))
}

function safeLikeTerm(v) {
  return normalizeText(v)
    .replace(/[()]/g, '')
    .split(',').join('\\,')
}

function isZipColumnError(error) {
  const msg = String(error?.message || '').toLowerCase()
  if (!msg) return false
  if (!msg.includes('zip')) return false
  return (
    msg.includes('column') ||
    msg.includes('does not exist') ||
    msg.includes('schema cache') ||
    msg.includes('could not find')
  )
}

function currentPinColumns() {
  return supportsZipColumn ? PIN_COLUMNS_WITH_ZIP : PIN_COLUMNS_BASE
}

function buildPinOrPredicate(kw) {
  const predicates = [
    `friendly_id.ilike.*${kw}*`,
    `description.ilike.*${kw}*`,
    `sign_text.ilike.*${kw}*`,
    `city.ilike.*${kw}*`,
    `state.ilike.*${kw}*`,
  ]
  if (supportsZipColumn) predicates.push(`zip.ilike.*${kw}*`)
  return predicates.join(',')
}

async function execPinsQuery(buildQuery, signal) {
  let query = buildQuery(currentPinColumns())
  if (signal) query = query.abortSignal(signal)
  let result = await query

  if (result.error && supportsZipColumn && isZipColumnError(result.error)) {
    supportsZipColumn = false
    query = buildQuery(currentPinColumns())
    if (signal) query = query.abortSignal(signal)
    result = await query
  }
  return result
}

function inViewport(pin, viewport) {
  if (!viewport) return true
  const lat = Number(pin?.lat)
  const lng = Number(pin?.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false

  const south = Number(viewport?.south)
  const north = Number(viewport?.north)
  const west = Number(viewport?.west)
  const east = Number(viewport?.east)
  if (![south, north, west, east].every(Number.isFinite)) return true

  if (lat < Math.min(south, north) || lat > Math.max(south, north)) return false
  // Dateline-safe longitude check.
  if (west <= east) return lng >= west && lng <= east
  return lng >= west || lng <= east
}

function scoredDate(pin) {
  const s = pin?.updated_at || pin?.created_at || ''
  const t = Date.parse(s)
  return Number.isFinite(t) ? t : 0
}

function scorePinRow(pin, qLower) {
  if (!qLower) return 0
  let score = 0
  const fid = normalizeLower(pin?.friendly_id)
  const pid = normalizeLower(pin?.id)
  const city = normalizeLower(pin?.city)
  const state = normalizeLower(pin?.state)
  const zip = normalizeLower(pin?.zip)
  const sign = normalizeLower(pin?.sign_text)
  const loc = normalizeLower(pin?.description)

  if (fid && fid === qLower) score += 220
  if (pid && pid === qLower) score += 220
  if (fid.startsWith(qLower)) score += 120
  if (pid.startsWith(qLower)) score += 120
  if (fid.includes(qLower)) score += 80
  if (pid.includes(qLower)) score += 80
  if (city.includes(qLower)) score += 36
  if (state.includes(qLower)) score += 28
  if (zip.includes(qLower)) score += 32
  if (sign.includes(qLower)) score += 24
  if (loc.includes(qLower)) score += 18

  return score
}

function scoreReportRow(row, qLower) {
  let score = 0
  const type = normalizeLower(row?.report_type)

  if (qLower && type.includes(qLower)) score += 28
  return score
}

function addPinScore(scoreByPin, reportHitsByPin, pinId, score, reportHit = false) {
  if (!pinId) return
  const prevScore = scoreByPin.get(pinId) || 0
  scoreByPin.set(pinId, prevScore + (Number(score) || 0))
  if (reportHit) {
    const prevHits = reportHitsByPin.get(pinId) || 0
    reportHitsByPin.set(pinId, prevHits + 1)
  }
}

async function fetchPinsByIds(pinIds, signal) {
  if (!Array.isArray(pinIds) || !pinIds.length) return []
  const out = []
  const chunkSize = 200
  for (let i = 0; i < pinIds.length; i += chunkSize) {
    const chunk = pinIds.slice(i, i + chunkSize)
    const { data, error } = await execPinsQuery((columns) => (
      pinsRepo
        .table()
        .select(columns)
        .in('id', chunk)
        .eq('is_deleted', false)
        .limit(chunkSize)
    ), signal)
    if (error) throw error
    out.push(...(data || []))
  }
  return out
}

export async function searchPinsAndReports({
  query = '',
  viewport = null,
  page = 1,
  pageSize = 25,
  cap = 100,
  signal = null,
} = {}) {
  const qText = normalizeText(query)
  const qLower = qText.toLowerCase()
  const hasAnyTerm = qText.length > 0
  if (!hasAnyTerm) {
    return { rows: [], total: 0, page: 1, pageSize: clampInt(pageSize, 1, 100, 25), capReached: false }
  }

  const scoreByPin = new Map()
  const reportHitsByPin = new Map()
  const pinsById = new Map()
  const candidatePinIds = new Set()
  const hardCap = clampInt(cap, 10, 200, 100)
  const perQueryLimit = Math.max(hardCap, 200)

  if (qText) {
    const kw = safeLikeTerm(qText)
    const { data: pinRows, error: pinErr } = await execPinsQuery((columns) => (
      pinsRepo
        .table()
        .select(columns)
        .eq('is_deleted', false)
        .or(buildPinOrPredicate(kw))
        .limit(perQueryLimit)
    ), signal)
    if (pinErr) throw pinErr
    for (const row of (pinRows || [])) {
      if (!row?.id) continue
      pinsById.set(row.id, row)
      candidatePinIds.add(row.id)
      addPinScore(scoreByPin, reportHitsByPin, row.id, scorePinRow(row, qLower), false)
    }
  }

  if (qText) {
    const reportSelect = 'pin_id, report_type, occurred_on, created_at'
    let reportQuery = reportsRepo
      .table()
      .select(reportSelect)
      .eq('is_deleted', false)
      .not('pin_id', 'is', null)
      .order('occurred_on', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(perQueryLimit)

    if (qText) {
      const kw = safeLikeTerm(qText)
      reportQuery = reportQuery.ilike('report_type', `*${kw}*`)
    }
    if (signal) reportQuery = reportQuery.abortSignal(signal)

    const { data: reportRows, error: reportErr } = await reportQuery
    if (reportErr) throw reportErr

    for (const row of (reportRows || [])) {
      const pinId = row?.pin_id
      if (!pinId) continue
      candidatePinIds.add(pinId)
      addPinScore(
        scoreByPin,
        reportHitsByPin,
        pinId,
        scoreReportRow(row, qLower),
        true,
      )
    }
  }

  const missingPinIds = [...candidatePinIds].filter((id) => !pinsById.has(id))
  const fetchedPins = await fetchPinsByIds(missingPinIds, signal)
  for (const row of fetchedPins) {
    if (!row?.id) continue
    pinsById.set(row.id, row)
    if (!scoreByPin.has(row.id)) {
      addPinScore(scoreByPin, reportHitsByPin, row.id, scorePinRow(row, qLower), false)
    }
  }

  let rows = [...pinsById.values()].filter((pin) => inViewport(pin, viewport))
  rows = rows.map((pin) => ({
    ...pin,
    __searchScore: scoreByPin.get(pin.id) || 0,
    __searchReportHits: reportHitsByPin.get(pin.id) || 0,
    __searchTs: scoredDate(pin),
  }))

  rows.sort((a, b) => {
    if (b.__searchScore !== a.__searchScore) return b.__searchScore - a.__searchScore
    if (b.__searchReportHits !== a.__searchReportHits) return b.__searchReportHits - a.__searchReportHits
    if (b.__searchTs !== a.__searchTs) return b.__searchTs - a.__searchTs
    return String(a.friendly_id || '').localeCompare(String(b.friendly_id || ''))
  })

  const total = rows.length
  if (rows.length > hardCap) rows = rows.slice(0, hardCap)
  const safePageSize = clampInt(pageSize, 1, 100, 25)
  const safePage = clampInt(page, 1, 1000, 1)
  const from = (safePage - 1) * safePageSize
  const to = from + safePageSize
  const pageRows = rows.slice(from, to)

  return {
    rows: pageRows,
    total,
    page: safePage,
    pageSize: safePageSize,
    capReached: total > rows.length,
  }
}
