// My Maps exports link photos with `fife=s16383` — "largest rendition", which can
// be a 25 MB PNG that the mirror-photo edge function cannot decode within its
// memory/CPU budget, and our own re-encode wrecked colours. Google's image
// server resizes and JPEG-encodes far better than we can: `fife=s<px>-rj-l<q>`
// asks for an `<px>` long edge, JPEG output, quality `<q>` (≈100 KB at 800/75 — q60 blurred sign text),
// which mirror-photo then stores untouched.
const GOOGLE_IMAGE_HOST_RE = /(^|\.)(googleusercontent\.com|usercontent\.google\.com)$/i

export const MIRROR_MAX_EDGE = 800
export const MIRROR_JPEG_QUALITY = 75

/** Source URL to hand to mirror-photo: Google-hosted images as a small, ready-to-store JPEG. Pure. */
export function normalizeSourceUrl(url, { maxEdge = MIRROR_MAX_EDGE, quality = MIRROR_JPEG_QUALITY } = {}) {
  let u
  try { u = new URL(String(url)) } catch { return String(url || '') }
  if (!GOOGLE_IMAGE_HOST_RE.test(u.hostname)) return u.toString()
  u.searchParams.set('fife', `s${maxEdge}-rj-l${quality}`)
  return u.toString()
}
