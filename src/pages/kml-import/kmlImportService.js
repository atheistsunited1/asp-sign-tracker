import { supabase } from '@/shared/data/supabase'
import { pinsRepo } from '@/shared/data/repos/pinsRepo'
import { profilesRepo } from '@/shared/data/repos/profilesRepo'
import { reportsRepo } from '@/shared/data/repos/reportsRepo'
import { photosRepo } from '@/shared/data/repos/photosRepo'

/**
 * Every existing pin as `{ sign_text, lat, lng }` (paged) — the importer turns
 * these into duplicate keys so re-uploading a file never double-imports.
 */
export async function loadExistingPinRows({ pageSize = 1000 } = {}) {
  const out = []
  let from = 0
  for (;;) {
    const to = from + pageSize - 1
    const { data, error } = await pinsRepo
      .selectPage({ columns: 'id, sign_text, lat, lng', from, to, count: 'exact' })
      .order('id', { ascending: true })
    if (error) throw error
    if (!data?.length) break
    out.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return out
}

/** initials (upper-case) → profiles.id for the initials that have a member. */
export async function fetchProfilesByInitials(initialsSet) {
  const initials = Array.from(initialsSet || []).filter(Boolean)
  if (!initials.length) return new Map()

  const { data, error } = await profilesRepo.selectByInitials(initials)
  if (error) return new Map()

  const out = new Map()
  for (const row of data || []) {
    const key = String(row?.initials || '').toUpperCase()
    if (key) out.set(key, row?.id || null)
  }
  return out
}

export function insertPins(rows) {
  return pinsRepo.insert(rows)
}

export function insertReports(rows) {
  return reportsRepo.insert(rows)
}

export function insertPhotoRecord(row) {
  return photosRepo.insert(row)
}

/** mirror-photo is a plain fetch → store proxy: it uploads the bytes at `url` to `path` unchanged. */
export function invokeMirrorPhoto({ url, path, bucket }) {
  return supabase.functions.invoke('mirror-photo', { body: { url, path, bucket } })
}

export function listPhotoBucket(bucket, { path = '', limit = 1 } = {}) {
  return supabase.storage.from(bucket).list(path, { limit })
}
