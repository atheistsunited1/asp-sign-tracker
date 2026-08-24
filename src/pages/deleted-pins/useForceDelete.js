// "Force delete" (hard delete) of a deleted pin or one deleted activity, behind
// a type-DELETE confirmation.
import { ref, reactive } from 'vue'
import { forceDeletePinNow, forceDeleteReportNow } from '@/shared/domain/activityLifecycleService'
import { removePhotoKeys } from '@/shared/data/photoStorage'
import { errorToUserMessage } from '@/shared/lib/errors'
import { logger } from '@/shared/lib/logger'

/**
 * @param {{ selectedPin: Ref, showToast: Function, afterPinDeleted: () => Promise<void>, afterReportDeleted: (pinId) => Promise<void> }} deps
 */
export function useForceDelete({ selectedPin, showToast, afterPinDeleted, afterReportDeleted }) {
  const forceDeleteModal = reactive({ open: false, mode: '', pinId: '', reportId: '', message: '', confirmText: '' })
  const busyForceDelete = ref(false)

  function openForceDeletePin() {
    const pin = selectedPin.value
    if (!pin?.id) return
    Object.assign(forceDeleteModal, {
      open: true, mode: 'pin', pinId: pin.id, reportId: '', confirmText: '',
      message: `Permanently delete pin ${pin.friendly_id || pin.id} and all associated activity/photos. This cannot be undone.`,
    })
  }
  function openForceDeleteReport(report) {
    Object.assign(forceDeleteModal, {
      open: true, mode: 'report', pinId: selectedPin.value?.id || '', reportId: report?.id || '', confirmText: '',
      message: `Permanently delete report ${report?.id || ''} and all associated photos. This cannot be undone.`,
    })
  }
  function closeForceDeleteModal() {
    Object.assign(forceDeleteModal, { open: false, mode: '', pinId: '', reportId: '', message: '', confirmText: '' })
  }

  async function confirmForceDelete() {
    if (forceDeleteModal.confirmText !== 'DELETE') { showToast('Type DELETE exactly to continue.', 'error'); return }
    busyForceDelete.value = true
    try {
      if (forceDeleteModal.mode === 'pin') {
        const { photoPaths } = await forceDeletePinNow(forceDeleteModal.pinId)
        if (photoPaths?.length) await removePhotoKeys(photoPaths).catch((e) => logger.warn('DeletedPins storage cleanup warning (pin force delete)', e))
        showToast('Pin permanently deleted.', 'success')
        closeForceDeleteModal()
        await afterPinDeleted()
        return
      }
      if (forceDeleteModal.mode === 'report') {
        const pinId = forceDeleteModal.pinId
        const { photoPaths } = await forceDeleteReportNow(forceDeleteModal.reportId)
        if (photoPaths?.length) await removePhotoKeys(photoPaths).catch((e) => logger.warn('DeletedPins storage cleanup warning (report force delete)', e))
        showToast('Activity permanently deleted.', 'success')
        closeForceDeleteModal()
        if (pinId) await afterReportDeleted(pinId)
      }
    } catch (e) {
      logger.error('DeletedPins force delete failed', e)
      showToast(errorToUserMessage(e, 'Force delete failed. Please try again.'), 'error')
    } finally {
      busyForceDelete.value = false
    }
  }

  return { forceDeleteModal, busyForceDelete, openForceDeletePin, openForceDeleteReport, closeForceDeleteModal, confirmForceDelete }
}
