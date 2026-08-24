<!-- Login / signup / password-reset modal (email-only login, issue 142). -->
<template>
  <div class="modal-overlay" role="presentation">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      
      <div class="tabs">
        <button :class="{active: mode==='login'}" @click="mode='login'">Login</button>
        <button :class="{active: mode==='signup'}" @click="mode='signup'">Sign up</button>
        <button :class="{active: mode==='forgot'}" @click="mode='forgot'">Forgot</button>
      </div>

      <form v-if="mode==='login'" @submit.prevent="onLogin">
        <div class="field">
          <label>Email</label>
          <input v-model.trim="login.email" type="email" autocomplete="email" required autofocus />
        </div>
        <div class="field">
          <label>Password</label>
          <input v-model="login.password" type="password" autocomplete="current-password" required />
        </div>
        <div class="actions">
          <button class="primary" :disabled="busy">Sign in</button>
          <button type="button" @click="emit('close')">Close</button>
        </div>
      </form>

      <form v-else-if="mode==='signup'" @submit.prevent="onSignup">
        <div class="field">
          <label>Username</label>
          <div class="row">
            <input v-model.trim="signup.username" @input="availability=null" required autofocus />
            <button class="mini" type="button" @click="checkAvailability" :disabled="busy || !signup.username">Check</button>

          </div>
          <div v-if="availability!==null" class="hint" :class="{ok: availability, bad: availability===false}">
            {{ availability ? '✅ Available' : '❌ Taken' }}
          </div>
        </div>

        <div class="field">
          <label>Password</label>
          <input v-model="signup.password" type="password" autocomplete="new-password" required />
        </div>
        <div class="field">
          <label>Confirm Password</label>
          <input v-model="signup.password2" type="password" autocomplete="new-password" required />
        </div>

        <div class="field">
          <label>Email</label>
          <input v-model.trim="signup.email" type="email" autocomplete="email" required />
        </div>

        <div class="field">
          <label>ZIP (optional)</label>
          <input v-model.trim="signup.zip" inputmode="numeric" />
        </div>

        <div class="field">
          <label>Initials (shown on map)</label>
          <input v-model.trim="signup.initials" maxlength="6" />
        </div>

        <div class="actions">
          <button class="primary" :disabled="busy || availability===false">Create account</button>
          <button type="button" @click="emit('close')">Close</button>
        </div>

        <p class="small">
          Already have an account?
          <a href="#" @click.prevent="mode='login'">Login here</a>
        </p>
      </form>

      <form v-else @submit.prevent="onForgot">
        <div class="field">
          <label>Email</label>
          <input v-model.trim="forgot.email" type="email" required />
        </div>
        <div class="actions">
          <button class="primary" :disabled="busy">Send reset link</button>
          <button type="button" @click="emit('close')">Close</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { useToast } from '@/shared/ui/useToast'
import { validateUserPayload, validateUsername } from '@/shared/lib/validators'
import { errorToUserMessage } from '@/shared/lib/errors'
import {
  isEmailInUse,
  isUsernameAvailable,
  resetPasswordForEmail,
  signInWithOtp,
  signInWithPassword,
  signUp,
} from '@/shared/auth/authService'

const { show: showToast } = useToast()
const emit = defineEmits(['close'])
const props = defineProps({ startMode: { type: String, default: 'login' } })

const mode = ref(props.startMode)
watch(() => props.startMode, v => { mode.value = v })

const busy = ref(false)
const login = ref({ email: '', password: '' })
const signup = ref({ username: '', password: '', password2: '', email: '', zip: '', initials: '' })
const forgot = ref({ email: '' })
const availability = ref(null)
const GENERIC_ACCOUNT_EMAIL_NOTICE = 'If an account exists for that email, check your inbox for a sign-in or reset link.'

function onKeydown(e){ if (e.key === 'Escape' || e.key === 'Esc') emit('close') }
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

watch(mode, (m) => {
  if (m === 'forgot') {
    if (signup.value.email) forgot.value.email = signup.value.email
    else if (login.value.email) forgot.value.email = login.value.email
  }
})

async function checkAvailability () {
  availability.value = null
  const raw = signup.value.username?.trim()
  const uv = validateUsername(raw)
  if (!uv.ok) { showToast(uv.msg, 'error'); return }
  const u = uv.value
  if (!u) return

  const { data: available, error } = await isUsernameAvailable(u)

  if (error) { showToast(errorToUserMessage(error, 'Could not check username availability.'), 'error'); return }
  availability.value = available === true
}

