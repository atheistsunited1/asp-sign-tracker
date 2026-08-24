// Discord notifications for new activity submissions: message text, US-state
// normalisation (webhooks are per state) and the fire-and-forget edge-function
// call. Used by the report form and bulk photos.
import { supabase } from '@/shared/data/supabase'
import { appCoordLink } from '@/shared/lib/links'
import { reverseGeocodePlace } from '@/shared/domain/geocode'
import { withTimeout } from '@/shared/lib/withTimeout'
import { logger } from '@/shared/lib/logger'

export function normalizeUSState(s) {
  if (!s) return ''
  const x = String(s).trim().toUpperCase()
  if (/^[A-Z]{2}$/.test(x)) return x
  const FULL_TO_USPS = {
    'ALABAMA':'AL','ALASKA':'AK','ARIZONA':'AZ','ARKANSAS':'AR','CALIFORNIA':'CA','COLORADO':'CO',
    'CONNECTICUT':'CT','DELAWARE':'DE','DISTRICT OF COLUMBIA':'DC','WASHINGTON DC':'DC','DC':'DC',
    'FLORIDA':'FL','GEORGIA':'GA','HAWAII':'HI','IDAHO':'ID','ILLINOIS':'IL','INDIANA':'IN',
    'IOWA':'IA','KANSAS':'KS','KENTUCKY':'KY','LOUISIANA':'LA','MAINE':'ME','MARYLAND':'MD',
    'MASSACHUSETTS':'MA','MICHIGAN':'MI','MINNESOTA':'MN','MISSISSIPPI':'MS','MISSOURI':'MO',
    'MONTANA':'MT','NEBRASKA':'NE','NEVADA':'NV','NEW HAMPSHIRE':'NH','NEW JERSEY':'NJ',
    'NEW MEXICO':'NM','NEW YORK':'NY','NORTH CAROLINA':'NC','NORTH DAKOTA':'ND','OHIO':'OH',
    'OKLAHOMA':'OK','OREGON':'OR','PENNSYLVANIA':'PA','RHODE ISLAND':'RI','SOUTH CAROLINA':'SC',
    'SOUTH DAKOTA':'SD','TENNESSEE':'TN','TEXAS':'TX','UTAH':'UT','VERMONT':'VT','VIRGINIA':'VA',
    'WASHINGTON':'WA','WEST VIRGINIA':'WV','WISCONSIN':'WI','WYOMING':'WY'
  }
  return FULL_TO_USPS[x] || ''
}

const NOTIFY_TYPE_META = {
  plundered:    { emoji: '🛠️', label: 'Plundered' },
  krakened:     { emoji: '🐙', label: 'Krakened' },
  questionable: { emoji: '⚖️', label: 'Questionable legality' },
  sighting:     { emoji: '🔎', label: 'Sighting' },
}

/** Notification body for a submission. */
export function buildReportNotificationMessage({
  isExistingPin = false, reportType, place = null, signType = '', signText = '',
  locationDescription = '', submitterName = 'anonymous', lat, lng,
}) {
  const meta = NOTIFY_TYPE_META[reportType] || NOTIFY_TYPE_META.sighting
  const header = `${isExistingPin ? '' : '🆕 - '} ${meta.emoji}${meta.label}${place ? ` (${place})` : ''}`
  const link = (Number.isFinite(lat) && Number.isFinite(lng)) ? `${appCoordLink(lat, lng, 19)}` : null
  const locDesc = String(locationDescription || '').trim()
  // single Type/Text line ->  <type> - "<text>"
  const typeTextLine = (signType || signText)
    ? `${signType ? `${signType}` : ''}${(signType && signText) ? ' - ' : ''}${signText ? `"${signText}"` : ''}`
    : null
  return [header, typeTextLine, locDesc ? `Description: ${locDesc}` : null, `By: ${submitterName}`, link]
    .filter(Boolean).join('\n')
}

export function notifyDiscord({ text, photos = [], state = null }) {
  return supabase.functions.invoke('notify_discord', { body: { text, photos, state } })
}

/**
 * Region code for channel routing: US state (2-letter), 'ON' for Ontario,
 * 'NZ' for New Zealand, '' when unmatched (→ the #uncharted-waters default).
 */
export function regionForNotification(state = '', country = '') {
  const us = normalizeUSState(state)   // also passes through any 2-letter code (e.g. ON)
  if (us) return us
  const c = String(country || '').trim().toUpperCase()
  const s = String(state || '').trim().toUpperCase()
  if (c === 'NZ') return 'NZ'
  if (s === 'ONTARIO' || (c === 'CA' && s.startsWith('ONT'))) return 'ON'
  return ''
}

/**
 * Fire-and-forget notification for a submission. Reverse-geocodes a place
 * label (5 s), derives the region code and posts to Discord. Never throws.
 */
export async function notifySubmission({
  isExistingPin, reportType, signType = '', signText = '', locationDescription = '',
  submitterName = 'anonymous', lat, lng, state = '', country = '', photoUrls = [], source = 'submission',
}) {
  try {
    const place = await withTimeout(reverseGeocodePlace(lat, lng), 5000, 'notify:revgeo')
    const text = buildReportNotificationMessage({ isExistingPin, reportType, place, signType, signText, locationDescription, submitterName, lat, lng })
    const payload = { text, photos: (photoUrls || []).slice(0, 4), state: regionForNotification(state, country) }
    notifyDiscord(payload).catch((e) => logger.warn(`${source} Discord notify failed (non-blocking)`, e))
  } catch (e) {
    logger.warn(`${source} notify payload build failed (non-blocking)`, e)
  }
}
