// Client telemetry → app_logs. Never throws; logging must not break UX.
import { appLogsRepo } from '@/shared/data/repos/appLogsRepo'

export function sanitizeTelemetryDetails(details = {}) {
  const out = {}
  for (const [key, value] of Object.entries(details || {})) {
    if (value == null || typeof value === 'number' || typeof value === 'boolean') { out[key] = value; continue }
    if (typeof value === 'string') { out[key] = value.slice(0, 240); continue }
    out[key] = '[redacted]'
  }
  return out
}

/** A page-scoped logger: `logClient(event, message, details?, level?)` with the source and current user baked in. */
export function makeClientLogger(source, userRef = null) {
  return (event, message, details = {}, level = 'error') =>
    logClientEvent({ source, userId: userRef?.value?.id ?? null, level, event, message, details })
}

export async function logClientEvent({ source, userId = null, level = 'error', event, message, details = {} }) {
  try {
    const device = (navigator?.userAgentData?.mobile ? 'mobile'
      : /Mobi|Android/i.test(navigator?.userAgent || '') ? 'mobile' : 'desktop')
    const network = (navigator?.onLine === false) ? 'offline' : (navigator?.connection?.effectiveType || 'unknown')
    await appLogsRepo.insert([{
      user_id: userId, source, level, event, message,
      details: sanitizeTelemetryDetails(details), device, network,
    }])
  } catch (_) { /* swallow */ }
}
