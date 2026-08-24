import { supabase } from '@/shared/data/supabase'

const table = () => supabase.from('pins')

export const pinsRepo = {
  table,
  selectPage({ columns = '*', from = 0, to = 999, count = 'exact' } = {}) {
    return table().select(columns, { count }).range(from, to)
  },
  selectById(id, columns = '*') {
    return table().select(columns).eq('id', id).maybeSingle()
  },
  insert(rows) {
    return table().insert(rows)
  },
  upsert(rows, options = { onConflict: 'id' }) {
    return table().upsert(rows, options)
  },
  updateById(id, payload) {
    return table().update(payload).eq('id', id)
  },
}

