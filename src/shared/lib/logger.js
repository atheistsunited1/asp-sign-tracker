import { isDebugEnabled } from '@/shared/lib/debugRuntime'
const DEV = Boolean(import.meta?.env?.DEV)

const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 99,
}

function resolveMinLevel() {
  const raw = String(import.meta?.env?.VITE_LOG_LEVEL || (DEV ? 'info' : 'error')).toLowerCase()
  return LEVELS[raw] ?? (DEV ? LEVELS.info : LEVELS.error)
}

const MIN_LEVEL = resolveMinLevel()

function write(level, message, meta) {
  const debugOverride = isDebugEnabled()
  const effectiveMin = debugOverride ? LEVELS.debug : MIN_LEVEL
  if ((LEVELS[level] ?? 99) < effectiveMin) return
  const fn = console[level] || console.log
  const label = `[${level.toUpperCase()}] ${message}`
  if ((DEV || debugOverride) && meta !== undefined) fn(label, meta)
  else fn(label)
}

export const logger = {
  debug(message, meta) { write('debug', message, meta) },
  info(message, meta) { write('info', message, meta) },
  warn(message, meta) { write('warn', message, meta) },
  error(message, meta) { write('error', message, meta) },
}
