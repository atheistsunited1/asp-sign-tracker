<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal">
      <div class="modal-header">
        <strong>Reset Password</strong>
        <button class="tray-x" @click="$emit('close')" aria-label="Close">X</button>
      </div>
      <form @submit.prevent="doReset">
        <label>New password</label>
        <input v-model="pw" type="password" required />
        <label>Confirm</label>
        <input v-model="pw2" type="password" required />
        <div class="row">
          <button class="primary" :disabled="busy">Update</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useToast } from '@/shared/ui/useToast'
import { errorToUserMessage } from '@/shared/lib/errors'
import { logger } from '@/shared/lib/logger'
import { updatePassword } from '@/shared/auth/authService'

const pw = ref('')
const pw2 = ref('')
const busy = ref(false)
const { show: showToast } = useToast()

async function doReset() {
  if (pw.value !== pw2.value) {
    showToast('Passwords do not match.', 'error')
    return
  }

  busy.value = true
  try {
    const { error } = await updatePassword(pw.value)
    if (error) throw error

    showToast('Password updated successfully.', 'success')
    pw.value = pw2.value = ''

    setTimeout(() => {
      try {
        window.dispatchEvent(new Event('password:updated'))
      } catch (e) {
        logger.warn('ResetPasswordModal password:updated dispatch failed', e)
      }
    }, 0)
  } catch (e) {
    logger.error('ResetPasswordModal updatePassword failed', e)
    showToast(errorToUserMessage(e, 'Could not update password.'), 'error')
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:grid;place-items:center;z-index:3500;padding:20px;}
.modal{width:min(420px,92vw);background:#242424;border:1px solid #333;border-radius:12px;padding:16px;color:#eee}
.modal-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
input{display:block;width:100%;margin-bottom:10px;padding:10px;border:1px solid #3a3a3a;border-radius:8px;background:#1f1f1f;color:#eee}
.row{margin-top:10px;display:flex;justify-content:flex-end}
button.primary{padding:8px 12px;background:#1e90ff;color:#fff;border:none;border-radius:8px;cursor:pointer}
.tray-x{border:1px solid #3a3a3a;background:#303030;color:#ddd;border-radius:6px;padding:4px 8px;cursor:pointer}
</style>
