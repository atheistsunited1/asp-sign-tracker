// src/utils/geocode.js

// Small helpers so ReportForm.vue/Map.vue can share the same logic:

function pickLocality(a = {}) {
  // prefer city/town/village/hamlet/neighbourhood in that order
  return (
    a.city ||
    a.town ||
    a.village ||
    a.hamlet ||
    a.neighbourhood ||
    a.suburb ||
    a.municipality ||
    a.county ||
    null
  );
}

function shortRegion(a = {}) {
  // Use state code if available; else state/province; else country_code
  // Nominatim address often has: state, state_district, ISO3166-2-lvl4, etc.
  // We'll try common ones first:
  return (
    a.state_code ||
    a.region ||
    a.state ||
    a.province ||
    (a.country_code ? a.country_code.toUpperCase() : null)
  );
}

function prettyPlaceFromAddress(a = {}) {
  const city  = pickLocality(a);
  const state = shortRegion(a);
  if (city && state) return `${city}, ${state}`;
  if (city) return city;
  if (state) return state;
  // last resort: a locality-ish thing
  return a.country || null;
}

/** Reverse geocode to a friendly "City, ST" (2.5s timeout, English). */
export async function reverseGeocodePlace(lat, lng) {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}` +
    `&zoom=10&addressdetails=1&accept-language=en`;

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    clearTimeout(to);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    return prettyPlaceFromAddress(j?.address ?? {});
  } catch {
    clearTimeout(to);
    return null;
  }
}

/** Reverse geocode to { city, state, country } (country = ISO2, e.g. US/CA/NZ; 2.5s timeout). */
export async function reverseGeocodeCityState(lat, lng) {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}` +
    `&zoom=10&addressdetails=1&accept-language=en`;

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    clearTimeout(to);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const a = j?.address ?? {};
    return {
      city: pickLocality(a) || null,
      state: shortRegion(a) || null,
      country: a.country_code ? String(a.country_code).toUpperCase() : null,
    };
  } catch {
    clearTimeout(to);
    return { city: null, state: null, country: null };
  }
}
