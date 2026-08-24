// Nearby-pin queries shared by the map, the report form and bulk photo reports
// (dedupe against existing pins; enrich candidates with their latest activity
// and photos). Moved here in #97 step 0 because three pages needed it.
import { pinsRepo } from '@/shared/data/repos/pinsRepo'
import { reportsRepo } from '@/shared/data/repos/reportsRepo'
import { photosRepo } from '@/shared/data/repos/photosRepo'
import { findNearbyPins } from '@/shared/domain/pinUtils'
import { withTimeout } from '@/shared/lib/withTimeout'
import { logger } from '@/shared/lib/logger'

/**
 * Nearby-pin check before a submission (report form, bulk photos): fresh
 * candidates within the box, then the precise radius filter. Never throws and
 * never blocks a submission — any failure resolves to [].
 */
export async function findNearbyPinsForSubmission(lat, lng, { radiusM = 20, timeoutMs = 4500, source = 'submission' } = {}) {
  try {
    const { data: candidates, error } = await withTimeout(fetchPinsNearCoords(lat, lng), timeoutMs, 'submit:nearbyFetch')
    if (error) return []
    const nearby = await withTimeout(findNearbyPins(lat, lng, candidates || [], radiusM), timeoutMs, 'submit:nearby')
    return Array.isArray(nearby) ? nearby : []
  } catch (e) {
    logger.warn(`${source} nearby lookup failed; continuing submission`, e)
    return []
  }
}

/**
 * Fetch candidate pins in a bounding box around the coords for the nearby-pin
 * check. The box is generous (~55 m lat); findNearbyPins applies the precise
 * radius filter.
 */
export function fetchPinsNearCoords(lat, lng, { latDelta = 0.0005, lngDelta = 0.001 } = {}) {
  return pinsRepo
    .table()
    .select('id,lat,lng,sign_text,sign_type,description,is_approved,is_major_campaign,friendly_id,state,icon_type')
    .eq('is_deleted', false)
    .gte('lat', lat - latDelta)
    .lte('lat', lat + latDelta)
    .gte('lng', lng - lngDelta)
    .lte('lng', lng + lngDelta)
    .limit(50)
}

export async function fetchNearbyPinsEnrichment(
  pinIds = [],
  { reportLimitPerPin = 5, photoLimitPerPin = 3 } = {},
) {
  const normalizedPinIds = Array.isArray(pinIds) ? pinIds.filter(Boolean) : []
  const latestReportByPin = new Map()
  const reportIdsByPin = new Map()
  const reportIdToPinId = new Map()
  const photosByPin = new Map()

  if (!normalizedPinIds.length) {
    return { latestReportByPin, photosByPin }
  }

  const { data: reports, error: reportsError } = await reportsRepo
    .table()
    .select('id, pin_id, report_type, occurred_on, created_at')
    .in('pin_id', normalizedPinIds)
    .eq('is_deleted', false)
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false })

  if (reportsError) throw reportsError

  for (const row of (reports || [])) {
    const pinId = row?.pin_id
    const reportId = row?.id
    if (!pinId || !reportId) continue

    reportIdToPinId.set(reportId, pinId)
    if (!latestReportByPin.has(pinId)) latestReportByPin.set(pinId, row)

    const list = reportIdsByPin.get(pinId) || []
    if (list.length < reportLimitPerPin) {
      list.push(reportId)
      reportIdsByPin.set(pinId, list)
    }
  }

  const reportIdsForPhotos = [...new Set(Array.from(reportIdsByPin.values()).flat())]
  if (!reportIdsForPhotos.length) {
    return { latestReportByPin, photosByPin }
  }

  const { data: photos, error: photosError } = await photosRepo
    .table()
    .select('image_url, report_id, created_at')
    .in('report_id', reportIdsForPhotos)
    .order('created_at', { ascending: false })

  if (photosError) throw photosError

  for (const photo of (photos || [])) {
    const pinId = reportIdToPinId.get(photo?.report_id)
    if (!pinId) continue
    const list = photosByPin.get(pinId) || []
    if (list.length < photoLimitPerPin) {
      list.push(photo)
      photosByPin.set(pinId, list)
    }
  }

  return { latestReportByPin, photosByPin }
}
