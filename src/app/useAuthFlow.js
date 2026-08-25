// App-shell auth flow: login / reset-password modals, the recovery-link URL,
// logout, and the auth-state subscription (password updated → close modal;
// server-side sign-out → explain it). Session state itself is useSessionStore.
import { ref } from 'vue'
import { errorToUserMessage } from '@/shared/lib/errors'
import { refreshSession as refreshAuthSession, resetPasswordForEmail, signOut } from '@/shared/auth/authService'

/**
 * @param {object} deps
 * @param {ReturnType<import('@/shared/auth/sessionStore').useSessionStore>} deps.sessionStore
 * @param {Function} deps.showToast  @param {Function} deps.log
 * @param {Function} deps.onLoggedOut        called after a user-initiated logout succeeded (close the account tray)
 * @param {Function} deps.onServerSignOut   called when a session ends without the user clicking Log out (close trays)
 */
export function useAuthFlow({ sessionStore, showToast, log, onLoggedOut, onServerSignOut }) {
  const { user, pendingSignup } = sessionStore
  const loginOpen = ref(false)
  const authStartMode = ref('login')
  const resetOpen = ref(false)
  // Distinguishes a click on "Log out" from a server-side session end (inactivity
  // timeout, revoked token) so the latter can be explained to the user.
  let userInitiatedLogout = false
  let stopAuthSub = null

  async function doLogout() {
    userInitiatedLogout = true
    try {
      await signOut()
      try { onLoggedOut?.() } catch {}
      try { showToast('Signed out', 'success') } catch {}
    } catch (e) {
      userInitiatedLogout = false
      showToast(errorToUserMessage(e, 'Logout failed. Please try again.'), 'error')
    }
  }

  function recoveryRedirectUrl() {
    const u = new URL(window.location.origin)
    u.searchParams.set('recovery', '1')
    return u.toString()
  }

  /* forgot/reset from account tray (for pending users) */
  async function sendReset() {
    const email = pendingSignup.value?.email || user.value?.email
    if (!email) {
      showToast('No email on file.', 'error')
      return
    }
    const { error } = await resetPasswordForEmail(email, { redirectTo: recoveryRedirectUrl() })
    if (error) showToast(errorToUserMessage(error, 'Could not send reset link.'), 'error')
    else showToast('Reset link sent.', 'success')
  }

  function maybeOpenResetFromUrl() {
    try {
      const url = new URL(window.location.href)
      const fromQuery = url.searchParams.has('recovery')
      const fromHash = (url.hash || '').includes('type=recovery')
      if (fromQuery || fromHash) {
        resetOpen.value = true
        // clean query/hash from the URL bar
        url.searchParams.delete('recovery')
        history.replaceState({}, '', url.pathname + url.search)
      }
    } catch {}
  }

  /** Call once the app is mounted: refresh-on-focus, recovery-link detection, session bootstrap, auth subscription. */
  async function start() {
    let lastVisKick = 0
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastVisKick < 1500) return // skip if we just refreshed
      lastVisKick = now
      setTimeout(() => { refreshAuthSession().catch(() => {}) }, 200)
    })

    // open modal if arriving from recovery link (query or hash)
    maybeOpenResetFromUrl()
    const session = await sessionStore.bootstrapSession()
    log('auth.getSession()', { hasUser: !!session?.user })

    stopAuthSub = sessionStore.subscribeAuth((_event, session) => {
      log('onAuthStateChange', { event: _event, hasUser: !!session?.user })

      // When password is successfully changed, Supabase emits a user update.
      // Handle it here to guarantee the toast shows (root is stable across rerenders).
      if (_event === 'USER_UPDATED' || _event === 'TOKEN_REFRESHED') {
        // Some Supabase setups emit USER_UPDATED, others just refresh the token immediately after.
        // Either way, if we were in recovery flow, treat this as success.
        if (resetOpen.value) {
          try { showToast('✅ Password updated successfully', 'success') } catch {}
          resetOpen.value = false
          log('Handled password change at root, closed modal.')
        }
      }

      if (_event === 'PASSWORD_RECOVERY') {
        resetOpen.value = true
        return
      }
      if (_event === 'SIGNED_OUT') {
        log('user signed out → downgraded to guest', { userInitiated: userInitiatedLogout })
        // A session ended by the server (inactivity timeout, revoked/rotated token)
        // must be visible: close member-only trays and say why the UI is now guest.
        if (!userInitiatedLogout) {
          try { onServerSignOut?.() } catch {}
          try { showToast('Signed out after 1 hour of inactivity. Log in to continue.', 'info', 8000) } catch {}
        }
        userInitiatedLogout = false
        return
      }
    })

    // close modal after successful update from inside the component (it already toasted)
    window.addEventListener('password:updated', () => { resetOpen.value = false })
  }

  function stop() {
    try { stopAuthSub?.() } catch {}
  }

  return { loginOpen, authStartMode, resetOpen, doLogout, sendReset, start, stop }
}
