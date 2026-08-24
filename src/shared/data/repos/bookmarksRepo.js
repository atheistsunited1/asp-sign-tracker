import { supabase } from '@/shared/data/supabase'

const table = () => supabase.from('bookmarks')

export const bookmarksRepo = {
  table,
  selectByUser(userId, columns = 'pin_id,created_at') {
    return table()
      .select(columns)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
  },
  upsertByUserPin(userId, pinId) {
    return table()
      .upsert({ user_id: userId, pin_id: pinId }, { onConflict: 'user_id,pin_id' })
      .select('pin_id')
      .maybeSingle()
  },
  deleteByUserPin(userId, pinId) {
    return table()
      .delete()
      .eq('user_id', userId)
      .eq('pin_id', pinId)
  },
}
