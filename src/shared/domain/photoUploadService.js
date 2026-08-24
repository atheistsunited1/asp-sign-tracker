// The one photo pipeline for activity photos (report form, bulk photos,
// Reports add-photo): bake rotation → compress (photoUtils defaults) →
// key {pin}/{report}/{photo}.ext → upload (bounded, abortable) → public URL,
// then optionally the `photos` rows. Storage details stay in shared/data.
import { compressPhotos, rotateImageFile } from '@/shared/lib/photoUtils'
import { buildPhotoKey, extForMime, publicUrlForKey, uploadPhoto } from '@/shared/data/photoStorage'
import { withTimeout, raceWithAbort } from '@/shared/lib/withTimeout'
import { logger } from '@/shared/lib/logger'
import { attachPhotoUrls } from '@/shared/domain/activitySubmissionService'

export const UPLOAD_TIMEOUTS = Object.freeze({ compress: 15000, upload: 12000 })

function isAbort(err, signal) {
  return err?.name === 'AbortError' || !!signal?.aborted
}

/**
 * Upload staged photos for one report.
 * @param {object} p
 * @param {Array<{file: File, rotation?: number}>} p.items
 * @param {string} p.pinId  @param {string} p.reportId
 * @param {AbortSignal} [p.signal]          aborting rejects with an AbortError (partial uploads stay in storage)
 * @param {object} [p.compression]           photoUtils compression override (defaults otherwise)
 * @param {{compress?:number, upload?:number}} [p.timeouts]
 * @param {(event: string, details: object) => void} [p.onEvent]
 *        events: compress_failed · upload_failed · uploaded · public_url_missing · upload_aborted
 * @returns {Promise<{ urls: string[], keys: string[], rejected: Array, failed: Array }>}
 */
export async function uploadActivityPhotos({ items = [], pinId, reportId, signal, compression, timeouts = {}, onEvent } = {}) {
  const t = { ...UPLOAD_TIMEOUTS, ...timeouts }
  const emit = (event, details = {}) => { try { onEvent?.(event, details) } catch {} }

  // Bake user rotation into pixels; fall back to the original file if a rotate fails.
  const files = await Promise.all((items || []).map(async (p) => {
    if (!p?.rotation) return p.file
    try { return await rotateImageFile(p.file, p.rotation) }
    catch (e) { logger.warn('photo rotate failed; uploading unrotated', e); return p.file }
  }))
  if (!files.length) return { urls: [], keys: [], rejected: [], failed: [] }

  let okFiles = [], rejected = [], failed = []
  try {
    ({ okFiles, rejected, failed } = await withTimeout(
      compressPhotos(files, compression ? { compression } : {}),
      t.compress, 'upload:compress',
    ))
  } catch (e) {
    emit('compress_failed', { message: String(e?.message || e), count: files.length, timeout_ms: t.compress, aborted: !!signal?.aborted })
    okFiles = []
    failed = files.map((f) => ({ name: f?.name || 'unknown', reason: 'compress_failed' }))
  }

  const urls = [], keys = []
  for (const out of okFiles) {
    const mime = out.type || 'image/jpeg'
    const key = buildPhotoKey({ pinId, reportId, ext: extForMime(mime) })
    try {
      const { error } = await withTimeout(raceWithAbort(uploadPhoto(key, out, { contentType: mime }), signal), t.upload, `upload:${key}`)
      if (error) throw error
      const url = publicUrlForKey(key)
      if (!url) { emit('public_url_missing', { path: key }); failed.push({ name: out.name, reason: 'public_url_missing' }); continue }
      urls.push(url); keys.push(key)
      emit('uploaded', { path: key, url, size: out.size })
    } catch (err) {
      if (isAbort(err, signal)) { emit('upload_aborted', { path: key }); throw err }
      emit('upload_failed', { message: String(err?.message || err), path: key, size: out.size, type: mime, timeout_ms: t.upload })
      failed.push({ name: out.name, reason: 'upload_failed', error: err })
    }
  }
  return { urls, keys, rejected, failed }
}

/**
 * Upload and immediately attach the `photos` rows (the report already exists).
 * Resolves { urls, keys, rejected, failed, rows, attachError }.
 */
export async function uploadAndAttachPhotos(params) {
  const res = await uploadActivityPhotos(params)
  if (!res.urls.length) return { ...res, rows: [], attachError: null }
  const { data, error } = await attachPhotoUrls(params.reportId, res.urls, params.signal)
  return { ...res, rows: data || [], attachError: error || null }
}
