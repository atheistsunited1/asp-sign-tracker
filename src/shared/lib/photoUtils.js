// src/utils/photoUtils.js
// Reusable client-side validation + compression for images

import imageCompression from 'browser-image-compression'

/** Allow only image types we can safely re-encode. HEIC/HEIF will be converted to JPEG. */
export const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

/** Reject obviously huge inputs to avoid memory spikes in the browser (15 MB default). */
export const DEFAULT_MAX_INPUT_BYTES = 50 * 1024 * 1024

/** Default compression target: ~50 KB & 800px long-edge */
export const DEFAULT_COMPRESSION = {
  maxSizeMB: 0.200,          // target size (may be higher for complex images)
  maxWidthOrHeight: 800,    // cap long edge
  initialQuality: 0.6,      // start lower to help reach target
  maxIteration: 20,         // allow more passes
  fileType: 'image/jpeg',   // force re-encode to JPEG (strips EXIF & normalizes)
  useWebWorker: true,
}

/** Basic filename sanitizer (keeps extension). */
export function sanitizeFileName(name = 'photo.jpg') {
  const dot = name.lastIndexOf('.')
  const base = (dot >= 0 ? name.slice(0, dot) : name).replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80) || 'photo'
  const ext  = (dot >= 0 ? name.slice(dot) : '.jpg').toLowerCase()
  return base + ext
}

/**
 * Bake a user-chosen rotation (90° steps, clockwise) into the image pixels.
 * createImageBitmap applies EXIF orientation first, so the result matches what
 * the browser displayed plus the requested rotation. Re-encodes to JPEG at
 * high quality; run before compression so the final encode stays single-pass
 * at the compressor's own quality.
 */
export async function rotateImageFile(file, degrees, { quality = 0.92 } = {}) {
  const deg = ((Math.round(degrees / 90) * 90) % 360 + 360) % 360
  if (!deg) return file
  const bmp = await createImageBitmap(file)
  const swap = deg === 90 || deg === 270
  const canvas = document.createElement('canvas')
  canvas.width = swap ? bmp.height : bmp.width
  canvas.height = swap ? bmp.width : bmp.height
  const ctx = canvas.getContext('2d')
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((deg * Math.PI) / 180)
  ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2)
  bmp.close?.()
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('rotate_encode_failed'))), 'image/jpeg', quality)
  )
  const name = sanitizeFileName((file.name || 'photo.jpg').replace(/\.(heic|heif|png|webp)$/i, '.jpg'))
  return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() })
}

/** Quick safety gate: type allowlist + size cap. */
export function isSafeImageFile(file, maxBytes = DEFAULT_MAX_INPUT_BYTES) {
  if (!(file instanceof File)) return { ok: false, reason: 'not_a_file' }
  if (!ALLOWED_TYPES.has(file.type)) return { ok: false, reason: 'disallowed_type' }
  if (file.size > maxBytes) return { ok: false, reason: 'too_large' }
  return { ok: true }
}

/**
 * Validate & compress a single file.
 * Returns { ok, file?: File, reason?: string, error?: any }
 */
export async function validateAndCompress(
  file,
  {
    maxInputBytes = DEFAULT_MAX_INPUT_BYTES,
    compression   = DEFAULT_COMPRESSION,
    forceJpeg     = true, // always re-encode → strips EXIF & normalizes format
  } = {}
) {
  const safe = isSafeImageFile(file, maxInputBytes)
  if (!safe.ok) return { ok: false, reason: safe.reason }

  try {
    const opts = { ...DEFAULT_COMPRESSION, ...(compression || {}) }
    if (forceJpeg) opts.fileType = 'image/jpeg'

    const blob = await imageCompression(file, opts)

    // Wrap the Blob back into a File so downstream callers can use .name/.type
    const name = sanitizeFileName(file.name.replace(/\.(heic|heif|png|webp)$/i, '.jpg'))
    const out  = new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() })

    return { ok: true, file: out }
  } catch (error) {
    return { ok: false, reason: 'compress_failed', error }
  }
}

/**
 * Batch: returns { okFiles: File[], rejected: Array<{name, reason}>, failed: Array<{name, reason}> }
 */
export async function compressPhotos(
  files,
  opts = {}
) {
  const okFiles = []
  const rejected = []
  const failed = []

  for (const f of files || []) {
    const res = await validateAndCompress(f, opts)
    if (res.ok && res.file) okFiles.push(res.file)
    else if (res.reason === 'disallowed_type' || res.reason === 'too_large' || res.reason === 'not_a_file') {
      rejected.push({ name: f?.name || 'unknown', reason: res.reason })
    } else {
      failed.push({ name: f?.name || 'unknown', reason: res.reason || 'compress_failed' })
    }
  }

  return { okFiles, rejected, failed }
}
