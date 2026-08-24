// Soft-deleted pins: paged list, selection + that pin's deleted activities,
// and the two one-click actions (restore everything restorable / purge).
// Used by the Reports "Deleted" tab and the Deleted pins page; the page adds
// the per-activity restore preview on top.
import { ref, computed } from 'vue'
import { fetchDeletedPinsPage, fetchDeletedReportsByPin } from '@/shared/domain/deletedPinsService'
import { restoreDeletedPin, forceDeletePinNow } from '@/shared/domain/activityLifecycleService'
import { removePhotoKeys } from '@/shared/data/photoStorage'
import { isAuditType, validateRestoreOrder } from '@/shared/domain/activityLifecycle'
import { errorToUserMessage } from '@/shared/lib/errors'
import { logger } from '@/shared/lib/logger'

/**
 * @param {object} deps
 * @param {Ref<boolean>} deps.isAdmin        mapmaster/admin gate
 * @param {() => string|null} deps.actorId   current user id
 * @param {() => object} deps.getFilters     { q, city, state, deletedFrom?, deletedTo? }
 * @param {number} deps.pageSize
 * @param {Function} deps.showToast
 * @param {Function} deps.confirm
 * @param {{ onSelect?: (pin) => void, afterMutation?: () => Promise<void> }} [deps.hooks]
 */
export function useDeletedPins({ isAdmin, actorId, getFilters, pageSize = 100, showToast, confirm, hooks = {} }) {
  const deletedPins = ref([])
  const deletedTotal = ref(null)
  const deletedOffset = ref(0)
  const deletedHasMore = ref(true)
  const loadingDeleted = ref(false)
  const loadingMoreDeleted = ref(false)
  const deletedListEl = ref(null)
  const selectedDeleted = ref(null)
  const selectedDeletedId = computed(() => selectedDeleted.value?.id ?? null)
  const deletedReports = ref([])
  const loadingDeletedReports = ref(false)
  const busyDeleted = ref(false)

  function clearDeletedSelection() {
    selectedDeleted.value = null
    deletedReports.value = []
  }

  /**
   * Load the next page (or the first page when `reset`). With `keepSelection`
   * a reset keeps the selected pin if it is still in the fresh list.
   */
  async function loadDeletedPage(reset = false, { keepSelection = false } = {}) {
    if (!isAdmin.value) return
    const keepId = keepSelection ? selectedDeleted.value?.id : null
    if (reset) {
      deletedPins.value = []
      deletedOffset.value = 0
      deletedHasMore.value = true
      if (!keepSelection) clearDeletedSelection()
    }
    if (!deletedHasMore.value || loadingMoreDeleted.value) return
    loadingMoreDeleted.value = true
    if (deletedOffset.value === 0) loadingDeleted.value = true
    try {
      const { data, count, error } = await fetchDeletedPinsPage({
        from: deletedOffset.value,
        to: deletedOffset.value + pageSize - 1,
        filters: getFilters(),
      })
      if (error) throw error
      const rows = Array.isArray(data) ? data : []
      deletedPins.value.push(...rows)
      deletedOffset.value += rows.length
      if (typeof count === 'number') deletedTotal.value = count
      if (rows.length < pageSize) deletedHasMore.value = false
      if (keepId) {
        const latest = deletedPins.value.find((p) => p.id === keepId)
        if (latest) selectedDeleted.value = latest
        else clearDeletedSelection()
      }
    } catch (e) {
      logger.error('useDeletedPins load failed', e)
      showToast(errorToUserMessage(e, 'Failed to load deleted pins.'), 'error')
      deletedHasMore.value = false
    } finally {
      loadingMoreDeleted.value = false
      loadingDeleted.value = false
    }
  }

  async function selectDeletedPin(pin) {
    selectedDeleted.value = pin
    deletedReports.value = []
    hooks.onSelect?.(pin)
    loadingDeletedReports.value = true
    try {
      const { data, error } = await fetchDeletedReportsByPin(pin.id)
      if (error) throw error
      if (selectedDeleted.value?.id !== pin.id) return   // selection moved on
      deletedReports.value = Array.isArray(data) ? data : []
    } catch (e) {
      logger.error('useDeletedPins load reports failed', e)
      showToast(errorToUserMessage(e, 'Failed to load deleted activity.'), 'error')
    } finally {
      loadingDeletedReports.value = false
    }
  }

  async function afterMutation() {
    await hooks.afterMutation?.()
  }

  /** Restore the pin with all of its restorable (non-audit) activity, as approved. */
  async function restoreSelectedDeleted() {
    const pin = selectedDeleted.value
    if (!pin || !isAdmin.value) return
    const actor = actorId()
    if (!actor) { showToast('Session missing. Please sign in again.', 'error'); return }

    const restorable = deletedReports.value.filter((r) => !isAuditType(r?.report_type))
    if (!restorable.length) {
      showToast('Nothing to restore: this pin has no deleted activity. Use Advanced restore to add a new activity.', 'info')
      return
    }
    if (!validateRestoreOrder(restorable).ok) {
      showToast('Cannot restore: a terminal activity (plundered/krakened) is followed by later activity. Use Advanced restore to pick which activity to restore.', 'error')
      return
    }
    const ok = await confirm({
      title: 'Restore this pin?',
      message: `Pin ${pin.friendly_id} and ${restorable.length} deleted activit${restorable.length === 1 ? 'y' : 'ies'} will be restored to the map as approved.`,
      confirmText: 'Restore', cancelText: 'Cancel', tone: 'primary',
    })
    if (!ok) return

    busyDeleted.value = true
    try {
      await restoreDeletedPin({ pinId: pin.id, actorUserId: actor, selectedDeletedReportIds: restorable.map((r) => r.id) })
      showToast('Pin restored.', 'success')
      await afterMutation()
    } catch (e) {
      logger.error('useDeletedPins restore failed', e)
      showToast(errorToUserMessage(e, 'Restore failed. Please try again.'), 'error')
    } finally {
      busyDeleted.value = false
    }
  }

  /** Hard-delete the pin, its activity and photos. */
  async function purgeSelectedDeleted() {
    const pin = selectedDeleted.value
    if (!pin || !isAdmin.value) return
    const ok = await confirm({
      title: 'Permanently delete this pin?',
      message: `Pin ${pin.friendly_id}, all of its activity and photos will be erased. This cannot be undone.`,
      confirmText: 'Purge permanently', cancelText: 'Cancel', tone: 'danger',
    })
    if (!ok) return

    busyDeleted.value = true
    try {
      const { photoPaths } = await forceDeletePinNow(pin.id)
      if (photoPaths?.length) {
        await removePhotoKeys(photoPaths).catch((e) => logger.warn('useDeletedPins storage cleanup warning (pin purge)', e))
      }
      showToast('Pin permanently deleted.', 'success')
      await afterMutation()
    } catch (e) {
      logger.error('useDeletedPins purge failed', e)
      showToast(errorToUserMessage(e, 'Purge failed. Please try again.'), 'error')
    } finally {
      busyDeleted.value = false
    }
  }

  return {
    deletedPins, deletedTotal, deletedOffset, deletedHasMore, loadingDeleted, loadingMoreDeleted, deletedListEl,
    selectedDeleted, selectedDeletedId, deletedReports, loadingDeletedReports, busyDeleted,
    clearDeletedSelection, loadDeletedPage, selectDeletedPin, restoreSelectedDeleted, purgeSelectedDeleted,
  }
}
