<script setup>
import { provideConfirm } from '@/shared/ui/useConfirm'

const { state, approve, cancel } = provideConfirm()
</script>

<template>
  <slot />

  <div v-if="state.open" class="confirm-overlay" role="presentation" @click.self="cancel()">
    <div class="confirm-modal" role="dialog" aria-modal="true" aria-live="assertive">
      <h3 class="confirm-title">{{ state.title }}</h3>
      <p class="confirm-message">{{ state.message }}</p>
      <div class="confirm-actions">
        <button class="confirm-btn ghost" type="button" @click="cancel()">{{ state.cancelText }}</button>
        <button
          class="confirm-btn"
          :class="state.tone === 'danger' ? 'danger' : 'primary'"
          type="button"
          @click="approve()"
        >
          {{ state.confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 11000;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.55);
  padding: 16px;
}

.confirm-modal {
  width: min(480px, 92vw);
  background: #242424;
  border: 1px solid #333;
  border-radius: 12px;
  color: #f3f4f6;
  padding: 14px;
}

.confirm-title {
  margin: 0 0 8px;
  font-size: 17px;
}

.confirm-message {
  margin: 0 0 14px;
  color: #d1d5db;
  white-space: pre-wrap;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.confirm-btn {
  border: 1px solid #3a3a3a;
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
  color: #fff;
}

.confirm-btn.ghost {
  background: #2f2f2f;
}

.confirm-btn.primary {
  background: #1e90ff;
  border-color: #1e90ff;
}

.confirm-btn.danger {
  background: #dc3545;
  border-color: #dc3545;
}
</style>