async function onLogin () {
  busy.value = true
  try {
    // Email-only login: the username → email lookup RPC was an
    // anon-callable email-enumeration surface and is dropped (patch 000008).
    const email = login.value.email.trim()
    if (!email) { showToast('Invalid email or password.', 'error'); return }

    const { error: signErr } = await signInWithPassword({
      email, password: login.value.password
    })
    if (signErr) throw signErr
    emit('close')
  } catch (e) {
    showToast(errorToUserMessage(e, 'Login failed.'), 'error')
  } finally { busy.value = false }
}

function recoveryRedirectUrl () {
  const u = new URL(window.location.origin)
  u.searchParams.set('recovery', '1')
  return u.toString()
}

async function onSignup () {
  const s = signup.value
  if (!s.username || !s.password || !s.email) {
    showToast('Fill in username, password, and email.', 'error')
    return
  }
  if (s.password !== s.password2) {
    showToast('Passwords do not match.', 'error')
    return
  }

  const v = validateUserPayload({ username: s.username, email: s.email, initials: s.initials, zip: s.zip })
  if (!v.ok) {
    showToast(v.errors.join('\n'), 'error')
    return
  }
  const clean = v.value

  if (availability.value === null) await checkAvailability()
  if (availability.value === false) {
    showToast('Username is taken.', 'error')
    return
  }

  busy.value = true
  try {
    // PRE-FLIGHT: email already present in profiles?
    const { data: emailUsed, error: emailErr } = await isEmailInUse(clean.email)
    if (emailErr) throw emailErr

    if (emailUsed === true) {
      // Help them get in; no inserts
      const redirectTo = window.location.origin + '/'
      const otp = await signInWithOtp({ email: clean.email, emailRedirectTo: redirectTo })
      if (otp?.error) {
        const reset = await resetPasswordForEmail(clean.email, { redirectTo: recoveryRedirectUrl() })
        if (reset?.error) {
          showToast(GENERIC_ACCOUNT_EMAIL_NOTICE, 'info')
          mode.value = 'login'; return
        }
        showToast(GENERIC_ACCOUNT_EMAIL_NOTICE, 'success')
      } else {
        showToast(GENERIC_ACCOUNT_EMAIL_NOTICE, 'success')
      }
      mode.value = 'login'
      return
    }

    // New email → create auth user
    const { data, error } = await signUp({
      email: clean.email,
      password: s.password,
      data: { username: clean.username, initials: clean.initials, zip: clean.zip },
      emailRedirectTo: window.location.origin + '/',
    })
    if (error) throw error

    const userId = data?.user?.id
    if (!userId) {
      showToast('Could not create account.', 'error')
      return
    }

    // The pending profiles row is created server-side by the on_auth_user_created
    // trigger (DB patch 2) — signUp returns no session while the email is
    // unconfirmed, so the client cannot write it.
    showToast('Account created. Check your email to verify. Access is pending admin approval.', 'success')
    mode.value = 'login'
  } catch (e) {
    showToast(errorToUserMessage(e, 'Sign up failed.'), 'error')
  } finally { busy.value = false }
}

async function onForgot () {
  busy.value = true
  try {
    await resetPasswordForEmail(forgot.value.email, {
      redirectTo: recoveryRedirectUrl()
    })
    showToast('If an account exists for that email, a password reset link has been sent.', 'success')
  } catch {
    showToast('If an account exists for that email, a password reset link has been sent.', 'success')
  } finally { busy.value = false }
}
</script>

<style scoped>
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:grid;place-items:center;z-index:3500;padding:20px;}
.modal{width:min(480px,92vw);background:#242424;border:1px solid #333;border-radius:12px;padding:16px;color:#eee}
.tabs{display:flex;gap:6px;margin-bottom:10px}
.tabs button{flex:1;border:1px solid #3a3a3a;background:#303030;color:#eee;border-radius:8px;padding:8px}
.tabs .active{background:#1e90ff;border-color:#1e90ff;color:#fff}
.field{display:grid;gap:6px;margin-bottom:10px}
.row{display:flex;gap:6px}
.actions{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}
.primary{background:#1e90ff;border:1px solid #1e90ff;color:#fff;border-radius:8px;padding:8px 12px;cursor:pointer}
.mini{padding:6px 10px;border:1px solid #3a3a3a;background:#303030;color:#eee;border-radius:8px;cursor:pointer}
.hint{font-size:12px;opacity:.9}
.hint.ok{color:#b0ffb0}
.hint.bad{color:#ffb0b0}
.small{font-size:12px;opacity:.9}
input{padding:10px;border-radius:8px;border:1px solid #3a3a3a;background:#1f1f1f;color:#eee}
</style>
