import { describe, it, expect } from 'vitest'
import { useGeolocation, GEO_STATUS, describeGeolocationError } from '@/pages/map/useGeolocation'

// Minimal fake of navigator.geolocation with scripted outcomes.
function fakeProvider({ fast, precise, watch = [] } = {}) {
  const calls = { get: [], watch: 0, cleared: [] }
  let nextWatchId = 1
  const watchers = new Map()
  return {
    calls, watchers,
    getCurrentPosition(ok, err, opts) {
      calls.get.push(opts)
      const plan = opts?.enableHighAccuracy ? precise : fast
      setTimeout(() => {
        if (!plan) return err({ code: 2, message: 'unavailable' })
        if (plan.error) return err(plan.error)
        ok({ coords: plan.coords, timestamp: plan.timestamp || 1000 })
      }, 0)
    },
    watchPosition(ok, err, opts) {
      calls.watch += 1
      const id = nextWatchId++
      watchers.set(id, { ok, err })
      // replay scripted watch positions asynchronously
      watch.forEach((w, i) => setTimeout(() => watchers.has(id) && (w.error ? err(w.error) : ok({ coords: w.coords, timestamp: 2000 + i })), i + 1))
      return id
    },
    clearWatch(id) { calls.cleared.push(id); watchers.delete(id) },
  }
}
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms))

describe('describeGeolocationError', () => {
  it('maps permission denied to the denied status with actionable copy', () => {
    const d = describeGeolocationError({ code: 1 })
    expect(d.status).toBe(GEO_STATUS.DENIED)
    expect(d.message).toMatch(/Allow location/i)
  })
  it('treats timeout and unavailable as recoverable errors', () => {
    expect(describeGeolocationError({ code: 3 }).status).toBe(GEO_STATUS.ERROR)
    expect(describeGeolocationError({ code: 2 }).status).toBe(GEO_STATUS.ERROR)
    expect(describeGeolocationError(null).status).toBe(GEO_STATUS.ERROR)
  })
})

describe('useGeolocation.getFix', () => {
  it('resolves with the fast fix, then refines with the precise one', async () => {
    const provider = fakeProvider({
      fast: { coords: { latitude: 34, longitude: -118, accuracy: 900 } },
      precise: { coords: { latitude: 34.0001, longitude: -118.0001, accuracy: 12 } },
    })
    const geo = useGeolocation({ provider })
    const updates = []
    const first = await geo.getFix({ onUpdate: p => updates.push(p) })
    expect(first.accuracy).toBe(900)
    expect(geo.status.value).toBe(GEO_STATUS.LOCATED)
    await tick()
    expect(updates.length).toBe(2)
    expect(geo.position.value.accuracy).toBe(12)
    expect(provider.calls.get.map(o => !!o.enableHighAccuracy)).toEqual([false, true])
  })
  it('falls back to the precise fix when the fast one fails', async () => {
    const provider = fakeProvider({
      fast: { error: { code: 3 } },
      precise: { coords: { latitude: 1, longitude: 2, accuracy: 5 } },
    })
    const geo = useGeolocation({ provider })
    const p = await geo.getFix()
    expect(p.lat).toBe(1)
    expect(geo.status.value).toBe(GEO_STATUS.LOCATED)
  })
  it('reports denied permission and stops immediately', async () => {
    const provider = fakeProvider({ fast: { error: { code: 1 } }, precise: { coords: { latitude: 1, longitude: 2 } } })
    const geo = useGeolocation({ provider })
    await expect(geo.getFix()).rejects.toMatchObject({ status: GEO_STATUS.DENIED })
    expect(geo.status.value).toBe(GEO_STATUS.DENIED)
    expect(provider.calls.get.length).toBe(1)   // no precise attempt after a denial
  })
  it('keeps the last good position when a later fix fails', async () => {
    const provider = fakeProvider({ fast: { coords: { latitude: 5, longitude: 6, accuracy: 50 } }, precise: { error: { code: 3 } } })
    const geo = useGeolocation({ provider })
    await geo.getFix(); await tick()
    provider.getCurrentPosition = (ok, err) => setTimeout(() => err({ code: 3 }), 0)
    await expect(geo.getFix()).rejects.toMatchObject({ status: GEO_STATUS.ERROR })
    expect(geo.position.value.lat).toBe(5)
    expect(geo.status.value).toBe(GEO_STATUS.LOCATED)
  })
  it('is unavailable without a provider', async () => {
    const geo = useGeolocation({ provider: null })
    expect(geo.supported).toBe(false)
    expect(geo.status.value).toBe(GEO_STATUS.UNAVAILABLE)
    await expect(geo.getFix()).rejects.toMatchObject({ status: GEO_STATUS.UNAVAILABLE })
  })
})

describe('useGeolocation follow / passive / stop', () => {
  it('follows, goes passive on demand, and keeps the dot after stopping', async () => {
    const provider = fakeProvider({ watch: [
      { coords: { latitude: 10, longitude: 20, accuracy: 8 } },
      { coords: { latitude: 10.001, longitude: 20.001, accuracy: 8 } },
    ] })
    const geo = useGeolocation({ provider })
    const seen = []
    expect(geo.startFollow({ onUpdate: p => seen.push(p) })).toBe(true)
    expect(geo.status.value).toBe(GEO_STATUS.FOLLOWING)
    await tick(10)
    expect(seen.length).toBe(2)
    geo.setPassive()
    expect(geo.status.value).toBe(GEO_STATUS.PASSIVE)
    expect(geo.isWatching.value).toBe(true)
    geo.stopFollow()
    expect(provider.calls.cleared.length).toBe(1)
    expect(geo.status.value).toBe(GEO_STATUS.LOCATED)   // position retained
    expect(geo.position.value.lat).toBeCloseTo(10.001)
  })
  it('a transient error during follow keeps following (no stop, flagged transient)', async () => {
    const provider = fakeProvider({ watch: [
      { coords: { latitude: 10, longitude: 20, accuracy: 8 } },
      { error: { code: 2 } },                                   // POSITION_UNAVAILABLE mid-watch
      { coords: { latitude: 10.002, longitude: 20.002, accuracy: 9 } },
    ] })
    const geo = useGeolocation({ provider })
    const errors = [], seen = []
    geo.startFollow({ onUpdate: p => seen.push(p), onError: (e, meta) => errors.push({ e, meta }) })
    await tick(12)
    expect(errors.length).toBe(1)
    expect(errors[0].meta.transient).toBe(true)
    expect(geo.status.value).toBe(GEO_STATUS.FOLLOWING)        // not demoted
    expect(geo.isWatching.value).toBe(true)
    expect(seen.length).toBe(2)                                // resumed after the error
    expect(geo.position.value.lat).toBeCloseTo(10.002)
  })
  it('a denial during follow stops the watch and reports denied', async () => {
    const provider = fakeProvider({ watch: [{ error: { code: 1 } }] })
    const geo = useGeolocation({ provider })
    const errors = []
    geo.startFollow({ onError: e => errors.push(e) })
    await tick(10)
    expect(errors[0].status).toBe(GEO_STATUS.DENIED)
    expect(geo.status.value).toBe(GEO_STATUS.DENIED)
    expect(geo.isWatching.value).toBe(false)
    expect(geo.position.value).toBeNull()                      // no dot once location is disabled
  })
})
