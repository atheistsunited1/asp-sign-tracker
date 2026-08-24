// Settings tray: the debug-logging toggle (admins only), kept in sync with the
// runtime flag (debugRuntime) and with the isAdmin state.
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { DEBUG_RUNTIME_EVENT, configureDebugAccess, isDebugAllowed, isDebugEnabled, setDebugEnabled } from '@/shared/lib/debugRuntime'

export function useDebugSettings({ isAdmin, showToast }) {
  const debugEnabled = ref(isDebugEnabled())
  const canToggleDebug = ref(isDebugAllowed())

  function syncDebugAccess() {
    const state = configureDebugAccess(!!isAdmin.value)
    canToggleDebug.value = state.canUseDebug
    debugEnabled.value = state.debugEnabled
  }

  function persistDebugEnabled() {
    const next = setDebugEnabled(!!debugEnabled.value)
    debugEnabled.value = next
    showToast(`Debug logging ${next ? 'enabled' : 'disabled'}.`, 'info')
  }

  const onDebugRuntimeChanged = (e) => {
    const detail = e?.detail || {}
    canToggleDebug.value = !!detail.canUseDebug
    debugEnabled.value = !!detail.debugEnabled
  }

  watch(() => isAdmin.value, () => { syncDebugAccess() }, { immediate: true })
  onMounted(() => {
    syncDebugAccess()   // restore settings
    window.addEventListener(DEBUG_RUNTIME_EVENT, onDebugRuntimeChanged)
  })
  onBeforeUnmount(() => { window.removeEventListener(DEBUG_RUNTIME_EVENT, onDebugRuntimeChanged) })

  return { debugEnabled, canToggleDebug, persistDebugEnabled }
}
