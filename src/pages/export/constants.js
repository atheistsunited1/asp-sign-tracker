// Export page vocabulary (map-legend buckets) and limits.
export const BUCKETS = Object.freeze([
  { value: 'sighting',     label: 'Sighting (still up)' },
  { value: 'plundered',    label: 'Plundered' },
  { value: 'krakened',     label: 'Krakened' },
  { value: 'questionable', label: 'Questionable legality' },
  { value: 'billboard',    label: 'Billboards' },
])

export const MAJOR_OPTIONS = Object.freeze([
  { value: 'all',     label: 'All signs' },
  { value: 'only',    label: 'Major Campaign only' },
  { value: 'exclude', label: 'Exclude Major Campaign' },
])

/** Google My Maps refuses layers above 2,000 placemarks; exports split at this size. */
export const MAX_PLACEMARKS_PER_FILE = 2000
