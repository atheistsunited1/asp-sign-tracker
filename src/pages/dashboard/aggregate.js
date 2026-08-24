// Turns the dashboard_stats() payload into the view model the page renders.
// Pure; every number is a sum over the RPC's pre-aggregated rows, so the
// definitions live in one place (the SQL) and this file only slices them.
//
// Payload shape (patch 000007):
//   snapshot[] { bucket, is_major_campaign, campaign, state, n }
//   activity[] { window:'period'|'previous', report_type, is_major_campaign, campaign, state, is_billboard, n }
//   trend[]    { quarter:'YYYY-Qn', report_type, n }     (report_type incl. first_sighting, backlog_end)
//   members[]  { window, username, report_type, n }

const sum = (rows, pred = () => true) => rows.reduce((acc, r) => (pred(r) ? acc + (r.n || 0) : acc), 0)
const pct = (cur, prev) => (prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : null)

const isCA = (r) => r.state === 'CA'
const isMajor = (r) => !!r.is_major_campaign

/** Period/previous/delta numbers for one activity type (optionally further filtered). */
function periodStat(activity, type, extra = () => true) {
  const cur = sum(activity, (r) => r.window === 'period' && r.report_type === type && extra(r))
  const prev = sum(activity, (r) => r.window === 'previous' && r.report_type === type && extra(r))
  return { period: cur, previous: prev, delta: cur - prev, pct: pct(cur, prev) }
}

/** Breakdown of period counts for one type: major campaign (js/jicr/other), non-major, CA vs outside CA. */
function breakdown(activity, type, extra = () => true) {
  const p = (pred) => sum(activity, (r) => r.window === 'period' && r.report_type === type && extra(r) && pred(r))
  const major = p(isMajor)
  return {
    major,
    js: p((r) => r.campaign === 'js'),
    jicr: p((r) => r.campaign === 'jicr'),
    otherMajor: p((r) => r.campaign === 'other_major'),
    nonMajor: p((r) => !isMajor(r)),
    ca: p(isCA),
    caNonMajor: p((r) => isCA(r) && !isMajor(r)),
    outsideCa: p((r) => !isCA(r)),
    outsideCaNonMajor: p((r) => !isCA(r) && !isMajor(r)),
  }
}

/** Snapshot counts for one bucket with the same splits. */
function snapshotSplit(snapshot, bucketPred) {
  const s = (pred = () => true) => sum(snapshot, (r) => bucketPred(r) && pred(r))
  return {
    total: s(),
    major: s(isMajor),
    js: s((r) => r.campaign === 'js'),
    jicr: s((r) => r.campaign === 'jicr'),
    otherMajor: s((r) => r.campaign === 'other_major'),
    nonMajor: s((r) => !isMajor(r)),
    ca: s(isCA),
    caNonMajor: s((r) => isCA(r) && !isMajor(r)),
    outsideCa: s((r) => !isCA(r)),
    outsideCaNonMajor: s((r) => !isCA(r) && !isMajor(r)),
  }
}

