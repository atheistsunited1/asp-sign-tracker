import { computed, ref } from 'vue'
import { normalizeRole, isModeratorRole } from '@/shared/auth/roles'
import { profilesRepo } from '@/shared/data/repos/profilesRepo'
import { getSession as getAuthSession, onAuthStateChange, signOut } from '@/shared/auth/authService'

const user = ref(null)
const userRole = ref('guest')
const userProfile = ref(null)
const pendingSignup = ref(null)
const dbOffline = ref(false)

const isAdmin = computed(() => userRole.value === 'admin')
const canModerate = computed(() => isModeratorRole(userRole.value))

function clearAuthState() {
  user.value = null
  userRole.value = 'guest'
  userProfile.value = null
  pendingSignup.value = null
}

function setDbOfflineFlag(err) {
  const msg = `${err?.message || ''} ${err?.name || ''}`.toLowerCase()
  if (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network error') ||
    msg.includes('fetch') ||
    msg.includes('typeerror')
  ) {
    dbOffline.value = true
    return true
  }
  return false
}

async function loadProfile() {
  if (!user.value?.id) {
    clearAuthState()
    return null
  }

  // email and zip are not client-selectable columns (DB patch 000004 withholds
  // them from the authenticated role) — selecting them fails the whole query
  // with a column permission error and every user degrades to guest. Email
  // comes from the auth session instead; zip is not needed here.
  const { data, error } = await profilesRepo
    .selectById(user.value.id, 'role, username, initials, is_approved, approved_at, created_at')

  if (error) {
    userProfile.value = null
    setDbOfflineFlag(error)
    return null
  }

  dbOffline.value = false

  if (!data) {
    userRole.value = 'guest'
    userProfile.value = null
    pendingSignup.value = null
    return null
  }

  const role = normalizeRole(data.role)
  userProfile.value = { ...data, role }

  if (!data.is_approved) {
    // Unapproved accounts cannot hold a session at all: end it immediately.
    // The email is captured first (signOut's SIGNED_OUT handler clears state),
    // and pendingSignup is set afterwards so the banner explains the sign-out.
    const email = user.value?.email || null
    await signOut().catch(() => {})
    clearAuthState()
    pendingSignup.value = {
      username: data.username,
      initials: data.initials,
      zip: null,
      email,
    }
    return null
  }

  pendingSignup.value = null
  userRole.value = role
  return userProfile.value
}

async function bootstrapSession() {
  const { data: { session } } = await getAuthSession()
  user.value = session?.user || null
  if (!session?.user) {
    clearAuthState()
    return session
  }
  await loadProfile()
  return session
}

function subscribeAuth(onEvent) {
  const { data: { subscription } } = onAuthStateChange((event, session) => {
    user.value = session?.user || null

    if (event === 'SIGNED_OUT') {
      clearAuthState()
      onEvent?.(event, session)
      return
    }

    onEvent?.(event, session)
    if (!session?.user) return

    // Defer DB query outside callback to avoid deadlocks after AFK.
    setTimeout(() => { loadProfile().catch(() => {}) }, 0)
  })
  return () => {
    try { subscription?.unsubscribe() } catch {}
  }
}

export function useSessionStore() {
  return {
    user,
    userRole,
    userProfile,
    pendingSignup,
    dbOffline,
    isAdmin,
    canModerate,
    clearAuthState,
    setDbOfflineFlag,
    loadProfile,
    bootstrapSession,
    subscribeAuth,
  }
}
