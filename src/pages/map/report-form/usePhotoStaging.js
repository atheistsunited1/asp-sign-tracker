// Staged photos for the report form: pick → (HEIC guard) → stage with object
// URLs, optional EXIF-GPS prompt, rotate/remove/clear, and the lightbox.
// Uploading happens in useSubmitReport via shared/domain/photoUploadService.
import { ref, computed } from 'vue'
import exifr from 'exifr'
import { formatCoords } from '@/shared/lib/coords'
import { reverseGeocodePlace } from '@/shared/domain/geocode'
import { logger } from '@/shared/lib/logger'

export const MAX_PHOTOS = 2

/**
 * @param {{ showToast: Function, confirm: Function, log: Function, logClient: Function, onUseGps: (coords: string) => void }} deps
 */
export function usePhotoStaging({ showToast, confirm, log, logClient, onUseGps }) {
  const fileInput = ref(null)
  const stagedPhotos = ref([]) // [{ id, file, url, rotation }]
  const overMax = computed(() => stagedPhotos.value.length > MAX_PHOTOS)

  // Exposed so Map can open the photo picker for the active report flow.
  function openGalleryPicker() { try { fileInput.value?.click() } catch {} }
  function onAddPhotosClick() { log('Add photos button clicked'); openGalleryPicker() }

  // --- Lightbox state ---
  const lightboxOpen = ref(false)
  const lightboxSrc = ref('')
  function openLightbox(src) {
    lightboxSrc.value = src || ''
    lightboxOpen.value = !!lightboxSrc.value
  }
  function closeLightbox() {
    lightboxOpen.value = false
    // small delay before clearing to avoid flash when quickly reopening
    setTimeout(() => { lightboxSrc.value = '' }, 150)
  }

  function isHeicLike(f) {
    const t = String(f?.type || '')
    const n = String(f?.name || '')
    return /heic|heif/i.test(t) || /\.hei[cf]$/i.test(n)
  }

  // Minimal policy: politely block HEIC and ask user to pick from Photos/Camera
  async function ensureUploadableFile(file) {
    if (isHeicLike(file)) {
      await logClient('photo_heic_detected', 'HEIC/HEIF chosen; ask user to pick JPEG via Photos/Camera', {
        name: file.name, type: file.type, size: file.size,
      }, 'warn')
      showToast('This photo is HEIC/HEIF. Please choose it from your Photos/Camera so it uploads as JPEG.', 'warn')
      return null // don’t stage HEIC
    }
    return file
  }

  // Try to read GPS from one or more selected files, and offer to use it
  async function maybeApplyGpsFromPhoto(files) {
    const list = Array.from(files || [])
    if (!list.length) return

    let gpsLat = null
    let gpsLng = null
    // Look for the first file that has GPS data
    for (const file of list) {
      try {
        const data = await exifr.parse(file, { gps: true })
        if (data && typeof data.latitude === 'number' && typeof data.longitude === 'number') {
          gpsLat = data.latitude
          gpsLng = data.longitude
          break
        }
      } catch (e) {
        logger.warn('ReportForm exifr parse failed for file', { name: file?.name })
      }
    }

    if (gpsLat == null || gpsLng == null) {
      showToast('GPS not found in photo metadata.', 'error')
      return
    }

    const gpsStr = formatCoords(gpsLat, gpsLng)

    // reverse geocode for a human-readable place
    let place = null
    try {
      place = await reverseGeocodePlace(gpsLat, gpsLng)
    } catch (e) {
      logger.warn('ReportForm reverseGeocodePlace failed for photo GPS', e)
    }
    const placeLine = place ? `\nLocation: ${place}` : ''

    // We can’t literally change browser button labels, but we phrase it as Yes/No
    const message = `Use this GPS coordinate?\n\n` +
                    `Coordinate: ${gpsStr}${placeLine}\n\n`

    const yes = await confirm({
      title: 'Use photo GPS coordinate?',
      message,
      confirmText: 'Use GPS',
      cancelText: 'Keep current',
      tone: 'primary',
    })
    if (yes) onUseGps?.(gpsStr)   // the coords watcher refreshes the locale label when visible
  }

  async function handlePhotoUpload(event) {
    log('handlePhotoUpload change', { files: (event.target.files || []).length })

    const files = Array.from(event.target.files || [])
    if (!files.length) return

    // Check EXIF GPS and optionally set coords (with Yes/No-style prompt)
    try {
      await maybeApplyGpsFromPhoto(files)
    } catch (e) {
      logger.warn('ReportForm maybeApplyGpsFromPhoto error', e)
    }

    for (const raw of files) {
      const file = await ensureUploadableFile(raw)
      if (!file) continue // block HEIC
      const url = URL.createObjectURL(file)
      stagedPhotos.value.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
        url,
        rotation: 0,
      })
    }

    // clear the <input> so selecting the same file again fires change event
    try { event.target.value = '' } catch {}
    log('handlePhotoUpload … SUCCESSFUL', { staged: stagedPhotos.value.length })
  }

  function rotatePhoto(id) {
    const p = stagedPhotos.value.find(x => x.id === id)
    if (p) p.rotation = ((p.rotation || 0) + 90) % 360
  }

  function removePhoto(id) {
    const idx = stagedPhotos.value.findIndex(p => p.id === id)
    if (idx !== -1) {
      try { URL.revokeObjectURL(stagedPhotos.value[idx].url) } catch {}
      stagedPhotos.value.splice(idx, 1)
      log('removePhoto', { id, remaining: stagedPhotos.value.length })
    }
  }

  function clearStagedPhotos() {
    try {
      for (const p of stagedPhotos.value || []) URL.revokeObjectURL(p.url)
    } catch {}
    stagedPhotos.value = []
    try { if (fileInput.value) fileInput.value.value = '' } catch {}
  }

  return {
    MAX_PHOTOS, fileInput, stagedPhotos, overMax,
    openGalleryPicker, onAddPhotosClick,
    lightboxOpen, lightboxSrc, openLightbox, closeLightbox,
    handlePhotoUpload, rotatePhoto, removePhoto, clearStagedPhotos,
  }
}
