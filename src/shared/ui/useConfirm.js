import { inject, provide, reactive, readonly } from 'vue'

const k = Symbol('confirm')

export function provideConfirm() {
  const state = reactive({
    open: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    tone: 'danger',
    _resolve: null,
  })

  function settle(result) {
    const resolve = state._resolve
    state._resolve = null
    state.open = false
    if (resolve) resolve(!!result)
  }

  const api = {
    state: readonly(state),
    confirm(options = {}) {
      if (state._resolve) settle(false)
      state.title = options.title || 'Confirm action'
      state.message = options.message || ''
      state.confirmText = options.confirmText || 'Confirm'
      state.cancelText = options.cancelText || 'Cancel'
      state.tone = options.tone || 'danger'
      state.open = true
      return new Promise((resolve) => {
        state._resolve = resolve
      })
    },
    approve() {
      settle(true)
    },
    cancel() {
      settle(false)
    },
  }

  provide(k, api)
  return api
}

export function useConfirm() {
  const api = inject(k, null)
  if (!api) throw new Error('useConfirm(): confirm not provided. Mount <ConfirmHost/> near the app root.')
  return api
}

