// Background mirroring of My Maps photo links into the sign-photos bucket via
// the `mirror-photo` edge function (a plain fetch → store proxy; Google does the
// resizing/compression via the URL hint in sourceUrl.js): a worker pool with adaptive concurrency
// (backs off when failures cluster, creeps back up), retries, a stall
// watchdog, cancel/resume, and a log the page can show. Keys follow the one
// storage scheme ({pin}/{report}/{photo}.jpg) and photos.image_url gets the
// public URL the function returns.
import { reactive, onUnmounted } from 'vue'
import { PHOTO_BUCKET, buildPhotoKey } from '@/shared/data/photoStorage'
import { insertPhotoRecord, invokeMirrorPhoto } from '@/pages/kml-import/kmlImportService'
import { logger } from '@/shared/lib/logger'
import { withTimeout } from '@/shared/lib/withTimeout'
import { normalizeSourceUrl } from '@/pages/kml-import/sourceUrl.js'

export const MAX_WORKERS = 32
const MIN_WORKERS = 4
const WINDOW = 20          // outcomes considered for back-off
const BACKOFF_FAILS = 5    // ≥ this many failures in the window → halve concurrency
const RECOVER_OK = 40      // this many straight successes → grow again


export function usePhotoMirrorQueue() {
  const q = reactive({
    total: 0, queued: [], inFlight: 0, started: 0, succeeded: 0, failed: 0, retried: 0,
    running: false, lastActivity: 0, logs: [], stall: false, cancel: false,
    concurrency: MAX_WORKERS, maxWorkers: MAX_WORKERS,
  })
  let outcomes = []      // recent true/false results
  let okStreak = 0

  function recordOutcome(ok) {
    outcomes.push(ok); if (outcomes.length > WINDOW) outcomes.shift()
    okStreak = ok ? okStreak + 1 : 0
    const fails = outcomes.filter((o) => !o).length
    if (fails >= BACKOFF_FAILS && q.concurrency > MIN_WORKERS) {
      q.concurrency = Math.max(MIN_WORKERS, Math.floor(q.concurrency / 2))
      outcomes = []; okStreak = 0
      log(`⬇ backing off to ${q.concurrency} workers (${fails} failures in the last ${WINDOW})`)
    } else if (okStreak >= RECOVER_OK && q.concurrency < q.maxWorkers) {
      q.concurrency = Math.min(q.maxWorkers, q.concurrency + 8)
      okStreak = 0
      log(`⬆ back up to ${q.concurrency} workers`)
    }
  }

  function log(msg) {
    q.logs.unshift(`[${new Date().toLocaleTimeString()}] ${msg}`)
    if (q.logs.length > 300) q.logs.pop()
  }

  function reset() {
    Object.assign(q, { total: 0, queued: [], inFlight: 0, started: 0, succeeded: 0, failed: 0, retried: 0, running: false, lastActivity: 0, logs: [], stall: false, cancel: false, concurrency: q.maxWorkers })
    outcomes = []; okStreak = 0
  }

  /** Queue every source URL of one activity. */
  function enqueue({ pinId, reportId, urls = [] }) {
    for (const url of urls) {
      // Google-hosted originals can be tens of MB; ask for the 800 px rendition the app stores anyway.
      const srcUrl = normalizeSourceUrl(url)
      q.queued.push({ pinId, reportId, srcUrl, path: buildPhotoKey({ pinId, reportId, ext: 'jpg' }) })
    }
    q.total = q.queued.length + q.succeeded + q.failed
  }

  async function mirrorOne(job) {
    q.lastActivity = Date.now()
    try {
      const { data, error } = await withTimeout(
        invokeMirrorPhoto({ url: job.srcUrl, path: job.path, bucket: PHOTO_BUCKET }),
        35_000, 'mirror-photo',
      )
      if (error || !data?.ok) throw new Error('mirror-photo failed')
      const finalUrl = data.publicUrl || job.srcUrl
      const { error: dbErr } = await insertPhotoRecord({ report_id: job.reportId, image_url: finalUrl })
      if (dbErr && dbErr.code !== '23505') throw new Error('photos insert failed')
      log(`✅ ${finalUrl} (${data.size ? Math.round(data.size / 1024) + ' KB' : data.status || 'external'})`)
      return true
    } catch (e) {
      log(`❌ ${job.srcUrl}`)
      logger.warn('KML mirror-photo worker failed', e)
      return false
    }
  }

  async function worker(slot, maxRetries = 3) {
    while (!q.cancel) {
      // Slots above the current concurrency idle instead of taking work.
      if (slot >= q.concurrency) { await new Promise((r) => setTimeout(r, 1000)); if (!q.queued.length) return; continue }
      const job = q.queued.shift()
      if (!job) return
      q.inFlight++; q.started++; q.lastActivity = Date.now()
      let ok = false, attempt = 0, delay = 1000
      while (!ok && attempt <= maxRetries && !q.cancel) {
        attempt++
        ok = await mirrorOne(job)
        if (!ok && attempt <= maxRetries) {
          q.retried++
          log(`⏳ retry ${attempt}/${maxRetries}: ${job.srcUrl}`)
          await new Promise((r) => setTimeout(r, delay))
          delay = Math.min(delay * 2, 10_000)
        }
      }
      if (ok) q.succeeded++; else q.failed++
      recordOutcome(ok)
      q.inFlight--; q.lastActivity = Date.now()
      q.total = q.queued.length + q.succeeded + q.failed
    }
  }

  async function start(maxWorkers = MAX_WORKERS) {
    if (q.running) return
    q.maxWorkers = maxWorkers; q.concurrency = Math.min(q.concurrency, maxWorkers) || maxWorkers
    q.running = true; q.cancel = false; q.stall = false; q.lastActivity = Date.now()
    log(`▶ ${q.queued.length} queued, up to ${maxWorkers} workers`)
    await Promise.all(Array.from({ length: maxWorkers }, (_, i) => worker(i)))
    q.running = false
    if (!q.cancel) log('✔ photo queue finished')
  }

  function cancel() { q.cancel = true; q.running = false; log('■ cancel requested') }
  function restartStalled() { if (!q.stall) return; q.stall = false; start(q.maxWorkers) }

  const watchdog = setInterval(() => {
    if (!q.running) return
    if (q.inFlight > 0 && Date.now() - q.lastActivity > 60_000) { q.stall = true; log('⚠️ uploads appear stalled (>60s)') }
  }, 10_000)
  onUnmounted(() => clearInterval(watchdog))

  return { q, enqueue, start, cancel, restartStalled, reset }
}
