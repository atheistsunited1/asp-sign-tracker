<template>
  <div class="wrap">
    <h2>👥 Manage Users</h2>

    <div v-if="loading || loadingUsers">Loading…</div>

    <template v-else>
      <!-- Pending requests (unchanged UI) -->
      <h3 class="section-title">Pending Requests <span class="muted">({{ pending.length }})</span></h3>
      <div class="list">
        <div v-for="r in pending" :key="r.id" class="row">
          <div class="info">
            <div><strong>{{ r.username }}</strong> <span class="muted">({{ r.email }})</span></div>
            <div class="muted">
              Initials: {{ r.initials || '—' }} · ZIP: {{ r.zip || '—' }} · Since {{ format(r.created_at) }}
            </div>
          </div>
          <div class="actions">
            <label class="muted"><input type="checkbox" v-model="makeAdmin[r.id]" /> make admin</label>
            <button @click="approve(r)">Approve</button>
            <button class="danger" @click="deny(r)">Deny</button>
            <button class="ghost" @click="resetPassword(r.email)">Send reset</button>
          </div>
        </div>
        <div v-if="!pending.length" class="muted">No pending requests.</div>
      </div>

      <!-- All Users (scrollable) -->
      <h3 class="section-title">
        All Users
        <span class="muted">
          ({{ filteredUsers.length }}<template v-if="roleFilter !== 'all'"> of {{ users.length }}</template>)
        </span>
      </h3>
      <div class="users-toolbar">
        <label class="toolbar-label" for="manage-users-role-filter">Role</label>
        <select id="manage-users-role-filter" v-model="roleFilter">
          <option value="all">All roles</option>
          <option value="user">user</option>
          <option value="mapmaster">mapmaster</option>
          <option value="admin">admin</option>
        </select>
      </div>
      <div class="users-box">
        <div v-for="u in filteredUsers" :key="u.id" class="user-row">
            <div class="user-main">
                <div>
                    <strong>{{ u.username || '—' }}</strong>
                    <span class="muted">({{ u.email || '—' }})</span>
                </div>
                <div class="muted">
                    Role: <span :class="['role-pill', u.role]">{{ u.role || 'user' }}</span>
                    · Initials: {{ u.initials || '—' }}
                    · ZIP: {{ u.zip || '—' }}
                    <template v-if="u.approved_at"> · Approved: {{ format(u.approved_at) }}</template>
                </div>
            </div>
            <div class="user-side">
                <span class="id-pill" v-if="u.id">id: {{ u.id.slice(0,8) }}…</span>
                <button class="mini" @click="openEdit(u)">Edit</button>
                <button class="mini" @click="resetPassword(u.email)" :disabled="!u.email">Send reset</button>
                <button class="mini danger" @click="deleteUser(u)">Delete</button> <!-- NEW -->
            </div>

        </div>
        <div v-if="!filteredUsers.length" class="muted" style="padding:8px;">
          {{ users.length ? 'No users match the current role filter.' : 'No users found.' }}
        </div>
      </div>
    </template>

    <!-- NEW: Edit modal -->
    <div v-if="editingUser" class="modal-overlay" @click.self="closeEdit">
      <div class="modal">
        <div class="modal-header">
          <strong>Edit User</strong>
          <button class="tray-x" @click="closeEdit" aria-label="Close">✖</button>
        </div>

        <div class="form-grid">
          <label>Username</label>
          <input v-model.trim="editForm.username" />

          <label>Email</label>
          <input v-model.trim="editForm.email" type="email" />

          <label>Initials</label>
          <input v-model.trim="editForm.initials" maxlength="6" />

          <label>ZIP</label>
          <input v-model.trim="editForm.zip" inputmode="numeric" />

          <label>Role</label>
          <select v-model="editForm.role">
            <option value="user">user</option>
            <option value="mapmaster">mapmaster</option>
            <option value="admin">admin</option>
          </select>
        </div>

        <div class="modal-actions">
          <button class="ghost" @click="closeEdit">Cancel</button>
          <button class="primary" :disabled="saving" @click="saveEdit">Save</button>
        </div>
      </div>
    </div>
    <!-- /NEW modal -->
  </div>
</template>

<script setup>
import { computed, onMounted, ref, reactive } from 'vue'
import { useToast } from '@/shared/ui/useToast'
import { useConfirm } from '@/shared/ui/useConfirm'
import { validateUserPayload } from '@/shared/lib/validators'
import { errorToUserMessage } from '@/shared/lib/errors'
import { normalizeRole } from '@/shared/auth/roles'
import {
  approveUser,
  deleteUserById,
  getCurrentAuthUser,
  listAllUsers,
  listPendingUsers,
  sendResetPasswordEmail,
  updateUser,
} from '@/pages/manage-users/userAdminService'

