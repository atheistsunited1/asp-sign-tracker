<template>
  <!-- Account Tray -->
  <SideTray :open="accountOpen" title="Account" @close="accountOpen = false">
    <div class="kv"><div class="kv-label">Email</div><div class="kv-value">{{ user?.email }}</div></div>

    <div class="kv">
      <div class="kv-label">Role</div>
      <div class="kv-value">
        <template v-if="pendingSignup">
          guest <span class="kv-pending">(Account Pending)</span>
        </template>
        <template v-else>{{ userRole }}</template>
      </div>
    </div>

    <!-- Account details: the same fields for pending and approved members -->
    <template v-if="user">
      <div class="kv"><div class="kv-label">Pirate name</div><div class="kv-value">{{ accountUsername || '—' }}</div></div>
      <div class="kv"><div class="kv-label">Initials</div><div class="kv-value">{{ accountInitials || '—' }}</div></div>
      <div class="kv" v-if="!pendingSignup">
        <div class="kv-label">Member since</div>
        <div class="kv-value">{{ memberSinceLabel || '—' }}</div>
      </div>
    </template>

    <div class="tray-actions-col" v-if="user">
      <button class="tray-action" @click="sendReset">Reset Password</button>
      <button class="tray-action danger tray-logout" @click="doLogout">Log out</button>
    </div>
  </SideTray>
</template>

<script setup>
// Account tray (#65, #133): who is signed in, reset password, log out.
import { inject, computed } from 'vue'
import { APP_SHELL_CTX } from '@/app/shellContext'
import SideTray from '@/app/components/SideTray.vue'

const { user, userRole, userProfile, pendingSignup, nav, auth } = inject(APP_SHELL_CTX)
const { accountOpen } = nav
const { sendReset, doLogout } = auth

// "Pirate name" is the member's username.
const accountUsername = computed(() => userProfile.value?.username || pendingSignup.value?.username || '')
const accountInitials = computed(() => userProfile.value?.initials || pendingSignup.value?.initials || '')
const memberSinceLabel = computed(() => {
  // Member since = approval date (when they could start contributing); signup date as fallback.
  const raw = userProfile.value?.approved_at || userProfile.value?.created_at || null
  if (!raw) return ''
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString()
})
</script>

<style>
/* Moved from App.vue (#133). Global, not scoped — these selectors are also matched by other pages
   (e.g. .tray-x / .tray-section in the map tray), so scoping would change them. */
.kv{ display:grid; grid-template-columns:96px 1fr; gap:8px; align-items:center; }
.kv-label{ color:#9aa3af; font-size:12px; text-transform:uppercase; letter-spacing:.06em; }
.kv-value{ color:#e5e7eb; font-weight:600; min-width:0; overflow-wrap:anywhere; }  /* long emails wrap instead of clipping */
.tray-logout{ align-self:center; width:auto; text-align:center; padding:10px 18px; }
.tray-actions-col{ display:flex; flex-direction:column; gap:8px; margin-top:6px; }
.tray-action{
  background:#303030; color:#eee; border:1px solid #3a3a3a;
  border-radius:8px; padding:10px; cursor:pointer; text-align:left;
}
.tray-action:hover{ background:#383838; }
.tray-action.danger{ background:#442b2b; border-color:#5b3a3a; }
</style>
