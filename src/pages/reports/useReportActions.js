// Reviewer actions on the selected activity: save edits, approve (with the
// terminal-state guard), delete pending / delete approved. Composes the feed,
// the detail working copy and the lifecycle service.
import { reactive } from 'vue'
import { logger } from '@/shared/lib/logger'
import { errorToUserMessage } from '@/shared/lib/errors'
import { iconTypeForReportType, normalizeIconColorForPin } from '@/shared/domain/pinVisuals'
import { finalFromIconType, finalFromReportType, isTerminalType } from '@/shared/domain/activityLifecycle'
import { updatePinForSaveEdits, updateReportForSaveEdits, fetchReportPinLink } from '@/pages/reports/reportsService'
import {
  countActiveNonAuditReportsForPin,
  fetchLatestFinalForPin,
  fetchReportForApproval,
  insertRelocateReport,
  markReportApproved,
  softDeletePinWithAudit,
  softDeleteReport,
  syncPinLifecycleFromLatestNonAuditReport,
  updatePinForApproval,
} from '@/shared/domain/activityLifecycleService'
import { nextIdAfter } from '@/pages/reports/useReportsFeed'
import { nz } from '@/pages/reports/useReportDetail'

const DEBUG_REVIEW = String(import.meta?.env?.VITE_DEBUG_REVIEW || '').toLowerCase() === 'true'
const dlog = (...args) => { if (DEBUG_REVIEW) logger.debug('Reports debug', args) }

/**
 * @param {object} deps
 * @param {object} deps.feed      useReportsFeed instance
 * @param {object} deps.detail    useReportDetail instance
 * @param {Ref<boolean>} deps.isAdmin
 * @param {Ref} deps.user
 * @param {Function} deps.showToast
 * @param {Function} deps.confirm
 */
