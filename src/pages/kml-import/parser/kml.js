// Minimal reader for Google My Maps KML exports. The exports are machine-generated
// and regular (Document/name, Placemark/name, description, styleUrl, Point/coordinates,
// ExtendedData/Data[name]/value), so a small text scanner is enough and keeps the
// parser pure (no DOMParser) and unit-testable in node.
import { decodeEntities } from '@/pages/kml-import/parser/text.js'

const first = (re, s) => { const m = re.exec(s); return m ? m[1] : '' }
// My Maps wraps names and ExtendedData values in CDATA; the raw text must lose
// the wrapper before use (a `]]>` left on a photo URL breaks the mirror fetch).
const unwrapCdata = (s = '') => String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
const cleanText = (s = '') => decodeEntities(unwrapCdata(s)).trim()

function parseCoordinates(raw = '') {
  const parts = String(raw).trim().split(/[\s,]+/).filter(Boolean)
  // KML is lng,lat[,alt]
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const lng = parseFloat(parts[i]), lat = parseFloat(parts[i + 1])
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng }
  }
  return null
}

function parseExtendedData(inner = '') {
  const out = {}
  for (const m of String(inner).matchAll(/<Data\s+name="([^"]+)"\s*>([\s\S]*?)<\/Data>/gi)) {
    out[m[1]] = cleanText(first(/<value>([\s\S]*?)<\/value>/i, m[2]))
  }
  return out
}

/** Parse one `<Placemark>` body. */
export function parsePlacemarkXml(inner = '') {
  const ext = parseExtendedData(inner)
  return {
    name: cleanText(first(/<name>([\s\S]*?)<\/name>/i, inner)),
    description: first(/<description>([\s\S]*?)<\/description>/i, inner),
    styleUrl: first(/<styleUrl>([\s\S]*?)<\/styleUrl>/i, inner).trim(),
    coordinates: parseCoordinates(first(/<coordinates>([\s\S]*?)<\/coordinates>/i, inner)),
    photos: (ext.gx_media_links || '').split(/\s+/).filter((u) => /^https?:\/\//i.test(u)),
  }
}

/**
 * KML text → `{ layerName, placemarks }`. The layer name is the Document name
 * (a single-layer My Maps export), falling back to the first Folder name.
 */
export function parseKmlDocument(text = '') {
  const s = String(text)
  if (!/<kml[\s>]/i.test(s) || !/<Placemark[\s>]/i.test(s)) {
    throw new Error('Not a KML file with Placemarks.')
  }
  const layerName = cleanText(
    first(/<Document\b[^>]*>\s*<name>([\s\S]*?)<\/name>/i, s) || first(/<Folder\b[^>]*>\s*<name>([\s\S]*?)<\/name>/i, s)
  )
  const placemarks = []
  for (const m of s.matchAll(/<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi)) placemarks.push(parsePlacemarkXml(m[1]))
  return { layerName, placemarks }
}
