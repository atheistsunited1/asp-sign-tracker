import { supabase } from '@/shared/data/supabase'

const table = () => supabase.from('photos')

export const photosRepo = {
  /** Photos of approved reports of approved pins (SECURITY DEFINER RPC, guest-safe). */
  rpcPublicPhotosForReports(reportIds = []) {
    return supabase.rpc('public_photos_for_reports', { p_report_ids: reportIds })
  },
  table,
  insert(rows) {
    return table().insert(rows)
  },
  /** Insert rows, optionally abortable; chain `.select(...)` to get the inserted rows back. */
  insertRows(rows, signal) {
    let q = table().insert(rows)
    if (signal) q = q.abortSignal(signal)
    return q
  },
  /** `id, image_url` rows of one report, optionally ordered by created_at. */
  listByReportId(reportId, { ascending = null } = {}) {
    let q = table().select('id, image_url').eq('report_id', reportId)
    if (ascending === true || ascending === false) q = q.order('created_at', { ascending })
    return q
  },
  deleteByReportId(reportId) {
    return table().delete().eq('report_id', reportId)
  },
  deleteById(id) {
    return table().delete().eq('id', id)
  },
  selectByReportId(reportId, columns = 'id,image_url') {
    return table().select(columns).eq('report_id', reportId)
  },
}