export function useReportActions({ feed, detail, isAdmin, user, showToast, confirm }) {
  const { editing } = detail
  const busy = reactive({})               // { [reportId]: boolean }
  const latestFinalByPin = reactive({})   // { [pin_id]: ISO date or null } — latest approved terminal activity

  const isFinalLifecycle = (t) => isTerminalType(t)
  const iconForReportType = (t) => iconTypeForReportType(t)

  async function loadLatestFinalForPin(pinId) {
    const { data, error } = await fetchLatestFinalForPin(pinId)
    if (error) throw error
    latestFinalByPin[pinId] = (data && (data[0]?.occurred_on || data[0]?.created_at)) || null
  }
  /** Called when a row is selected: warm the cache for its pin. */
  function primeLatestFinal(r) {
    if (r?.pin_id && latestFinalByPin[r.pin_id] === undefined) {
      loadLatestFinalForPin(r.pin_id).catch(() => { latestFinalByPin[r.pin_id] = null })
    }
  }

  function disableApprove(r) {
    const wantFinal = finalFromReportType(editing.report_type ?? r.report_type)
    if (!wantFinal) return false
    const latestFinalAt = r.pin_id ? latestFinalByPin[r.pin_id] : null
    if (latestFinalAt === undefined) {
      // cache miss: fall back to the pin's icon_type (unapproved pins are never "final")
      return r.pin_is_approved && finalFromIconType(r.pin_icon_type) != null
    }
    // A plunder/kraken cannot be approved if the pin already has a terminal activity on or before this activity's date.
    const subAt = new Date(r.occurred_on || r.created_at).getTime()
    const prevFinalAt = latestFinalAt ? new Date(latestFinalAt).getTime() : null
    return prevFinalAt != null && prevFinalAt <= subAt
  }
  function disabledApproveText(r) {
    const have = finalFromIconType(r.pin_icon_type)
    return have ? `Already ${have}` : 'Approve'
  }

  // ---- save edits ---------------------------------------------------------------
  async function saveEdits() {
    const row = feed.selected.value
    if (!row) return
    if (!detail.validateAndSetGsvIntoEditing()) return
    const can = feed.activeTab.value === 'approved' ? isAdmin.value : (isAdmin.value || feed.isOwner.value)
    if (!can) { showToast('You don’t have permission to update this item.', 'error'); return }
    const keepId = row.id

    detail.submitting.value = true
    try {
      const nextIconType = iconTypeForReportType(editing.report_type || row.report_type || 'sighting')
      const pinUpdate = {
        description: nz(editing.description),
        is_major_campaign: !!editing.is_major_campaign,
        sign_text: nz(editing.sign_text_edit),
        sign_type: nz(editing.sign_type_edit),
        icon_type: nextIconType,
        city: nz(editing.city),
        state: nz(editing.state),
        gsv_date: nz(editing.gsv_date),
        lat: Number.isFinite(editing.lat) ? editing.lat : row.pin_lat,
        lng: Number.isFinite(editing.lng) ? editing.lng : row.pin_lng,
        updated_at: new Date().toISOString(),
      }
      pinUpdate.icon_color = normalizeIconColorForPin({
        iconType: nextIconType,
        isMajorCampaign: !!editing.is_major_campaign,
        signType: nz(editing.sign_type_edit) ?? row.pin_sign_type ?? '',
        requestedColor: isAdmin.value ? editing.icon_color_edit : '',
      })
      const reportUpdate = { report_type: nz(editing.report_type) ?? row.report_type ?? 'sighting', updated_at: new Date().toISOString() }
      dlog('reportUpdate payload →', { reportId: row.id, reportUpdate })

      if (!row.pin_id) logger.warn('Reports saveEdits skipped pin update: missing pin_id')
      else {
        const { error: pinErr } = await updatePinForSaveEdits(row.pin_id, pinUpdate)
        if (pinErr) throw pinErr
      }
      const { error: repErr } = await updateReportForSaveEdits(row.id, reportUpdate)
      if (repErr) throw repErr

      detail.editMode.value = false
      await feed.reloadActiveTab()
      const keep = feed.listFor(feed.activeTab.value).find((x) => x.id === keepId)
      if (keep) { feed.selectReport(keep); detail.rebaseline() }
      showToast('✅ Updated', 'success')
    } catch (e) {
      logger.error('Reports saveEdits failed', e)
      showToast(errorToUserMessage(e, 'Update failed. Please try again.'), 'error')
    } finally {
      detail.submitting.value = false
    }
  }

  // ---- approve ------------------------------------------------------------------
  async function onApprove(row) {
    if (disableApprove(row)) return
    const ok = await confirm({ title: 'Approve activity?', message: 'This will publish the activity and apply current edit values.', confirmText: 'Approve', cancelText: 'Cancel', tone: 'primary' })
    if (!ok) return
    approveReport(row)
  }

  async function approveReport(reportRow) {
    if (!detail.validateAndSetGsvIntoEditing()) return
    busy[reportRow.id] = true
    detail.submitting.value = true
    try {
      const neighborId = nextIdAfter(feed.submitted.value, reportRow.id)
      const { data: sub, error: subErr } = await fetchReportForApproval(reportRow.id)
      if (subErr || !sub) throw subErr || new Error('Report not found')
      const pinRel = sub.pins && !Array.isArray(sub.pins) ? sub.pins : (Array.isArray(sub.pins) ? sub.pins[0] : null)
      if (!pinRel) throw new Error('Report has no associated pin.')

      const pickedType = (reportRow.report_type ?? sub.report_type ?? '').toLowerCase()
      const pickedNow = (editing.report_type || pickedType || '').toLowerCase()
      const finalForPin = pickedNow.includes('kraken') ? 'krakened' : pickedNow.includes('plunder') ? 'plundered' : 'sighting'
      const targetPinId = pinRel.id

      const newLat = Number.isFinite(editing.lat) ? editing.lat : pinRel.lat
      const newLng = Number.isFinite(editing.lng) ? editing.lng : pinRel.lng
      const moved = Number.isFinite(newLat) && Number.isFinite(newLng) && Number.isFinite(pinRel.lat) && Number.isFinite(pinRel.lng)
        && (Math.abs(newLat - pinRel.lat) > 1e-6 || Math.abs(newLng - pinRel.lng) > 1e-6)

      // Unapproved pins are not "final" regardless of their icon_type
      const currentFinal = pinRel.is_approved ? finalFromIconType(pinRel.icon_type) : null
      const wantFinal = isFinalLifecycle(finalForPin) ? finalForPin : null
      if (currentFinal && wantFinal && currentFinal === wantFinal) {
        showToast(`Cannot approve ${wantFinal}: pin is already ${currentFinal}.`, 'error')
        busy[reportRow.id] = false
        return
      }

      const nextSignType = nz(editing.sign_type_edit) ?? pinRel.sign_type ?? null
      const iconTypeForUpdate = isFinalLifecycle(finalForPin)
        ? iconForReportType(finalForPin)
        : (!pinRel.is_approved ? iconForReportType('sighting') : pinRel.icon_type)
      const pinUpdate = {
        lat: newLat, lng: newLng,
        description: nz(editing.description) ?? pinRel.description ?? null,
        sign_text: nz(editing.sign_text_edit) ?? pinRel.sign_text ?? null,
        sign_type: nextSignType,
        icon_type: iconTypeForUpdate,
        icon_color: normalizeIconColorForPin({ iconType: iconTypeForUpdate, isMajorCampaign: !!editing.is_major_campaign, signType: nextSignType || '', requestedColor: editing.icon_color_edit }),
        city: nz(editing.city) ?? pinRel.city ?? null,
        state: nz(editing.state) ?? pinRel.state ?? null,
        gsv_date: nz(editing.gsv_date) ?? pinRel.gsv_date ?? null,
        is_major_campaign: !!editing.is_major_campaign,
        updated_at: new Date().toISOString(),
      }
      if (pinRel.is_approved === false) { pinUpdate.is_approved = true; pinUpdate.approved_by = user?.value?.id ?? null }
      dlog('pinUpdate payload →', { targetPinId, pinUpdate })
      const { error: updPinErr } = await updatePinForApproval(targetPinId, pinUpdate)
      if (updPinErr) throw updPinErr

      if (moved && pinRel.is_approved) {
        await insertRelocateReport([{ pin_id: targetPinId, report_type: 'relocated', is_approved: true, approved_by: user?.value?.id ?? null, submitted_by: user?.value?.id ?? null }])
      }

      const { error: updRepErr } = await markReportApproved(sub.id, {
        report_type: (editing.report_type || sub.report_type || 'sighting'),
        is_approved: true,
        approved_by: user?.value?.id ?? null,
        updated_at: new Date().toISOString(),
      })
      if (updRepErr) throw updRepErr

      showToast('✅ Approved and published.', 'success')
      await feed.refreshCounts()
      feed.approved.value = []; feed.approvedOffset.value = 0; feed.approvedHasMore.value = true
      await feed.loadSubmittedPage(true)
      const keep = feed.submitted.value.find((r) => r.id === neighborId)
      if (keep) feed.selectReport(keep)
      else if (feed.submitted.value[0]) feed.selectReport(feed.submitted.value[0])
      else feed.selected.value = null
    } catch (e) {
      logger.error('Reports approveReport failed', e)
      showToast(errorToUserMessage(e, 'Approve failed. Please try again.'), 'error')
    } finally {
      busy[reportRow.id] = false
      detail.submitting.value = false
    }
  }

  // ---- delete -------------------------------------------------------------------
  async function onDeleteApproved(reportId) {
    if (!isAdmin.value) return
    const ok = await confirm({ title: 'Delete approved activity?', message: 'This activity will move to Deleted and can be restored for 30 days.', confirmText: 'Delete', cancelText: 'Cancel', tone: 'danger' })
    if (!ok) return
    busy[reportId] = true
    try {
      const { error } = await softDeleteReport(reportId)   // report only (never the approved pin)
      if (error) throw error
      showToast('Activity moved to Deleted.', 'success')
      await feed.refreshCounts()
      await feed.loadApprovedPage(true)
      const next = feed.approved.value[0] || null
      if (next) feed.selectReport(next); else feed.selected.value = null
    } catch (e) {
      logger.error('Reports delete approved failed', e)
      showToast(errorToUserMessage(e, 'Delete failed. Please try again.'), 'error')
    } finally {
      busy[reportId] = false
    }
  }

  async function onDeleteSubmitted(reportId) {
    let sub = null, deletePinToo = false
    try {
      const { data, error } = await fetchReportPinLink(reportId)
      if (error || !data) throw error || new Error('Report not found')
      sub = data
      if (sub.pin_id) {
        const { count, error: cntErr } = await countActiveNonAuditReportsForPin(sub.pin_id)
        if (cntErr) throw cntErr
        deletePinToo = (count ?? 0) <= 1
      }
    } catch (e) {
      logger.error('Reports delete precheck failed', e)
      showToast(errorToUserMessage(e, 'Delete check failed. Please try again.'), 'error')
      return
    }
    const ok = await confirm({
      title: deletePinToo ? 'Delete activity and pin?' : 'Delete pending activity?',
      message: deletePinToo
        ? 'There are no other activity entries for this pin. Deleting this activity will also move the associated pin to Deleted for 30 days. Continue to delete or go back and edit the activity instead.'
        : 'This activity will move to Deleted for 30 days. Other activity entries for this pin will remain.',
      confirmText: 'Delete', cancelText: 'Cancel', tone: 'danger',
    })
    if (!ok) return

    busy[reportId] = true
    try {
      const neighborId = nextIdAfter(feed.listFor(feed.activeTab.value), reportId)
      const { error: deleteReportErr } = await softDeleteReport(reportId)
      if (deleteReportErr) throw deleteReportErr
      if (sub?.pin_id && deletePinToo) {
        await softDeletePinWithAudit(sub.pin_id, { actorUserId: feed.currentUid.value || null, reason: 'Deleted final pending submission for pin.' })
      } else if (sub?.pin_id) {
        try { await syncPinLifecycleFromLatestNonAuditReport(sub.pin_id) } catch (syncErr) { logger.warn('Reports pin lifecycle sync after delete failed', syncErr) }
      }
      showToast(deletePinToo ? 'Activity and pin moved to Deleted.' : 'Activity moved to Deleted.', 'success')
      await feed.refreshCounts()
      await feed.loadSubmittedPage(true)
      const keep = feed.submitted.value.find((r) => r.id === neighborId)
      if (keep) feed.selectReport(keep)
      else if (feed.submitted.value[0]) feed.selectReport(feed.submitted.value[0])
      else feed.selected.value = null
    } catch (e) {
      logger.error('Reports deny/delete submission failed', e)
      showToast(errorToUserMessage(e, 'Deny failed. Please try again.'), 'error')
    } finally {
      busy[reportId] = false
    }
  }

  return { busy, latestFinalByPin, primeLatestFinal, disableApprove, disabledApproveText, isFinalLifecycle, saveEdits, onApprove, approveReport, onDeleteApproved, onDeleteSubmitted }
}
