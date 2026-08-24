// Description lines → activities + pin description + gsv_date (plan #93 D4–D6).
//
// Line grammar (My Maps descriptions, observed over 12k placemarks):
//   Reported|Recorded MM/DD/YY by ASP (XX) [via GSV dated Mon YYYY | via … FB dated MM/DD/YY]
//   Reported MM/DD/YY and plundered|pillaged|removed by ASP (XX)! Huzzah!
//   Last checked|confirmed MM/DD/YY; Mon YYYY GSV.
//   Investigated MM/DD/YY …
//   Updated MM/DD/YY: …  |  MM/DD/YY: …     (sighting unless it says plundered/krakened)
//   Updated MM/DD/YY: Plundered [MM/DD/YY] by ASP (XX)! Huzzah!
//   … taken by the Kraken! | Krakened! | Huzzah for the Kraken!   (may sit in a description line)
//   Recidivist locale; last plundered MM/DD/YY.   (history note, not an activity)
//   everything else = physical description
//
// Deterministic: no line is ever rejected. Activities without a date get the
// latest MM/DD/YY found anywhere in the description; a terminal layer always
// ends with its terminal activity (synthesized if the text has none); only a
// pin with no date at all is flagged. Pure.
import { findDates, findMonths, maxIso } from '@/pages/kml-import/parser/text.js'

const LEAD_RE = /^(?:reported|recorded|investigated|last\s+(?:checked|confirmed)|updated?\b|\d{1,2}\/\d{1,2}\/\d{2,4}\s*:)/i
const NOT_A_SIGHTING_RE = /^reported\s+(?:to|it|this|them|that|the)\b/i     // "Reported to NYC311 …"
const SIGHTING_LEAD_RE = /^(?:reported|recorded)\b/i

// Activity lines talk about the event loosely ("plunder", "Krakening"); description
// lines only count with an unambiguous past-tense event, because they also carry
// asides like "5 days before plunder!" or "the Kraken (possibly …)".
const LEAD_PLUNDER_RE = /\b(?:plunder(?:ed|ing)?|pillaged|(?:removed|taken\s+down)\s+by\s+ASP)\b/i
const LEAD_KRAKEN_RE = /\bkraken(?:ed|ing)?\b/i
const DESC_PLUNDER_RE = /\b(?:plundered|pillaged|(?:removed|taken\s+down)\s+by\s+ASP)\b/i
const DESC_KRAKEN_RE = /\b(?:krakened|(?:taken|eaten|removed)\s+by\s+the\s+kraken|huzzah\s+for\s+the\s+kraken|kraken\s+(?:got|took|struck|strikes))\b/i

// History notes describe an earlier sign at the same spot, not this pin's event.
const HISTORY_PHRASE_RE = /\b(?:last|previously|previous|prior|earlier)\s+(?:the\s+)?(?:plunder\w*|pillag\w*|kraken\w*)/gi
const HISTORY_LINE_RE = /\b(?:recidivist|repeat\s+offender|a\s+similar\s+sign|same\s+location|site\s+of\s+a\s+previous)\b/i

const INITIALS_RE = /\bASP\s*\(\s*([A-Za-z&/]{1,10})\s*\)/i
const TERMINAL_DATE_RE = /(?:plunder\w*|pillaged|kraken\w*|removed\s+by\s+ASP)\s+(?:on\s+)?(\d{1,2}\/\d{1,2}\/\d{2,4})\b/i

const initialsIn = (s) => { const m = INITIALS_RE.exec(s || ''); return m ? m[1].toUpperCase() : null }
const terminalDateIn = (s) => { const m = TERMINAL_DATE_RE.exec(s || ''); return m ? findDates(m[1])[0] || null : null }

/** `{ kind, re }` for the terminal event a line records, or null. */
function terminalOf(line, isLead) {
  if (!isLead && HISTORY_LINE_RE.test(line)) return null
  const probe = line.replace(HISTORY_PHRASE_RE, '')
  const P = isLead ? LEAD_PLUNDER_RE : DESC_PLUNDER_RE
  const K = isLead ? LEAD_KRAKEN_RE : DESC_KRAKEN_RE
  if (P.test(probe)) return { kind: 'plundered', re: P, probe }
  if (K.test(probe)) return { kind: 'krakened', re: K, probe }
  return null
}

/**
 * @param {string[]} lines   cleaned description lines (see text.js toLines)
 * @param {object}   layer   { terminalType?: 'plundered'|'krakened', sightingType?: 'sighting'|'questionable' }
 * @returns {{ activities: Array<{type, occurredOn, initials, synthesized?, dateSynthesized?}>,
 *            description: string, gsvDate: string|null, latestDate: string|null, flags: string[] }}
 */
export function parseDescription(lines = [], layer = {}) {
  const sightingType = layer.sightingType || 'sighting'
  const terminalType = layer.terminalType || null
  const activities = []
  const description = []

  for (const line of lines) {
    const isLead = LEAD_RE.test(line) && !NOT_A_SIGHTING_RE.test(line)
    const term = terminalOf(line, isLead)
    const dates = findDates(line)

    if (isLead) {
      const leadDate = dates[0] || null
      if (!term) {
        activities.push({ type: sightingType, occurredOn: leadDate, initials: initialsIn(line) })
        continue
      }
      const idx = term.probe.search(term.re)
      const before = term.probe.slice(0, idx), after = term.probe.slice(idx)
      const withSighting = SIGHTING_LEAD_RE.test(line)
      if (withSighting) {
        activities.push({ type: sightingType, occurredOn: leadDate, initials: initialsIn(before) || initialsIn(after) })
      }
      activities.push({
        type: term.kind,
        occurredOn: terminalDateIn(after) || leadDate,
        initials: initialsIn(after) || (withSighting ? null : initialsIn(before)),
      })
      continue
    }

    description.push(line)
    if (term) {
      activities.push({ type: term.kind, occurredOn: terminalDateIn(term.probe) || dates[0] || null, initials: initialsIn(line) })
    }
  }

  const latestDate = maxIso(lines.flatMap(findDates))
  const gsvDate = maxIso(lines.flatMap(findMonths))

  for (const a of activities) {
    if (!a.occurredOn) { a.occurredOn = latestDate; a.dateSynthesized = true }
  }
  if (terminalType && !activities.some((a) => a.type === terminalType)) {
    activities.push({ type: terminalType, occurredOn: latestDate, initials: null, synthesized: true })
  }
  if (!activities.length) {
    activities.push({ type: sightingType, occurredOn: latestDate, initials: null, synthesized: true })
  }
  activities.sort((a, b) => String(a.occurredOn || '').localeCompare(String(b.occurredOn || '')))

  const flags = []
  if (activities.some((a) => !a.occurredOn)) flags.push('no-date')

  return { activities, description: description.join('\n'), gsvDate, latestDate, flags }
}
