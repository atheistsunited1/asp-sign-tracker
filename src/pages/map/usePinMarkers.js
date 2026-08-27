// Marker construction: category -> colour, canvas shape icons, radius by zoom, pin rows -> pin objects.
// Extracted verbatim from MapPage.vue. Shared map state is on
// `ctx` (see mapContext.js): other composables' members are referenced as
// `ctx.<name>`; mutable shared lets live on `ctx.state`.
import { h } from 'vue'
import L from 'leaflet'
import { clampLat, normalizeLng } from '@/shared/lib/coords'
import {
  colorOptionRowsForPin,
  defaultColorForPin,
  DRAW_PRIORITY_LEVELS,
  drawPriorityForPin,
  normalizeIconColorForPin,
  normalizeSignType,
} from '@/shared/domain/pinVisuals'

export function usePinMarkers(ctx) {
  const S = ctx.state

  function categoryValueForMarker(marker) {
    return marker.__iconType
  }

  function resolvedColorForPin(pin) {
    const raw = String(pin?.icon_color || '').trim().toUpperCase()
    const normalized = raw ? (raw.startsWith('#') ? raw : `#${raw}`) : ''
    if (/^#[0-9A-F]{6}$/.test(normalized)) return normalized
    return defaultColorForPin({
      iconType: pin?.icon_type,
      isMajorCampaign: ctx.isMajorCampaign(pin),
      signType: pin?.sign_type,
    })
  }

  const ZOOM_BUMP_THRESHOLD = 10

  const ZOOM_BUMP_FACTOR = 1.3

  S.lastZoomBucket = -1

  function applyRadius(marker) {
    const base = marker.__baseRadius || 6;
    const z = S.map.getZoom();
    const bump = z >= ZOOM_BUMP_THRESHOLD ? ZOOM_BUMP_FACTOR : 1;

    const want = Math.round(base * bump);
    if (marker.getRadius && marker.getRadius() !== want) {
      marker.setRadius(want);
    }
  }

  function updateAllRadii() {
    for (const m of ctx.pinMarkerMap.values()) applyRadius(m)
    if (S.locationLayer?.dot) applyRadius(S.locationLayer.dot)
  }

  // Helpers to align submission dot colors with pin categories
  function normalizeReportType(t = '') {
    return String(t || '').trim().toLowerCase()
  }

  function categoryForReportType(t = '') {
    const rt = normalizeReportType(t)
    if (rt.includes('plunder')) return ctx.ICON_TYPES.PLUNDERED
    if (rt.includes('kraken'))  return ctx.ICON_TYPES.KRAKENED
    if (rt.includes('question')) return ctx.ICON_TYPES.SIGHTINGS_QUESTIONABLE // e.g., "questionable", "questionable_legality"
    // default “report/sighting/other” → Reported
    return ctx.ICON_TYPES.REPORTED_SIGNS
  }

  // Consistent thin stroke for all markers
  const STROKE_W = 1.2

  const STROKE_DARK = '#2B3740'

  const BASE_HEX = {
    [ctx.ICON_TYPES.REPORTED_SIGNS]: '#FFEA00',
    [ctx.ICON_TYPES.PLUNDERED]: '#000000',
    [ctx.ICON_TYPES.KRAKENED]: '#1A237E',
    [ctx.ICON_TYPES.SIGHTINGS_QUESTIONABLE]: '#F57C00',
  }

  function colorForCategory(cat) {
    const fill = BASE_HEX[cat] || '#4E5A66'
    // Match main pin rule:
    const stroke =
      (cat === ctx.ICON_TYPES.REPORTED_SIGNS ||
       cat === ctx.ICON_TYPES.SIGHTINGS_QUESTIONABLE)
        ? STROKE_DARK
        : '#ffffff'
    return { fill, stroke }
  }

  function colorForPin(pin) {
    const fill = resolvedColorForPin(pin)
    const fillOpacity = 0.95

    // Stroke rules (explicit):
    const stroke =
      (pin.icon_type === ctx.ICON_TYPES.REPORTED_SIGNS ||
       pin.icon_type === ctx.ICON_TYPES.SIGHTINGS_QUESTIONABLE)
        ? STROKE_DARK
        : '#ffffff'
    return {
      fill,
      stroke,
      fillOpacity,
    }
  }

  function safeLatLng(lat, lng) {
    return L.latLng(clampLat(lat), normalizeLng(lng));
  }

  // --- Canvas shape marker: circle | square | diamond | hrect (screen-space, like CircleMarker)
  L.ShapeMarker = L.CircleMarker.extend({
    initialize(latlng, options = {}) {
      const opts = { shape: 'circle', ...options };
      L.CircleMarker.prototype.initialize.call(this, latlng, opts);
    },
    setShape(shape) { this.options.shape = shape || 'circle'; return this.redraw(); },

    // draw using Canvas renderer so it animates exactly like CircleMarker
    _updatePath() {
      const r  = this._radius;
      const p  = this._point;
      const ctx = this._renderer && this._renderer._ctx;
      if (!ctx || !p) return;

      // Shape scale tweaks to keep visual area roughly consistent.
      const shape = this.options.shape || 'circle';
      const scale =
        (shape === 'square') ? 0.90 :
        (shape === 'diamond') ? 1.05 :
        (shape === 'hrect') ? 0.95 :
        1;
      const rr = r * scale;
      const ringColor = this.options.ringColor || null;
      const ringWidth = Number(this.options.ringWeight || 0);
      const ringGap = Number(this.options.ringGap || 0);

      const drawShape = (radius) => {
        if (shape === 'square') {
          // axis-aligned square around the screen point
          const x = p.x - radius, y = p.y - radius, d = radius * 2;
          ctx.rect(x, y, d, d);
        } else if (shape === 'diamond') {
          // rotated square (diamond) around the screen point
          ctx.moveTo(p.x,         p.y - radius);
          ctx.lineTo(p.x + radius, p.y);
          ctx.lineTo(p.x,         p.y + radius);
          ctx.lineTo(p.x - radius, p.y);
          ctx.closePath();
        } else if (shape === 'hrect') {
          // horizontal rectangle shape
          const w = radius * 2.4;
          const h = radius * 1.2;
          ctx.rect(p.x - w / 2, p.y - h / 2, w, h);
        } else {
          // circle fallback (native CircleMarker arc)
          ctx.arc(p.x, p.y, radius, 0, Math.PI * 2, false);
        }
      }

      if (ringColor && ringWidth > 0) {
        ctx.save();
        ctx.beginPath();
        drawShape(rr + ringGap + ringWidth * 0.5);
        ctx.lineWidth = ringWidth;
        ctx.strokeStyle = ringColor;
        ctx.stroke();
        ctx.restore();
      }

      ctx.beginPath();
      drawShape(rr);
      // let Leaflet do the style application (fill/stroke)
      this._renderer._fillStroke(ctx, this);
    },

    // hit-testing to match the drawn shape
    _containsPoint(pt) {
      const shape = this.options.shape || 'circle';
      const r  = this._radius * ((shape === 'circle') ? 1 : (shape === 'hrect' ? 0.95 : 0.85));
      const dx = Math.abs(pt.x - this._point.x);
      const dy = Math.abs(pt.y - this._point.y);

      if (shape === 'square') {
        return dx <= r && dy <= r;
      }
      if (shape === 'diamond') {
        // Manhattan distance inside diamond
        return (dx + dy) <= r;
      }
      if (shape === 'hrect') {
        const w = r * 2.4
        const h = r * 1.2
        return dx <= (w / 2) && dy <= (h / 2)
      }
      // circle: defer to base implementation
      return L.CircleMarker.prototype._containsPoint.call(this, pt);
    }
  });

  L.shapeMarker = function(latlng, options) { return new L.ShapeMarker(latlng, options); };
  async function createMarkerWithIcon(pin) {
    const c = colorForPin(pin);
    const baseR = 8;
    const factor = S.map && S.map.getZoom() >= ZOOM_BUMP_THRESHOLD ? ZOOM_BUMP_FACTOR : 1;
    const pending = !isApprovedPin(pin)

    // choose shape by category
    let shape = 'circle';
    if (pin.icon_type === ctx.ICON_TYPES.PLUNDERED) shape = 'diamond';
    else if (pin.icon_type === ctx.ICON_TYPES.KRAKENED) shape = 'square';
    // reported + questionable stay circles

    const marker = L.shapeMarker([pin.lat, pin.lng], {
      radius: Math.round(baseR * factor),   // screen-space radius (ShapeMarker handles 0.85 scaling)
      shape,
      color: c.stroke,
      weight: STROKE_W,
      fillColor: c.fill,
      fillOpacity: c.fillOpacity ?? 0.95,
      ringColor: pending ? '#111111' : null,
      ringWeight: pending ? 2 : 0,
      ringGap: pending ? 0.6 : 0,
      pane: 'markerPane',                   // same pane you already use
      // rely on map's default Canvas renderer (preferCanvas: true)
      interactive: true,
    });

    marker.__baseRadius = baseR;
    marker.__lat = pin.lat;
    marker.__lng = pin.lng;
    marker.__iconType = pin.icon_type;
    marker.__signType = pin.sign_type || '';
    marker.__drawPriority = drawPriorityForPin({ iconType: pin.icon_type });
    marker.__iconColor = pin.icon_color || '';
    marker.__approved = !pending;
    marker.__friendlyId = pin.friendly_id || '';
    marker.__locDesc    = pin.description || '';
    return marker;
  }

  function buildPinFromRow(row) {
    const lat = +row.lat, lng = +row.lng
    const pin = {
      id: row.id,                         // pins.id
      kind: row.is_approved ? 'approved' : 'pending',
      report_id: null,                    // (Stage 2 will hook photos differently for pending)

      friendly_id: row.friendly_id || '',
      lat, lng,
      icon_type: row.icon_type,
      icon_color: row.icon_color || null,
      description: row.description || '',
      is_major_campaign: !!row.is_major_campaign,  
      sign_text: row.sign_text || '',
      sign_type: row.sign_type || '',
      city: row.city || '',
      state: row.state || '',
      zip: row.zip || '',
      country: ctx.inferredCountryForPin(row),
      created_at: row.created_at,
      updated_at: row.updated_at,

      __coordText6: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
      __latE6: Math.round(lat * 1e6),
      __lngE6: Math.round(lng * 1e6),
      __all: `${row.id} ${row.friendly_id || ''} ${row.description || ''} ${row.sign_text || ''} ${row.sign_type || ''} ${row.city || ''} ${row.state || ''} ${row.zip || ''} ${ctx.inferredCountryForPin(row)}`.toLowerCase().trim(),
    }
    return pin
  }

  // Pending/approved helper
  function isApprovedPin(pin) {
    // Stage 1 set pin.kind; we also future-proof for rows that might carry is_approved
    return pin.kind === 'approved' || pin.is_approved === true
  }

  Object.assign(ctx, { BASE_HEX, STROKE_DARK, STROKE_W, ZOOM_BUMP_FACTOR, ZOOM_BUMP_THRESHOLD, applyRadius, buildPinFromRow, categoryForReportType, categoryValueForMarker, colorForCategory, colorForPin, createMarkerWithIcon, isApprovedPin, normalizeReportType, resolvedColorForPin, safeLatLng, updateAllRadii })
  return { BASE_HEX, STROKE_DARK, STROKE_W, ZOOM_BUMP_FACTOR, ZOOM_BUMP_THRESHOLD, applyRadius, buildPinFromRow, categoryForReportType, categoryValueForMarker, colorForCategory, colorForPin, createMarkerWithIcon, isApprovedPin, normalizeReportType, resolvedColorForPin, safeLatLng, updateAllRadii }
}
