import { supabase } from '@/shared/data/supabase'
import { profilesRepo } from '@/shared/data/repos/profilesRepo'
import { normalizeRole } from '@/shared/auth/roles'

export function getSession() {
  return supabase.auth.getSession()
}

export function refreshSession() {
  return supabase.auth.refreshSession()
}

export function onAuthStateChange(handler) {
  return supabase.auth.onAuthStateChange(handler)
}

export function signOut() {
  return supabase.auth.signOut()
}

export function signInWithPassword({ email, password }) {
  return supabase.auth.signInWithPassword({ email, password })
}

/** Username login via the login_with_username edge function: the username to
 *  email lookup happens server-side and is never disclosed (uniform errors);
 *  on success the returned tokens hydrate the client session. */
export async function signInWithUsername({ username, password }) {
  const { data, error } = await supabase.functions.invoke('login_with_username', {
    body: { username, password },
  })
  if (error || !data?.access_token || !data?.refresh_token) {
    return { data: null, error: new Error('Invalid email/username or password.') }
  }
  return supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  })
}

/** Magic-link email for an EXISTING account (never creates one). Used by the
 *  signup flow when the email already has an account — the Magic Link email
 *  template is dedicated to that "account already exists" message. */
export function sendExistingAccountLoginLink({ email, emailRedirectTo }) {
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo, shouldCreateUser: false },
  })
}

export function signUp({ email, password, data, emailRedirectTo }) {
  return supabase.auth.signUp({
    email,
    password,
    options: { data, emailRedirectTo },
  })
}

export function resetPasswordForEmail(email, { redirectTo }) {
  return supabase.auth.resetPasswordForEmail(email, { redirectTo })
}

export function getUser() {
  return supabase.auth.getUser()
}

export function updateUser(payload) {
  return supabase.auth.updateUser(payload)
}

export function updatePassword(password) {
  return supabase.auth.updateUser({ password })
}

export function isUsernameAvailable(username) {
  return profilesRepo.rpcUsernameAvailable(username)
}

export async function fetchProfileAccessByUserId(userId) {
  const { data, error } = await profilesRepo.selectById(userId, 'role, is_approved')
  if (error) return { data: null, error }
  if (!data) return { data: null, error: null }
  return {
    data: {
      role: normalizeRole(data.role),
      is_approved: !!data.is_approved,
    },
    error: null,
  }
}
