// Reverse-geocode label for a coordinate being edited ("Coordinates - City, ST")
// plus the city/state it resolves to. Stale responses are ignored (sequence
// token); `resetCoordLocale()` cancels an in-flight lookup. Used by the report
// form, bulk photos and the Reports detail card.
import { ref, computed } from 'vue'
import { reverseGeocodePlace, reverseGeocodeCityState } from '@/shared/domain/geocode'

export function useCoordLocale({ withCityState = false } = {}) {
  const coordPlace = ref(undefined)   // undefined = loading/not attempted; null = unknown; string = place
  const geoCity = ref(null)
  const geoState = ref(null)
  let geocodeSeq = 0

  async function updateCoordLocale(lat, lng) {
    coordPlace.value = undefined
    geoCity.value = null
    geoState.value = null
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { coordPlace.value = null; return }
    const seq = ++geocodeSeq
    const [place, cs] = await Promise.all([
      reverseGeocodePlace(lat, lng),
      withCityState ? reverseGeocodeCityState(lat, lng) : Promise.resolve(null),
    ])
    if (seq !== geocodeSeq) return
    coordPlace.value = place ?? null
    geoCity.value = cs?.city ?? null
    geoState.value = cs?.state ?? null
  }

  function resetCoordLocale() {
    geocodeSeq += 1
    coordPlace.value = undefined
    geoCity.value = null
    geoState.value = null
  }

  const coordHint = computed(() => {
    const c = (geoCity.value || '').trim(), s = (geoState.value || '').trim()
    if (c && s) return `${c}, ${s}`
    return c || s || ''
  })

  return { coordPlace, geoCity, geoState, coordHint, updateCoordLocale, resetCoordLocale }
}
