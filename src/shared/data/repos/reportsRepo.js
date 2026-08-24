import { supabase } from '@/shared/data/supabase'

const table = () => supabase.from('reports')

export const reportsRepo = {
  /** Approved reports of approved pins (SECURITY DEFINER RPC, guest-safe). */
  rpcPublicReportsForPins(pinIds = []) {
    return supabase.rpc('public_reports_for_pins', { p_pin_ids: pinIds })
  },
  table,
  insert(rows) {
    return table().insert(rows)
  },
  updateById(id, payload) {
    return table().update(payload).eq('id', id)
  },
  selectByPinId(pinId, columns = '*') {
    return table().select(columns).eq('pin_id', pinId)
  },
}

