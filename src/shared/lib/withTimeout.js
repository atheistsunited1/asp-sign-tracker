// Race a promise against a timer. Rejects with a TimeoutError named after the label.
export function withTimeout(promise, ms, label = 'op') {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error(`Timed out: ${label}`)
      e.name = 'TimeoutError'
      reject(e)
    }, ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** Reject with an AbortError as soon as `signal` aborts (the underlying promise keeps running). */
export function raceWithAbort(promise, signal) {
  if (!signal) return promise
  const abortError = () => { const e = new Error('Aborted'); e.name = 'AbortError'; return e }
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v) },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e) },
    )
  })
}