const { show: showToast } = useToast()
const { confirm } = useConfirm()
const GENERIC_RESET_NOTICE = 'If an account exists for that email, a password reset link has been sent.'

const loading = ref(true)
const loadingUsers = ref(true)
const saving = ref(false)            // NEW
const pending = ref([])
const users = ref([])
const makeAdmin = reactive({})
const roleFilter = ref('all')

const editingUser = ref(null)
const editForm = reactive({ id: '', username: '', email: '', initials: '', zip: '', role: 'user' })
const filteredUsers = computed(() => {
  if (roleFilter.value === 'all') return users.value
  return users.value.filter(u => (u.role || 'user') === roleFilter.value)
})

function format(d){ return new Date(d).toLocaleString() }

async function loadPending() {
  loading.value = true
  const { data, error } = await listPendingUsers()
  if (error) { showToast(errorToUserMessage(error, 'Failed to load pending users.'), 'error'); pending.value = [] }
  else pending.value = (data || []).map(r => ({ ...r, role: normalizeRole(r.role) }))
  loading.value = false
}

async function loadUsers() {
  loadingUsers.value = true
  const { data, error } = await listAllUsers()
  if (error) { showToast(errorToUserMessage(error, 'Failed to load users.'), 'error'); users.value = [] }
  else users.value = (data || []).filter(u => u.is_approved === true).map(u => ({ ...u, role: normalizeRole(u.role) })) // approved only; pending live above
  loadingUsers.value = false
}

async function approve(r){
  // Validate fields we’ll keep
  const v = validateUserPayload({
    username: r.username,
    email: r.email,
    initials: r.initials,
    zip: r.zip
  })
  if (!v.ok) { showToast(v.errors.join('\n'), 'error'); return }
  const clean = v.value

  // who is approving?
  const { data: { user: admin } } = await getCurrentAuthUser()
  const role = makeAdmin[r.id] ? 'admin' : 'user'

  const { error } = await approveUser({
    id: r.id,
    payload: {
      email: clean.email,
      username: clean.username,
      initials: clean.initials,
      zip: clean.zip,
      role,
      is_approved: true,
      approved_at: new Date().toISOString(),
      approved_by: admin?.id || null,
      updated_at: new Date().toISOString(),
    },
  })

  if (error) {
    showToast(errorToUserMessage(error, 'Failed to approve user.'), 'error')
    return
  }
  showToast('User approved.', 'success')
  await Promise.all([loadPending(), loadUsers()])
}

async function deny(r){
  const ok = await confirm({
    title: 'Deny request?',
    message: 'This will remove their profile record.',
    confirmText: 'Deny',
    cancelText: 'Cancel',
    tone: 'danger',
  })
  if (!ok) return
  const { error } = await deleteUserById(r.id)
  if (error) showToast(errorToUserMessage(error, 'Failed to deny user request.'), 'error')
  else {
    showToast('Request denied.', 'success')
    await loadPending()
  }
}

function recoveryRedirectUrl () {
  const u = new URL(window.location.origin)
  u.searchParams.set('recovery', '1')
  return u.toString()
}
async function resetPassword(email){
  try {
    await sendResetPasswordEmail(email, recoveryRedirectUrl())
    showToast(GENERIC_RESET_NOTICE, 'success')
  } catch {
    showToast(GENERIC_RESET_NOTICE, 'success')
  }
}

/* Edit handlers */
function openEdit(u){
  editingUser.value = u
  editForm.id = u.id
  editForm.username = u.username || ''
  editForm.email = u.email || ''
  editForm.initials = u.initials || ''
  editForm.zip = u.zip || ''
  editForm.role = normalizeRole(u.role)
}
function closeEdit(){
  editingUser.value = null
  editForm.id = ''
  editForm.username = ''
  editForm.email = ''
  editForm.initials = ''
  editForm.zip = ''
  editForm.role = 'user'
}
async function saveEdit(){
  if (!editForm.id) {
    showToast('Missing user id.', 'error')
    return
  }
  
  // Validate the edit fields
  const v = validateUserPayload({
    username: editForm.username,
    email: editForm.email,
    initials: editForm.initials,
    zip: editForm.zip
  })
  if (!v.ok) { showToast(v.errors.join('\n'), 'error'); return }
  const clean = v.value

  saving.value = true
  try {
    const { error } = await updateUser({
      id: editForm.id,
      payload: {
        email: clean.email,
        username: clean.username,
        initials: clean.initials,
        zip: clean.zip,
        role: editForm.role || 'user',
        updated_at: new Date().toISOString(),
      },
    })
    if (error) throw error

    await loadUsers()
    closeEdit()
    showToast('User updated.', 'success')
  } catch (e) {
    showToast(errorToUserMessage(e, 'Failed to update user.'), 'error')
  } finally {
    saving.value = false
  }
}

