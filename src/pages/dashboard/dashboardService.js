import { supabase } from '@/shared/data/supabase'

/** dashboard_stats(p_from, p_to) — moderator-gated aggregates (DB patch 000007). */
export async function fetchDashboardStats({ from, to }) {
  const { data, error } = await supabase.rpc('dashboard_stats', { p_from: from, p_to: to })
  if (error) throw error
  return data
}
