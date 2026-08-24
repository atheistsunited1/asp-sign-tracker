import { describe, it, expect, vi, beforeEach } from 'vitest'

// Storage + compression are mocked: the test pins the pipeline contract
// (rotate → compress → key {pin}/{report}/{photo}.ext → upload → public URL → rows).
const uploaded = []
vi.mock('@/shared/data/photoStorage', () => ({
  buildPhotoKey: ({ pinId, reportId, ext }) => `${pinId}/${reportId}/photo-${uploaded.length + 1}.${ext}`,
  extForMime: (m) => (m === 'image/png' ? 'png' : 'jpg'),
  publicUrlForKey: (key) => (key.includes('nourl') ? null : `https://cdn.test/${key}`),
  uploadPhoto: vi.fn(async (key, file) => {
    uploaded.push(key)
    if (file.name === 'fail.jpg') return { data: null, error: new Error('storage down') }
    return { data: { path: key }, error: null }
  }),
}))
vi.mock('@/shared/lib/photoUtils', () => ({
  rotateImageFile: vi.fn(async (file, deg) => ({ ...file, name: `rot${deg}-${file.name}`, type: file.type, size: file.size })),
  compressPhotos: vi.fn(async (files) => ({
    okFiles: files.filter((f) => f.name !== 'bad.txt').map((f) => ({ ...f, type: 'image/jpeg' })),
    rejected: files.filter((f) => f.name === 'bad.txt').map((f) => ({ name: f.name, reason: 'disallowed_type' })),
    failed: [],
  })),
}))
const insertRows = vi.fn(() => ({ select: () => Promise.resolve({ data: [{ id: 'ph1' }], error: null }) }))
vi.mock('@/shared/data/repos/photosRepo', () => ({ photosRepo: { insertRows: (...a) => insertRows(...a) } }))
vi.mock('@/shared/data/repos/pinsRepo', () => ({ pinsRepo: {} }))
vi.mock('@/shared/data/repos/reportsRepo', () => ({ reportsRepo: {} }))
vi.mock('@/shared/data/repos/profilesRepo', () => ({ profilesRepo: {} }))
vi.mock('@/shared/auth/authService', () => ({ getSession: vi.fn() }))
vi.mock('@/shared/domain/geocode', () => ({ reverseGeocodeCityState: vi.fn() }))

const { uploadActivityPhotos, uploadAndAttachPhotos } = await import('./photoUploadService')
const photoUtils = await import('@/shared/lib/photoUtils')

const file = (name, type = 'image/jpeg') => ({ name, type, size: 1234 })

beforeEach(() => { uploaded.length = 0; insertRows.mockClear() })

describe('uploadActivityPhotos', () => {
  it('keys every upload as {pin}/{report}/{photo}.ext and returns public URLs in order', async () => {
    const events = []
    const res = await uploadActivityPhotos({
      items: [{ file: file('a.jpg') }, { file: file('b.jpg'), rotation: 90 }],
      pinId: 'pin1', reportId: 'rep1', onEvent: (e, d) => events.push(e),
    })
    expect(res.urls).toEqual(['https://cdn.test/pin1/rep1/photo-1.jpg', 'https://cdn.test/pin1/rep1/photo-2.jpg'])
    expect(res.keys).toEqual(['pin1/rep1/photo-1.jpg', 'pin1/rep1/photo-2.jpg'])
    expect(res.failed).toEqual([])
    expect(events).toEqual(['uploaded', 'uploaded'])
    expect(photoUtils.rotateImageFile).toHaveBeenCalledWith(expect.objectContaining({ name: 'b.jpg' }), 90)
  })

  it('accounts rejected and failed files without aborting the rest', async () => {
    const events = []
    const res = await uploadActivityPhotos({
      items: [{ file: file('bad.txt', 'text/plain') }, { file: file('fail.jpg') }, { file: file('ok.jpg') }],
      pinId: 'p', reportId: 'r', onEvent: (e) => events.push(e),
    })
    expect(res.rejected).toEqual([{ name: 'bad.txt', reason: 'disallowed_type' }])
    expect(res.failed.map((f) => f.reason)).toEqual(['upload_failed'])
    expect(res.urls).toHaveLength(1)
    expect(events).toEqual(['upload_failed', 'uploaded'])
  })

  it('returns empty results for no items', async () => {
    expect(await uploadActivityPhotos({ items: [], pinId: 'p', reportId: 'r' })).toEqual({ urls: [], keys: [], rejected: [], failed: [] })
  })

  it('rethrows an AbortError so the caller can report a cancelled submission', async () => {
    const ctrl = new AbortController(); ctrl.abort()
    await expect(uploadActivityPhotos({ items: [{ file: file('a.jpg') }], pinId: 'p', reportId: 'r', signal: ctrl.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('uploadAndAttachPhotos', () => {
  it('inserts one photos row per uploaded URL', async () => {
    const res = await uploadAndAttachPhotos({ items: [{ file: file('a.jpg') }], pinId: 'p', reportId: 'r' })
    expect(insertRows).toHaveBeenCalledWith([{ report_id: 'r', image_url: 'https://cdn.test/p/r/photo-1.jpg' }], undefined)
    expect(res.rows).toEqual([{ id: 'ph1' }])
    expect(res.attachError).toBeNull()
  })
  it('skips the insert when nothing uploaded', async () => {
    const res = await uploadAndAttachPhotos({ items: [{ file: file('bad.txt', 'text/plain') }], pinId: 'p', reportId: 'r' })
    expect(insertRows).not.toHaveBeenCalled()
    expect(res.rows).toEqual([])
  })
})
