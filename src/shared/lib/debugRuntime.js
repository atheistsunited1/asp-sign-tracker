const DEV = Boolean(import.meta?.env?.DEV)
const LS_KEY = 'app.debug.enabled'
export const DEBUG_RUNTIME_EVENT = 'app:debug-runtime-changed'

let canUseDebug = DEV
let debugEnabled = DEV
let initialized = false

function readSavedFlag() {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw === '1') return true
    if (raw === '0') return false
  } catch {}
  return null
}

function persistFlag(value) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(LS_KEY, value ? '1' : '0') } catch {}
}

function emitChange() {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent(DEBUG_RUNTIME_EVENT, { detail: getDebugRuntimeState() }))
  } catch {}
}

function initOnce() {
  if (initialized) return
  initialized = true
  const saved = readSavedFlag()
  if (saved != null) debugEnabled = saved
  else debugEnabled = DEV
}

export function configureDebugAccess(canAdmin) {
  initOnce()
  canUseDebug = DEV || !!canAdmin
  if (!canUseDebug) debugEnabled = false
  emitChange()
  return getDebugRuntimeState()
}

export function isDebugAllowed() {
  initOnce()
  return !!canUseDebug
}

export function isDebugEnabled() {
  initOnce()
  return !!canUseDebug && !!debugEnabled
}

export function setDebugEnabled(nextEnabled) {
  initOnce()
  if (!canUseDebug) return false
  debugEnabled = !!nextEnabled
  persistFlag(debugEnabled)
  emitChange()
  return debugEnabled
}

export function getDebugRuntimeState() {
  initOnce()
  return {
    canUseDebug: !!canUseDebug,
    debugEnabled: !!canUseDebug && !!debugEnabled,
  }
}

