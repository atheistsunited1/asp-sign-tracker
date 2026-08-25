import { supabase } from '@/shared/data/supabase'

const table = () => supabase.from('profiles')

export const profilesRepo = {
  table,
  selectById(id, columns = '*') {
    return table().select(columns).eq('id', id).maybeSingle()
  },
  selectByIds(ids = [], columns = '*') {
    return table().select(columns).in('id', ids)
  },
  // email/zip are not client-readable columns and anon cannot read profiles at
  // all (DB patch 000004) — lookups that need them go through SECURITY DEFINER
  // RPCs instead of direct selects.
  rpcUsernameAvailable(username) {
    return supabase.rpc('username_available', { u: username })
  },
  rpcAdminListProfiles(pendingOnly = false) {
    return supabase.rpc('admin_list_profiles', { pending_only: pendingOnly })
  },
  /** Deletes the profile AND the auth account (SECURITY DEFINER, admin-gated). */
  rpcAdminDeleteUser(id) {
    return supabase.rpc('admin_delete_user', { p_user_id: id })
  },
  selectByInitials(initials = []) {
    return table().select('id, initials').in('initials', initials)
  },

  updateById(id, payload) {
    return table().update(payload).eq('id', id)
  },
  deleteById(id) {
    return table().delete().eq('id', id)
  },
}
