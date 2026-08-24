import { supabase } from '@/shared/data/supabase'

const table = () => supabase.from('app_logs')

export const appLogsRepo = {
  table,
  insert(rows) {
    return table().insert(rows)
  },
}
