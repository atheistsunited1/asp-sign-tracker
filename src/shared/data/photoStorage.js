// The one place the app talks to the photo bucket. Every writer (ReportForm,
// BulkPhotoReports, Reports add-photo, KML mirror) builds keys with buildPhotoKey()
// and stores the resulting public URL in photos.image_url; cleanup turns URLs
// back into keys with keyFromPublicUrl().
import { supabase } from '@/shared/data/supabase'
import { PHOTO_BUCKET, buildPhotoKey, keyFromPublicUrl, extForMime, newPhotoId } from '@/shared/data/photoKeys'

export { PHOTO_BUCKET, buildPhotoKey, keyFromPublicUrl, extForMime, newPhotoId }

const bucket = () => supabase.storage.from(PHOTO_BUCKET)

/** Public URL for a storage key (null if the client can't produce one). */
export function publicUrlForKey(key) {
  if (!key) return null
  const { data } = bucket().getPublicUrl(String(key))
  return data?.publicUrl || null
}

/** Normalize a photos.image_url value (URL or legacy key) to a public URL. */
export function toPublicUrl(urlOrKey) {
  const raw = String(urlOrKey || '').trim()
  if (!raw) return null
  if (/^https?:\/\//i.test(raw)) return raw
  return publicUrlForKey(raw)
}

/** Upload a file/blob at `key`. Never overwrites (keys carry a fresh photo id). */
export function uploadPhoto(key, file, { contentType, cacheControl = '31536000' } = {}) {
  return bucket().upload(key, file, {
    contentType: contentType || file?.type || 'image/jpeg',
    upsert: false,
    cacheControl,
  })
}

/** Remove storage objects by key. */
export function removePhotoKeys(keys = []) {
  const list = (Array.isArray(keys) ? keys : [keys]).map((k) => String(k || '').trim()).filter(Boolean)
  if (!list.length) return Promise.resolve({ data: [], error: null })
  return bucket().remove(list)
}

/** Remove storage objects given photos.image_url values (URLs or keys). */
export function removePhotosByUrl(urls = []) {
  return removePhotoKeys((Array.isArray(urls) ? urls : [urls]).map(keyFromPublicUrl).filter(Boolean))
}
