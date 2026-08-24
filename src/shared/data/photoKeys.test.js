import { describe, it, expect } from 'vitest'
import { buildPhotoKey, keyFromPublicUrl, parsePhotoKey, extForMime, PHOTO_BUCKET, PUBLIC_URL_TOKEN } from '@/shared/data/photoKeys'

describe('buildPhotoKey', () => {
  it('builds {pin}/{report}/{photo}.{ext}', () => {
    expect(buildPhotoKey({ pinId: 'p1', reportId: 'r1', photoId: 'ph1', ext: 'jpg' })).toBe('p1/r1/ph1.jpg')
  })
  it('normalizes the extension and defaults to jpg', () => {
    expect(buildPhotoKey({ pinId: 'p', reportId: 'r', photoId: 'x', ext: '.PNG' })).toBe('p/r/x.png')
    expect(buildPhotoKey({ pinId: 'p', reportId: 'r', photoId: 'x' })).toBe('p/r/x.jpg')
  })
  it('generates a photo id when none is given', () => {
    const k = buildPhotoKey({ pinId: 'p', reportId: 'r' })
    expect(parsePhotoKey(k)).toMatchObject({ pinId: 'p', reportId: 'r', ext: 'jpg' })
    expect(parsePhotoKey(k).photoId).toMatch(/^[0-9a-f-]{36}$/)
  })
  it('refuses keys without both owners', () => {
    expect(() => buildPhotoKey({ pinId: 'p' })).toThrow()
    expect(() => buildPhotoKey({ reportId: 'r' })).toThrow()
  })
})

describe('keyFromPublicUrl', () => {
  const base = `https://abc.supabase.co${PUBLIC_URL_TOKEN}`
  it('extracts the key from a public URL of the bucket', () => {
    expect(keyFromPublicUrl(`${base}p1/r1/ph1.jpg`)).toBe('p1/r1/ph1.jpg')
  })
  it('decodes percent-encoding and passes through bare keys', () => {
    expect(keyFromPublicUrl(`${base}p%201/r1/ph%201.jpg`)).toBe('p 1/r1/ph 1.jpg')
    expect(keyFromPublicUrl('/p1/r1/ph1.jpg')).toBe('p1/r1/ph1.jpg')
  })
  it('returns empty for foreign URLs and blanks', () => {
    expect(keyFromPublicUrl('https://example.com/x.jpg')).toBe('')
    expect(keyFromPublicUrl('')).toBe('')
    expect(keyFromPublicUrl(null)).toBe('')
  })
  it('uses the bucket name in the token', () => {
    expect(PUBLIC_URL_TOKEN).toContain(`/${PHOTO_BUCKET}/`)
  })
})

describe('extForMime', () => {
  it('maps common types and defaults to jpg', () => {
    expect(extForMime('image/png')).toBe('png')
    expect(extForMime('image/jpeg')).toBe('jpg')
    expect(extForMime('image/webp')).toBe('webp')
    expect(extForMime('application/octet-stream')).toBe('jpg')
    expect(extForMime()).toBe('jpg')
  })
})