async function deleteUser(u){
  if (!u?.id) {
    showToast('Missing user id.', 'error')
    return
  }
  const ok = await confirm({
    title: 'Delete user?',
    message: `Delete user "${u.username || u.email || u.id}"? This cannot be undone.`,
    confirmText: 'Delete',
    cancelText: 'Cancel',
    tone: 'danger',
  })
  if (!ok) return
  const { error } = await deleteUserById(u.id)
  if (error) showToast(errorToUserMessage(error, 'Failed to delete user.'), 'error')
  else {
    showToast('User deleted.', 'success')
    await loadUsers()
  }
}

onMounted(async () => {
  await Promise.all([loadPending(), loadUsers()])
})

</script>

<style scoped>
.wrap{padding:20px;color:#eee}
.section-title{margin:16px 0 8px 0;color:#ffd54f}
.muted{opacity:.8;font-size:12px}

.list{display:grid;gap:10px}
.row{
  display:flex;justify-content:space-between;align-items:center;
  border:1px solid #333;border-radius:10px;padding:10px;background:#242424
}
.info .muted{opacity:.8;font-size:12px}
.actions{display:flex;gap:8px;align-items:center}
button{border:1px solid #3a3a3a;background:#303030;color:#eee;border-radius:8px;padding:8px 10px;cursor:pointer}
button.danger{background:#442b2b;border-color:#5b3a3a}
button.ghost{background:#2a2a2a}

.users-box{
  border:1px solid #333;border-radius:10px;background:#242424;
  padding:8px;
  max-height: 380px;
  overflow-y: auto;
}
.users-toolbar{
  display:flex;
  align-items:center;
  gap:8px;
  margin-bottom:8px;
  flex-wrap:wrap;
}
.toolbar-label{
  color:#ddd;
  font-size:12px;
  text-transform:uppercase;
  letter-spacing:.06em;
}
.user-row{
  display:flex;justify-content:space-between;gap:12px;
  padding:8px;border-bottom:1px solid #2f2f2f;
}
.user-row:last-child{ border-bottom: none; }
.user-main{display:flex;flex-direction:column;gap:4px}
.user-side{display:flex;align-items:center;gap:8px}
.id-pill{
  font-size:12px; color:#ddd; background:#2a2a2a; border:1px solid #3a3a3a;
  border-radius:12px; padding:2px 8px;
}
.mini{
  padding:6px 10px;border:1px solid #3a3a3a;background:#303030;color:#eee;border-radius:8px;cursor:pointer
}

.role-pill{
  display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px;
  border:1px solid #3a3a3a; background:#2a2a2a; color:#eee;
}
.role-pill.admin{ background:#3a2a2a; border-color:#5b3a3a }
.role-pill.mapmaster{ background:#243142; border-color:#40607f }
.role-pill.user{  background:#2a2a3a; border-color:#3a3a5b }

/* NEW: modal styles (re-using your app visual language) */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:grid;place-items:center;z-index:3500;padding:20px;}
.modal{
  width:min(520px,92vw);background:#242424;border:1px solid #333;border-radius:12px;padding:14px;color:#eee;
}
.modal-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.form-grid{
  display:grid;grid-template-columns:120px 1fr;gap:8px;align-items:center;margin-bottom:10px
}
input, select{
  padding:10px;border-radius:8px;border:1px solid #3a3a3a;background:#1f1f1f;color:#eee
}
.modal-actions{display:flex;justify-content:flex-end;gap:8px}
.primary{background:#1e90ff;border:1px solid #1e90ff;color:#fff;border-radius:8px;padding:8px 12px;cursor:pointer}
.tray-x{
  border:1px solid #3a3a3a; background:#303030; color:#ddd; border-radius:6px; padding:4px 8px; cursor:pointer;
}
.mini{ padding:6px 8px; font-size:12px; }
.mini.danger{ background:#442b2b; border-color:#5b3a3a }

</style>
