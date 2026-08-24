<template>
  <div class="container">
    <!-- Top Bar -->
    <header class="topbar">
      <button class="burger" @click="onMenuClick" aria-label="Open menu">☰</button>
      <router-link
        class="brand"
        :to="{ path: '/' }"
        aria-label="Go to Home"
        title="Home"
      >
        <img
          src="/skull_and_crossbones_favicon.png"
          alt=""
          aria-hidden="true"
          class="brand-logo"
        />
        <span class="brand-text">ASP Sign Tracker</span>
      </router-link>


      <div class="auth-right">
        <template v-if="!user">
          <button class="auth-button" @click="loginOpen = true">Login</button>
        </template>
        <template v-else>
          <button v-if="isHome && canToggleDebug" class="icon-btn" title="Settings" @click="settingsOpen = true">⚙️</button>
          <button class="icon-btn" title="Account" @click="accountOpen = true">👤</button>
        </template>
      </div>

    </header>
    <div v-if="pendingSignup" class="status-banner" role="status" aria-live="polite">
      Account pending admin approval. You can browse the map and will be able to log in once approved.
    </div>

    <!-- Offline banner -->
    <div v-if="dbOffline" class="status-banner error" role="status" aria-live="polite">
      Database currently offline, check again later.
    </div>


    <!-- Side Drawer -->
    <NavDrawer />
    <AccountTray />
    <SettingsTray />

    <!-- New Auth modal -->
    <AuthModal v-if="loginOpen" :startMode="authStartMode" @close="loginOpen=false" />
    <ResetPasswordModal v-if="resetOpen" @close="resetOpen=false" />

    <!-- Route outlet -->
    <router-view v-if="routeReady" />

  </div>
</template>

<script setup>
// App shell: top bar, banners, drawer + trays, auth modals, route outlet, and the
// session provides. Behaviour lives in useAuthFlow / useShellNav / useDebugSettings;
// the drawer and trays read them through APP_SHELL_CTX.
import { ref, provide, onMounted, onBeforeUnmount, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { scope } from '@/shared/lib/debug'
import { useToast } from '@/shared/ui/useToast'
import { useSessionStore } from '@/shared/auth/sessionStore'
import AuthModal from '@/shared/auth/AuthModal.vue'
import ResetPasswordModal from '@/shared/auth/ResetPasswordModal.vue'
import { APP_SHELL_CTX } from '@/app/shellContext'
import { useAuthFlow } from '@/app/useAuthFlow'
import { useShellNav } from '@/app/useShellNav'
import { useDebugSettings } from '@/app/useDebugSettings'
import NavDrawer from '@/app/components/NavDrawer.vue'
import AccountTray from '@/app/components/AccountTray.vue'
import SettingsTray from '@/app/components/SettingsTray.vue'

const log = scope('App')
const router = useRouter()
const route = useRoute()
const routeReady = ref(false)
const { show: showToast } = useToast()

/* --- app state --- */
const supabasePins = ref([])
const sessionStore = useSessionStore()
const { user, isAdmin, userRole, userProfile, canModerate, pendingSignup, dbOffline } = sessionStore
const canUseMapOps = computed(() => canModerate.value)
const isHome = computed(() => route.path === '/')

const nav = useShellNav({ router, user, isAdmin, canUseMapOps, showToast })
const auth = useAuthFlow({
  sessionStore, showToast, log,
  onLoggedOut: () => { nav.accountOpen.value = false },
  onServerSignOut: () => nav.closeAll(),
})
const debug = useDebugSettings({ isAdmin, showToast })
const { menuOpen, accountOpen, settingsOpen, onMenuClick } = nav
const { loginOpen, authStartMode, resetOpen } = auth
const { canToggleDebug } = debug

/* provide for children */
provide('supabasePins', supabasePins)
provide('user', user)
provide('isAdmin', isAdmin)
provide('userRole', userRole)
provide('userProfile', userProfile)
provide('canModerate', canModerate)
provide(APP_SHELL_CTX, { user, isAdmin, userRole, userProfile, pendingSignup, canUseMapOps, nav, auth, debug })

function installIOSZoomGuards() {
  const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (!isiOS) return

  // 1) Kill iOS pinch-zoom (page-level) — keeps top bar from leaving viewport
  const prevent = (e) => { try { e.preventDefault() } catch {} }
  document.addEventListener('gesturestart', prevent, { passive: false })
  document.addEventListener('gesturechange', prevent, { passive: false })
  document.addEventListener('gestureend', prevent, { passive: false })

  // 2) Stop iOS double-tap page zoom on any element (keeps buttons from zooming the page)
  let lastTouchEnd = 0
  document.addEventListener('touchend', (e) => {
    const now = Date.now()
    if (now - lastTouchEnd <= 300) {
      try { e.preventDefault() } catch {}
    }
    lastTouchEnd = now
  }, { passive: false })
}

/* mount */
onMounted(async () => {
  await router.isReady()
  routeReady.value = true
  log('mounted')
  installIOSZoomGuards()
  log(`route at mount: ${route.fullPath}`)
  window.addEventListener('pageshow', (e) => log(`pageshow (persisted=${!!e.persisted})`))
  window.addEventListener('pagehide', (e) => log(`pagehide (persisted=${!!e.persisted})`))
  window.addEventListener('online',  () => log('network: online'))
  window.addEventListener('offline', () => log('network: offline'))
  await auth.start()   // recovery link, session bootstrap, auth subscription
})
onBeforeUnmount(() => { auth.stop() })

// Router navigation logging
router.beforeEach((to, from) => {
  log(`router.beforeEach: ${from.fullPath} -> ${to.fullPath}`)
  return true
})
router.afterEach((to, from) => {
  log(`router.afterEach: ${from.fullPath} -> ${to.fullPath}`)
})

// Surface handler errors
window.addEventListener('error', (e) => log(`window.error: ${e.message}`))
window.addEventListener('unhandledrejection', (e) => log(`unhandledrejection: ${e.reason}`))
</script>

<style>
/* Global shell styles (not scoped): layout lock, top bar, banners, modals, touch-action guards. */
:root {
  --topbar-h: 56px; /* keep this in sync with .topbar height */
}

/* Global: lock the page to the viewport */
html, body, #app {
  height: 100%;
  overflow: hidden;     /* no vertical or horizontal scrolling */
}

