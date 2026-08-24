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
  rpcEmailInUse(email) {
    return supabase.rpc('email_in_use', { e: email })
  },
  rpcAdminListProfiles(pendingOnly = false) {
    return supabase.rpc('admin_list_profiles', { pending_only: pendingOnly })
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
