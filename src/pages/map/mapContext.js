// The Map page's shared context. MapPage.vue creates one per page instance and
// passes it to every map composable; each composable registers its members on
// it (Object.assign) and reads the others' through it. `state` holds the few
// mutable values (the Leaflet map instance, in-flight controllers, counters)
// that more than one composable assigns.
// Injection key: MapPage provides the finished context so its template
// components (GoToDock, LegendPanel, SearchTray) can read it (#131).
export const MAP_CTX = Symbol('map-ctx')

export function createMapContext(page) {
  return {
    ...page,                               // route, router, showToast, confirm, log, canModerate, supabasePins, currentUser
    state: {
      map: null,
      _lastPointerDownLL: null,
      urlTargeted: false,
      tempPinSeq: 0,
      goToAddressAbort: null,
      remoteSearchAbortCtrl: null,
      remoteSearchDebounceTimer: null,
      goToTemporaryPinId: null,
      locationLayer: null,
      lastZoomBucket: -1,
      openPopups: 0,
    },
  }
}
