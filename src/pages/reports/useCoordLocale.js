// Reports detail card: the shared coord-locale lookup (with city/state) plus
// the "use this place as City/State" action on the editing draft (#74).
import { useCoordLocale as useSharedCoordLocale } from '@/shared/domain/useCoordLocale'

export function useCoordLocale({ editing, showToast }) {
  const locale = useSharedCoordLocale({ withCityState: true })

  function useLocaleForCityState() {
    const nextCity = (locale.geoCity.value ?? '').trim()
    const nextState = (locale.geoState.value ?? '').trim()
    if (!nextCity && !nextState) { showToast('⚠️ No city/state available for these coordinates.', 'info'); return }
    editing.city = nextCity
    editing.state = nextState
    showToast(`📍 Set location to${nextCity ? ' ' + nextCity : ''}${nextState ? (nextCity ? ', ' : ' ') + nextState : ''}`, 'success')
  }

  return { ...locale, useLocaleForCityState }
}