export function buildDashboardModel(stats) {
  const snapshot = stats?.snapshot || []
  const activity = stats?.activity || []
  const trendRows = stats?.trend || []
  const memberRows = stats?.members || []

  const notBillboard = (r) => !r.is_billboard
  const trackedNow = sum(activity, (r) => r.window === 'period' && r.report_type === 'tracked_total')
  const trackedPrev = sum(activity, (r) => r.window === 'previous' && r.report_type === 'tracked_total')
  const added = periodStat(activity, 'first_sighting')

  const plundered = { ...periodStat(activity, 'plundered'), ...breakdown(activity, 'plundered'), snapshot: snapshotSplit(snapshot, (r) => r.bucket === 'plundered') }
  const krakened = { ...periodStat(activity, 'krakened'), ...breakdown(activity, 'krakened'), snapshot: snapshotSplit(snapshot, (r) => r.bucket === 'krakened') }
  const questionable = { ...periodStat(activity, 'questionable'), ...breakdown(activity, 'questionable'), snapshot: snapshotSplit(snapshot, (r) => r.bucket === 'questionable') }
  const sightings = { ...periodStat(activity, 'sighting'), ...breakdown(activity, 'sighting') }

  // Treasure in waiting: live backlog = sighting bucket, not billboards; period change ≈
  // new non-billboard signs − plunders − krakenings in the period (same split per slice).
  const backlogSnap = snapshotSplit(snapshot, (r) => r.bucket === 'sighting')
  const newSigns = breakdown(activity, 'first_sighting', notBillboard)
  const plNB = breakdown(activity, 'plundered', notBillboard)
  const krNB = breakdown(activity, 'krakened', notBillboard)
  const newPeriod = periodStat(activity, 'first_sighting', notBillboard)
  const plPeriod = periodStat(activity, 'plundered', notBillboard)
  const krPeriod = periodStat(activity, 'krakened', notBillboard)
  const netKeys = ['major', 'js', 'jicr', 'otherMajor', 'nonMajor', 'ca', 'caNonMajor', 'outsideCa', 'outsideCaNonMajor']
  const backlog = {
    snapshot: backlogSnap,
    period: newPeriod.period - plPeriod.period - krPeriod.period,
    previous: newPeriod.previous - plPeriod.previous - krPeriod.previous,
    newSigns: newPeriod.period,
    ...Object.fromEntries(netKeys.map((k) => [k, newSigns[k] - plNB[k] - krNB[k]])),
  }
  backlog.delta = backlog.period - backlog.previous

  const billboards = snapshotSplit(snapshot, (r) => r.bucket === 'billboard')

  // Trend
  const quarters = [...new Set(trendRows.map((r) => r.quarter))].sort()
  const seriesFor = (type) => quarters.map((q) => sum(trendRows, (r) => r.quarter === q && r.report_type === type))
  const trend = {
    quarters,
    plundered: seriesFor('plundered'),
    krakened: seriesFor('krakened'),
    questionable: seriesFor('questionable'),
    newSigns: seriesFor('first_sighting'),
    backlog: seriesFor('backlog_end'),
  }

  // Per-state table
  const stateKeys = [...new Set([...snapshot.map((r) => r.state), ...activity.map((r) => r.state)].filter((s) => s != null))].sort()
  const states = stateKeys.map((st) => {
    const snap = (bucket) => sum(snapshot, (r) => r.state === st && r.bucket === bucket)
    const per = (type) => sum(activity, (r) => r.window === 'period' && r.state === st && r.report_type === type)
    const row = {
      state: st,
      sighting: snap('sighting'), plundered: snap('plundered'), krakened: snap('krakened'),
      questionable: snap('questionable'), billboard: snap('billboard'),
      periodNew: per('first_sighting'), periodPlundered: per('plundered'), periodKrakened: per('krakened'), periodQuestionable: per('questionable'),
    }
    row.total = row.sighting + row.plundered + row.krakened + row.questionable + row.billboard
    return row
  }).sort((a, b) => b.total - a.total)

  // Leaderboard (period window)
  const byUser = new Map()
  for (const r of memberRows) {
    if (r.window !== 'period' || !r.username) continue
    const m = byUser.get(r.username) || { username: r.username, sighting: 0, plundered: 0, krakened: 0, questionable: 0, total: 0 }
    if (r.report_type in m) m[r.report_type] += r.n
    m.total += r.n
    byUser.set(r.username, m)
  }
  const members = [...byUser.values()].sort((a, b) => b.plundered - a.plundered || b.total - a.total)

  return {
    period: stats?.period || null,
    previous: stats?.previous || null,
    tracked: { total: trackedNow, previousTotal: trackedPrev, added: added.period, addedPrevious: added.previous, pct: pct(trackedNow, trackedPrev) },
    plundered, krakened, questionable, sightings, backlog, billboards,
    trend, states, members,
  }
}