body {
  font-family: 'Segoe UI', sans-serif;
  background: #1e1e1e;
  color: #eee;
  margin: 0;
  padding: 0;
}

.container { padding: calc(var(--topbar-h) + env(safe-area-inset-top, 0px)) 0 20px; }

/* --- top bar --- */
.topbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  box-sizing: border-box;   /* height now includes padding */

  display: flex;
  align-items: center;
  gap: 12px;
  height: var(--topbar-h);
  padding: 10px 14px;
  background: #222;
  border-bottom: 1px solid #333;
  z-index: 3000;
}

.burger {
  font-size: 20px;
  line-height: 1;
  background: #333;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 6px 10px;
  cursor: pointer;
}

.title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #ffd54f;
}

.auth-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.auth-input {
  padding: 4px 8px;
  border-radius: 6px;
  border: none;
}

.auth-button {
  padding: 4px 10px;
  background-color: #1e90ff;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.user-label {
  font-size: 0.9em;
  color: #ccc;
}

.icon-btn{
  width: 34px; height: 34px; border-radius: 8px;
  background:#303030; color:#fff; border:1px solid #3a3a3a;
  cursor:pointer; font-size:16px; line-height:1;
}

.icon-btn:hover{ background:#383838; }

.row{ display:flex; align-items:center; gap:8px; color:#eee; }

.muted{ color:#9aa3af; font-size:12px; margin-top:6px; }

/* login modal */
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.55);
  z-index: 3500;
  display: grid; place-items: center;
  padding: 20px;
}

.modal {
  width: min(420px, 92vw);
  background: #242424;
  border: 1px solid #333;
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0,0,0,.45);
  padding: 16px;
  color: #eee;
}

.modal-title { margin: 0 0 4px; }

.modal-subtitle { margin: 0 0 12px; color: #bbb; font-size: 0.9rem; }

.modal-input {
  width: 100%; padding: 10px; border-radius: 8px;
  border: 1px solid #3a3a3a; background: #1f1f1f; color: #eee;
}

.modal-actions {
  margin-top: 12px; display: flex; gap: 8px; justify-content: flex-end;
}

.modal-cancel {
  padding: 6px 10px; border-radius: 8px; border: 1px solid #3a3a3a;
  background: #303030; color: #eee; cursor: pointer;
}

.status-banner {
  position: fixed;
  top: var(--topbar-h);
  left: 0; right: 0;
  z-index: 2999; /* just beneath the topbar’s 3000 is fine because we place it right below */
  padding: 8px 12px;
  text-align: center;
  font-size: 14px;
  background: #2f3136;
  border-bottom: 1px solid #3a3a3a;
  color: #e5e7eb;
}

.status-banner.error {
  background: #402a2a;
  border-bottom-color: #5b3a3a;
  color: #fce7e7;
}

/* Prevent pinch/double-tap zoom on fixed UI (top bar, trays, modals, banners) */
.topbar,
.drawer,
.side-tray,
.modal,
.status-banner,
#layer-controls,
#counts-legend,
#search-tray,
.search-expand-btn,
.search-clear-btn {
  touch-action: pan-x pan-y; /* allow scrolling/panning, block pinch/double-tap zoom */
}

/* Prevent double-tap zoom on actionable controls */
button, a {
  touch-action: manipulation;
}

/* Brand (title as a home button) */
.brand{
  display:inline-flex;
  align-items:center;
  gap:10px;
  text-decoration:none;
  background:#2a2a2a;
  border:1px solid #333;
  padding:6px 10px;
  border-radius:10px;
  box-shadow:0 1px 2px rgba(0,0,0,.25);
  transition: transform .08s ease, background .12s ease, border-color .12s ease;
}

.brand:hover{
  background:#2f2f2f;
  border-color:#3a3a3a;
}

.brand:focus-visible{
  outline: 0;
  box-shadow: 0 0 0 3px rgba(11,87,208,.35);
}

.brand-logo{
  width:22px; height:22px;
  border-radius:6px; /* soft corner so it feels like part of the pill */
}

.brand-text{
  font-size:16px;
  font-weight:700;
  color:#ffd54f;
  letter-spacing:.2px;
}

/* You can remove the old .title rule if it’s no longer used */
</style>
