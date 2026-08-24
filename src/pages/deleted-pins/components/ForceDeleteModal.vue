<template>
  <div v-if="forceDeleteModal.open" class="modal-overlay" @click.self="closeForceDeleteModal">
    <div class="modal-card">
      <h3>Force Delete</h3>
      <p class="muted">{{ forceDeleteModal.message }}</p>
      <p class="muted">Type <code>DELETE</code> to continue.</p>
      <input v-model.trim="forceDeleteModal.confirmText" type="text" placeholder="DELETE" />
      <div class="row-actions">
        <button class="btn ghost" @click="closeForceDeleteModal">Cancel</button>
        <button class="btn danger" :disabled="busyForceDelete" @click="confirmForceDelete">{{ busyForceDelete ? 'Deleting...' : 'Force Delete' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { inject } from 'vue'
import { DELETED_PINS_CTX } from '@/pages/deleted-pins/context'
const { forceDeleteModal, busyForceDelete, closeForceDeleteModal, confirmForceDelete } = inject(DELETED_PINS_CTX).forceDelete
</script>

<style scoped>
.modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55); display: grid; place-items: center; z-index: 5000; }
.modal-card { width: min(420px, 92vw); background: #222; border: 1px solid #3b3b3b; border-radius: 10px; padding: 12px; display: grid; gap: 10px; }
.modal-card h3 { margin: 0; }
.muted { color: #bdbdbd; font-size: 12px; }
code { background: #111; border: 1px solid #333; border-radius: 4px; padding: 2px 5px; }
input { width: 100%; box-sizing: border-box; border-radius: 6px; border: 1px solid #444; background: #171717; color: #eee; padding: 7px 8px; }
.row-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.btn { border: 1px solid #555; background: #3b3b3b; color: #fff; border-radius: 8px; padding: 6px 10px; cursor: pointer; }
.btn.ghost { background: #2d2d2d; }
.btn.danger { background: #c64956; border-color: #c64956; }
</style>
