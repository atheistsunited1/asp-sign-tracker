export const ICON_TYPES = {
  REPORTED_SIGNS: 0,
  PLUNDERED: 1,
  KRAKENED: 2,
  SIGHTINGS_QUESTIONABLE: 3,
}

export const DEFAULT_COLOR_BY_KEY = Object.freeze({
  reported_major: '#FFEA00',
  reported_non_major: '#C2185B',
  plundered: '#000000',
  krakened: '#1A237E',
  questionable: '#F57C00',
})

export const ALLOWED_COLORS_BY_KEY = Object.freeze({
  reported_major: ['#FFEA00', '#FBC02D'],
  reported_non_major: ['#C2185B', '#FF5252'],
  plundered: ['#000000', '#424242', '#757575'],
  krakened: ['#1A237E', '#3949AB'],
  questionable: ['#F57C00'],
})

export const COLOR_LABELS = Object.freeze({
  '#FFEA00': 'Yellow',
  '#FBC02D': 'Yellow-Orange',
  '#C2185B': 'Burgundy',
  '#FF5252': 'Red Grapefruit',
  '#000000': 'Black',
  '#424242': 'Dark Gray',
  '#757575': 'Medium Gray',
  '#1A237E': 'Navy',
  '#3949AB': 'Royal Blue',
  '#F57C00': 'Burnt Orange',
})

export const SIGN_TYPES = Object.freeze([
  'sign',
  'sticker',
  'banner',
  'graffiti',
  'stationary',
  'cross',
  'other',
])

const ICON_TYPES_TO_REPORT = Object.freeze({
  [ICON_TYPES.PLUNDERED]: 'plundered',
  [ICON_TYPES.KRAKENED]: 'krakened',
  [ICON_TYPES.SIGHTINGS_QUESTIONABLE]: 'questionable',
  [ICON_TYPES.REPORTED_SIGNS]: 'sighting',
})

export function normalizeSignType(input = '') {
  const v = String(input || '').trim().toLowerCase()
  if (!v) return ''
  if (SIGN_TYPES.includes(v)) return v
  return 'other'
}

export function normalizeReportType(input = '') {
  const v = String(input || '').trim().toLowerCase()
  if (v.includes('plunder')) return 'plundered'
  if (v.includes('kraken')) return 'krakened'
  if (v.includes('question')) return 'questionable'
  return 'sighting'
}

export function iconTypeForReportType(reportType = '') {
  const rt = normalizeReportType(reportType)
  if (rt === 'plundered') return ICON_TYPES.PLUNDERED
  if (rt === 'krakened') return ICON_TYPES.KRAKENED
  if (rt === 'questionable') return ICON_TYPES.SIGHTINGS_QUESTIONABLE
  return ICON_TYPES.REPORTED_SIGNS
}

export function reportTypeForIconType(iconType = null) {
  if (iconType in ICON_TYPES_TO_REPORT) return ICON_TYPES_TO_REPORT[iconType]
  return 'sighting'
}

function colorKeyForPin({ iconType, isMajorCampaign = false, signType = '' } = {}) {
  if (iconType === ICON_TYPES.PLUNDERED) return 'plundered'
  if (iconType === ICON_TYPES.KRAKENED) return 'krakened'
  if (iconType === ICON_TYPES.SIGHTINGS_QUESTIONABLE) return 'questionable'
  if (isMajorCampaign) return 'reported_major'
  return 'reported_non_major'
}

// Draw order when markers overlap, back-most (0) → front-most:
// krakened, plundered, questionable, reported.
export const DRAW_PRIORITY_LEVELS = 4

export function drawPriorityForPin({ iconType } = {}) {
  if (iconType === ICON_TYPES.KRAKENED) return 0
  if (iconType === ICON_TYPES.PLUNDERED) return 1
  if (iconType === ICON_TYPES.SIGHTINGS_QUESTIONABLE) return 2
  return 3
}

export function defaultColorForPin({ iconType, isMajorCampaign = false, signType = '' } = {}) {
  const key = colorKeyForPin({ iconType, isMajorCampaign, signType })
  return DEFAULT_COLOR_BY_KEY[key] || DEFAULT_COLOR_BY_KEY.reported_non_major
}

export function allowedColorsForPin({
  iconType,
  isMajorCampaign = false,
  signType = '',
} = {}) {
  const key = colorKeyForPin({ iconType, isMajorCampaign, signType })
  return ALLOWED_COLORS_BY_KEY[key] || ALLOWED_COLORS_BY_KEY.reported_non_major
}

export function normalizeIconColorForPin({
  iconType,
  isMajorCampaign = false,
  signType = '',
  requestedColor = '',
} = {}) {
  const raw = String(requestedColor || '').trim().toUpperCase()
  const normalized = raw.startsWith('#') ? raw : (raw ? `#${raw}` : '')
  const allowed = allowedColorsForPin({ iconType, isMajorCampaign, signType })
  if (allowed.includes(normalized)) return normalized
  const fallback = defaultColorForPin({ iconType, isMajorCampaign, signType })
  if (allowed.includes(fallback)) return fallback
  return allowed[0] || fallback
}

export function colorOptionRowsForPin({
  iconType,
  isMajorCampaign = false,
  signType = '',
} = {}) {
  return allowedColorsForPin({ iconType, isMajorCampaign, signType }).map((hex) => ({
    value: hex,
    label: COLOR_LABELS[hex] || hex,
  }))
}
