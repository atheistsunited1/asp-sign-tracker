import { supabase } from '@/shared/data/supabase'

/**
 * export_pins(...) — mapmaster/admin-gated export dataset (DB patch 000007):
 * `[{ pin, activities[], photos[] }]` for approved pins matching the filters.
 */
export async function fetchExportPins({ buckets = null, major = 'all', state = null, from = null, to = null } = {}) {
  const { data, error } = await supabase.rpc('export_pins', {
    p_buckets: buckets && buckets.length ? buckets : null,
    p_major: major || 'all',
    p_state: state || null,
    p_from: from || null,
    p_to: to || null,
  })
  if (error) throw error
  return Array.isArray(data) ? data : []
}
