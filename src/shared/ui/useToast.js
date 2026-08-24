import { reactive, readonly, inject, provide } from 'vue'

const k = Symbol('toast')
const VALID_TYPES = new Set(['success', 'error', 'info', 'warn'])

export function provideToast() {
  const state = reactive({ show:false, message:'', type:'info', timeout:2200, _t:null })
  const api = {
    state: readonly(state),
    show(message, type, timeout=2200) {
      let normalized = type
      if (!normalized) {
        if (import.meta?.env?.DEV) {
          throw new Error('useToast.show requires an explicit toast type: success|error|info|warn')
        }
        normalized = 'info'
      }
      if (!VALID_TYPES.has(normalized)) normalized = 'info'
      state.message = message
      state.type = normalized
      state.timeout = timeout
      state.show = true
      clearTimeout(state._t)
      state._t = setTimeout(() => { state.show = false }, timeout)
    }
  }
  provide(k, api)
  return api
}

export function useToast() {
  const api = inject(k, null)
  if (!api) throw new Error('useToast(): toast not provided. Mount <ToastHost/> near the app root.')
  return api
}
