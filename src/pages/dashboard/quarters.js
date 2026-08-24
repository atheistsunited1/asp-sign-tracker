// Calendar-quarter helpers for the dashboard period picker. Pure; dates are ISO
// 'YYYY-MM-DD' strings (no timezone maths — the domain date is a plain date).

const pad = (n) => String(n).padStart(2, '0')
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()   // m 1..12

/** 'YYYY-Qn' for an ISO date (or Date). */
export function quarterOf(date) {
  const d = typeof date === 'string' ? new Date(`${date.slice(0, 10)}T00:00:00Z`) : date
  const y = d.getUTCFullYear(), q = Math.floor(d.getUTCMonth() / 3) + 1
  return `${y}-Q${q}`
}

/** { from, to } ISO bounds of 'YYYY-Qn'. */
export function quarterRange(label) {
  const m = /^(\d{4})-Q([1-4])$/.exec(String(label || ''))
  if (!m) return null
  const y = Number(m[1]), q = Number(m[2])
  const m1 = (q - 1) * 3 + 1, m3 = m1 + 2
  return { from: iso(y, m1, 1), to: iso(y, m3, daysInMonth(y, m3)) }
}

/** 'YYYY-Qn' shifted by n quarters (negative = back). */
export function shiftQuarter(label, n) {
  const m = /^(\d{4})-Q([1-4])$/.exec(String(label || ''))
  if (!m) return null
  let idx = Number(m[1]) * 4 + (Number(m[2]) - 1) + n
  return `${Math.floor(idx / 4)}-Q${(idx % 4) + 1}`
}

/** The `n` quarter labels ending at `endLabel` (inclusive), oldest first. */
export function lastQuarters(endLabel, n = 8) {
  const out = []
  for (let i = n - 1; i >= 0; i--) out.push(shiftQuarter(endLabel, -i))
  return out
}

/** Number of days in an inclusive ISO range. */
export function daysBetween(from, to) {
  const a = Date.UTC(...from.split('-').map(Number).map((v, i) => (i === 1 ? v - 1 : v)))
  const b = Date.UTC(...to.split('-').map(Number).map((v, i) => (i === 1 ? v - 1 : v)))
  return Math.round((b - a) / 86400000) + 1
}

/** The window of equal length immediately before [from, to]. */
export function previousWindow(from, to) {
  const len = daysBetween(from, to)
  const toD = new Date(`${from}T00:00:00Z`); toD.setUTCDate(toD.getUTCDate() - 1)
  const fromD = new Date(toD); fromD.setUTCDate(fromD.getUTCDate() - len + 1)
  return { from: fromD.toISOString().slice(0, 10), to: toD.toISOString().slice(0, 10) }
}

/** Human label for a period: the quarter name when it is exactly a quarter, else the range. */
export function periodLabel(from, to) {
  const q = quarterOf(from)
  const r = quarterRange(q)
  if (r && r.from === from && r.to === to) return q
  return `${from} → ${to}`
}

export const todayIso = () => new Date().toISOString().slice(0, 10)
