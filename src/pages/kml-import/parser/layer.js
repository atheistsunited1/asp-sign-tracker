// Layer detection from the My Maps layer (Document) name. The layer decides the
// pin's lifecycle state (icon_type), whether it's a Major Campaign, and for the
// Billboards layer the sign type. Pure.
import { ICON_TYPES } from '@/shared/domain/pinVisuals.js'

export const LAYER_KINDS = Object.freeze([
  { value: 'reported',     label: 'Reported Signs',                    iconType: ICON_TYPES.REPORTED_SIGNS },
  { value: 'billboard',    label: 'Billboards',                        iconType: ICON_TYPES.REPORTED_SIGNS, signType: 'billboard' },
  { value: 'plundered',    label: 'Plundered',                         iconType: ICON_TYPES.PLUNDERED, terminalType: 'plundered' },
  { value: 'krakened',     label: 'Krakened (removed, not by ASP)',    iconType: ICON_TYPES.KRAKENED, terminalType: 'krakened' },
  { value: 'questionable', label: 'Sightings of Questionable Legality', iconType: ICON_TYPES.SIGHTINGS_QUESTIONABLE, sightingType: 'questionable' },
])

export function layerKind(value) {
  return LAYER_KINDS.find((k) => k.value === value) || null
}

/** `{ kind, isMajorCampaign }` from a layer name; `kind` is null when unrecognised. */
export function detectLayer(name = '') {
  const n = String(name).toLowerCase()
  let kind = null
  if (/plunder/.test(n)) kind = 'plundered'
  else if (/kraken|removed/.test(n)) kind = 'krakened'
  else if (/questionable/.test(n)) kind = 'questionable'
  else if (/billboard/.test(n)) kind = 'billboard'
  else if (/report|sighting/.test(n)) kind = 'reported'
  return { kind, isMajorCampaign: /\bmajor\b/.test(n) }
}
