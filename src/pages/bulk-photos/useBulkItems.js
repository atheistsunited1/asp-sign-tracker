// Bulk photos: the picked photos and their per-photo drafts — pick (EXIF GPS
// prefill), select, remove, copy/paste fields, coordinates (parse, GPS restore,
// locale label), rotate, and the edit/readonly flow after submit.
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import exifr from 'exifr'
import { isSafeImageFile } from '@/shared/lib/photoUtils'
import { parseCoords, parseCoordsFlexible, formatCoords, clampLat, normalizeLng } from '@/shared/lib/coords'
import { useCoordLocale } from '@/shared/domain/useCoordLocale'

/**
 * @param {{ showToast: Function, closeSuggest?: Function }} deps  closeSuggest hides the page's autosuggest list on select
 */
export function useBulkItems({ showToast, closeSuggest }) {
  const fileInput = ref(null)
  // items: [{ id, file, url, rotation, exifLat, exifLng, draft, submitted, photoPending,
  //           photoPath, pinId, reportId, pinEditable, isMajor }]
  const items = ref([])
  const selectedId = ref(null)

  // Copy/Paste buffer: sign text + activity type + sign type only.
  const copyBuffer = ref(null)

  // edit/readonly flow after submit
  const editMode = ref(false)
  const editSnapshot = ref(null)

  // ======= Derived =======
  const current = computed(() => items.value.find(i => i.id === selectedId.value) || null)
  const draft = computed(() => current.value?.draft || null)
  const readonly = computed(() => {
    const it = current.value
    if (!it) return false
    return it.submitted && !editMode.value
  })
  const editDirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(editSnapshot.value || {}))
  const canSubmit = computed(() => {
    const d = draft.value
    if (!d) return false
    if (!d.reportType || !d.signType || !d.signText?.trim()) return false
    return !!parseCoords(d.coords)
  })
  // Adapter so the per-item draft's signText can drive useAutosuggest,
  // which expects a { value } model ref.
  const signTextModel = computed({
    get: () => draft.value?.signText ?? '',
    set: (v) => { if (draft.value) draft.value.signText = v },
  })
  const coordsMatchExif = computed(() => {
    const it = current.value
    if (!it || !hasGps(it)) return false
    return (draft.value?.coords || '').trim() === formatCoords(it.exifLat, it.exifLng)
  })

  // ======= UI helpers =======
  function baseName(n = '') {
    const s = String(n)
    const k = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
    return k >= 0 ? s.slice(k + 1) : s
  }
  function bytes(n) {
    if (!Number.isFinite(n)) return '—'
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / 1024 / 1024).toFixed(1)} MB`
  }
  function hasGps(it) { return Number.isFinite(it?.exifLat) && Number.isFinite(it?.exifLng) }

  function newDraft() {
    return { reportType: 'sighting', signText: '', signType: '', locationDescription: '', coords: '' }
  }

  // ======= File picking =======
  function pickPhotos() { fileInput.value?.click() }

  async function onPickFiles(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return

    let skipped = 0
    for (const file of files) {
      const safe = isSafeImageFile(file)
      if (!safe.ok) { skipped += 1; continue }

      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const url = URL.createObjectURL(file)
      const entry = {
        id, file, url,
        rotation: 0,
        exifLat: null, exifLng: null,
        draft: newDraft(),
        submitted: false,
        photoPending: false,
        photoPath: null,
        pinId: null,
        reportId: null,
        pinEditable: true,
        isMajor: false,
      }
      items.value.push(entry)

      // Parse EXIF GPS best-effort; prefill coords if the user hasn't typed any.
      try {
        const gps = await exifr.gps(file)
        if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
          entry.exifLat = clampLat(gps.latitude)
          entry.exifLng = normalizeLng(gps.longitude)
          if (!entry.draft.coords) entry.draft.coords = formatCoords(entry.exifLat, entry.exifLng)
        }
      } catch { /* ignore */ }
    }

    if (skipped) showToast(`⚠️ Skipped ${skipped} non-image or oversized file(s).`, 'warn')

    if (!selectedId.value && items.value[0]) {
      selectItem(items.value[0].id)
    }
  }

  // ======= Selection =======
  function selectItem(id) {
    selectedId.value = id
    const it = items.value.find(x => x.id === id)
    if (!it) return
    try { closeSuggest?.() } catch {}
    editMode.value = false
    editSnapshot.value = it.submitted ? JSON.parse(JSON.stringify(it.draft)) : null
    updateCoordLocaleFromText()
    scrollCheckedChipsIntoView()
  }

  // The restored draft's selections may sit off-screen in the scrollable chip
  // rails — bring them into view when switching photos.
  function scrollCheckedChipsIntoView() {
    nextTick(() => {
      try {
        for (const el of document.querySelectorAll('.bulk-photo-reports .seg input:checked')) {
          el.parentElement?.scrollIntoView({ block: 'nearest', inline: 'center' })
        }
      } catch {}
    })
  }

  function removeItem(id) {
    const idx = items.value.findIndex(x => x.id === id)
    if (idx === -1) return
    const removed = items.value[idx]
    try { if (removed?.url) URL.revokeObjectURL(removed.url) } catch {}
    items.value.splice(idx, 1)
    if (selectedId.value === id) {
      selectedId.value = null
      editMode.value = false
      editSnapshot.value = null
      locale.resetCoordLocale()
    }
    showToast('Photo removed.', 'success')
  }

  // ======= Copy/Paste (sign text, activity type, sign type only) =======
  function copyFields() {
    const d = draft.value
    if (!d) return
    copyBuffer.value = { signText: d.signText, reportType: d.reportType, signType: d.signType }
    showToast('Fields copied.', 'success')
  }
  function pasteFields() {
    const d = draft.value
    if (!d || !copyBuffer.value) return
    d.signText = copyBuffer.value.signText
    d.reportType = copyBuffer.value.reportType
    d.signType = copyBuffer.value.signType
  }

  // ======= Coordinates =======
  const locale = useCoordLocale()
  const coordPlace = locale.coordPlace
  function updateCoordLocaleFromText() {
    const p = parseCoords(draft.value?.coords || '')
    locale.updateCoordLocale(p?.lat ?? NaN, p?.lng ?? NaN)
  }
  function onCoordsChange() {
    const d = draft.value
    if (!d) return
    const parsed = parseCoordsFlexible(d.coords)
    if (parsed) d.coords = formatCoords(parsed.lat, parsed.lng)
    updateCoordLocaleFromText()
  }
  function rotateCurrent() {
    const it = current.value
    if (!it) return
    it.rotation = ((it.rotation || 0) + 90) % 360
  }
  function restoreGps() {
    const it = current.value
    if (!it || !hasGps(it) || !it.draft) return
    it.draft.coords = formatCoords(it.exifLat, it.exifLng)
    updateCoordLocaleFromText()
  }
  async function copyCoords() {
    try {
      await navigator.clipboard.writeText(draft.value?.coords || '')
      showToast('Coordinates copied.', 'success')
    } catch {
      showToast('Could not copy coords', 'error')
    }
  }
  function mapsLinkFrom(s = '') {
    const p = parseCoords(s)
    if (!p) return '#'
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${formatCoords(p.lat, p.lng).replace(' ', '')}`)}`
  }
  watch(() => draft.value?.coords, () => { updateCoordLocaleFromText() })

  // ======= Edit / Update flow after submitted =======
  function enterEdit() {
    editMode.value = true
    editSnapshot.value = JSON.parse(JSON.stringify(draft.value))
  }
  function cancelEdit() {
    const it = current.value
    if (it && editSnapshot.value) it.draft = JSON.parse(JSON.stringify(editSnapshot.value))
    editMode.value = false
  }
  /** After a successful submit/update: readonly again with the saved draft as the snapshot. */
  function markSaved(it) {
    editMode.value = false
    if (current.value === it) editSnapshot.value = JSON.parse(JSON.stringify(it.draft))
  }

  // ======= Cleanup =======
  onBeforeUnmount(() => {
    try {
      for (const it of items.value) { if (it?.url) URL.revokeObjectURL(it.url) }
    } catch {}
  })

  return {
    fileInput, items, selectedId, copyBuffer, editMode, editSnapshot,
    current, draft, readonly, editDirty, canSubmit, signTextModel, coordsMatchExif,
    baseName, bytes, hasGps, pickPhotos, onPickFiles, selectItem, removeItem, copyFields, pasteFields,
    coordPlace, onCoordsChange, rotateCurrent, restoreGps, copyCoords, mapsLinkFrom,
    enterEdit, cancelEdit, markSaved,
  }
}
