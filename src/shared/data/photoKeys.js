// Pure helpers for photo object keys in the `sign-photos` bucket (no Supabase import,
// so they are unit-testable). One scheme for every writer:
//
//   {pin_id}/{report_id}/{photo_id}.{ext}
//
// Folders are only key prefixes; `photos.image_url` (a public URL) is the source of
// truth, and cleanup derives the key back from that URL with keyFromPublicUrl().

export const PHOTO_BUCKET = 'sign-photos'
export const PUBLIC_URL_TOKEN = `/storage/v1/object/public/${PHOTO_BUCKET}/`

const MIME_EXT = Object.freeze({
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/gif': 'gif',
})

/** File extension (no dot) for a MIME type; unknown/absent → 'jpg'. */
export function extForMime(mime = '') {
  return MIME_EXT[String(mime || '').toLowerCase()] || 'jpg'
}

/** A fresh photo id (uuid v4). */
export function newPhotoId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // last-resort fallback (tests / very old runtimes)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/**
 * Build the storage key for a photo. Throws if either owner id is missing —
 * a key without its owners would defeat the scheme.
 */
export function buildPhotoKey({ pinId, reportId, photoId = newPhotoId(), ext = 'jpg' } = {}) {
  const p = String(pinId || '').trim()
  const r = String(reportId || '').trim()
  if (!p || !r) throw new Error('buildPhotoKey: pinId and reportId are required')
  const e = String(ext || 'jpg').replace(/^\./, '').toLowerCase() || 'jpg'
  return `${p}/${r}/${String(photoId).trim()}.${e}`
}

/**
 * Storage key from a photos.image_url value. Accepts a public URL of this
 * bucket or an already-relative key; returns '' for anything else.
 */
export function keyFromPublicUrl(urlOrKey = '') {
  const raw = String(urlOrKey || '').trim()
  if (!raw) return ''
  if (!/^https?:\/\//i.test(raw)) return raw.replace(/^\/+/, '')
  const i = raw.indexOf(PUBLIC_URL_TOKEN)
  if (i === -1) return ''
  try { return decodeURIComponent(raw.slice(i + PUBLIC_URL_TOKEN.length)) } catch { return raw.slice(i + PUBLIC_URL_TOKEN.length) }
}

/** Parse a key back into its parts, or null if it doesn't follow the scheme. */
export function parsePhotoKey(key = '') {
  const m = /^([^/]+)\/([^/]+)\/([^/]+)\.([A-Za-z0-9]+)$/.exec(String(key || '').trim())
  if (!m) return null
  return { pinId: m[1], reportId: m[2], photoId: m[3], ext: m[4].toLowerCase() }
}
