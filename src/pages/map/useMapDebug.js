// Console debug helpers (window.__map*).
// Extracted verbatim from MapPage.vue (issue #97 step 2). Shared map state is on
// `ctx` (see mapContext.js): other composables' members are referenced as
// `ctx.<name>`; mutable shared lets live on `ctx.state`.
import { logger } from '@/shared/lib/logger'

export function useMapDebug(ctx) {

  // 🔧 Search debug (turn on/off easily)
  const DBG_SEARCH = false

  const dlog = (...args) => { if (DBG_SEARCH) logger.debug('Map search debug', args) }

  const debugMy = () => ({
    myReportsOnly: ctx.myReportsOnly.value,
    myReportsReady: ctx.myReportsReady.value,
    size: ctx.myReportedPinIds.size,
    activeCats: [...ctx.activeCategories.value]
  })

  const tracePin = (fidOrId) => {
    // find the marker/pin by friendly id or raw id
    let pin = null
    for (const [id, m] of ctx.pinMarkerMap.entries()) {
      if (id === fidOrId || m.__friendlyId === fidOrId) { pin = ctx.pinById.get(id) || { id, friendly_id: m.__friendlyId, is_approved: m.__approved, icon_type: m.__iconType, icon_color: m.__iconColor, __latE6:m.__lat?Math.round(m.__lat*1e6):0, __lngE6:m.__lng?Math.round(m.__lng*1e6):0, __coordText6: m.__lat && m.__lng ? `${m.__lat.toFixed(6)}, ${m.__lng.toFixed(6)}`: '' }; break }
    }
    if (!pin) return logger.warn('Map tracePin not found', { fidOrId })

    const inMySet   = ctx.myReportedPinIds.has(pin.id)
    const isPending = pin.is_approved === false
    const catOn     = ctx.activeCategories.value.has(pin.icon_type)
    const searchOK  = true
    const starGate  = ctx.myReportsOnly.value
    const starReady = ctx.myReportsReady.value

    logger.debug('Map tracePin', [{
      pin_id: pin.id,
      fid: pin.friendly_id || '',
      icon_type: pin.icon_type,
      pending: isPending,
      cat_on: catOn,
      search_ok: searchOK,
      myReportsOnly: starGate,
      myReportsReady: starReady,
      inMySet
    }])

    return { pin, inMySet, isPending, catOn, searchOK, starGate, starReady }
  }

  // Try in the console: debugMatch('<pinId>')
  const debugMatch = (id) => {
    const marker = ctx.pinMarkerMap.get(id)
    const pin = ctx.pinById.get(id)
    const ok  = marker ? ctx.passesPolicyNoCategory(id, marker) : null
    logger.debug('Map search debugMatch', {
      id, ok,
      hasPin: !!pin,
      hasMarker: !!marker,
      pinSnippet: pin ? {
        id: pin.id, fid: pin.friendly_id, city: pin.city, state: pin.state,
        loc: pin.description, sign: pin.sign_text, type: pin.sign_type,
        coord: pin.__coordText6
      } : null,
      criteria: {
        query: String(ctx.remoteSearch.q || '').trim(),
        filters: {
          categories: [...ctx.activeCategories.value],
          majorCampaignOnly: ctx.majorCampaignOnly.value,
          myReportsOnly: ctx.myReportsOnly.value,
          bookmarkedOnly: ctx.bookmarkedOnly.value,
        },
      }
    })
  };

  Object.assign(ctx, { DBG_SEARCH, debugMatch, debugMy, dlog, tracePin })
  return { DBG_SEARCH, debugMatch, debugMy, dlog, tracePin }
}
