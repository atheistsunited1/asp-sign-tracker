// src/utils/debug.js
import { logger } from '@/shared/lib/logger'
import { isDebugEnabled } from '@/shared/lib/debugRuntime'

export function scope(ns) {
  const pad = (n) => String(n).padStart(2, '0')
  const ts = () => {
    const d = new Date()
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`
  }
  return (...args) => {
    if (!isDebugEnabled()) return
    logger.debug(`[${ts()}] [${ns}]`, args)
  }
}

export function expectEvent(label, timeoutMs = 2500) {
  if (!isDebugEnabled()) return () => {}
  let done = false
  const t = setTimeout(() => {
    if (!done) logger.warn(`[EXPECT] ${label} FAILED (timeout ${timeoutMs}ms)`)
  }, timeoutMs)
  return () => {
    if (!done) {
      done = true
      clearTimeout(t)
      logger.debug(`[EXPECT] ${label} SUCCESSFUL`)
    }
  }
}
