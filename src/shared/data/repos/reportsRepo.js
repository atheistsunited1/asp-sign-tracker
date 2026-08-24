import { supabase } from '@/shared/data/supabase'

const table = () => supabase.from('reports')

export const reportsRepo = {
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

