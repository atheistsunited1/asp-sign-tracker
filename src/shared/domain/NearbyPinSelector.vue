<template>
  <div
    v-if="visible"
    class="nearby-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Nearby pins selector"
  >
    <div class="nearby-card">
      <header class="nearby-header">
        <h3>{{ pickOnly ? 'Multiple Pins Here' : 'Nearby Pins Found' }}</h3>
      </header>

      <section class="nearby-body">
        <p class="nearby-intro" v-if="pickOnly">
          Several pins overlap at this spot — choose the one you meant.
        </p>
        <p class="nearby-intro" v-else>
          The coordinates <strong>{{ coords }}</strong> are within 20 meters of existing pins.
        </p>
        <p class="nearby-map-note">
          <span class="legend-dot pin-dot"></span> Nearby pin
          <span class="legend-dot target-dot"></span> {{ pickOnly ? 'Tapped point' : 'Submitted point' }}
        </p>

        <ul v-if="pinCards.length" class="pin-list">
          <li v-for="card in pinCards" :key="card.pin.id" class="pin-item">
            <div class="pin-map-cell">
              <div v-if="card.preview" class="pin-map-thumb">
                <img
                  v-for="tile in card.preview.tiles"
                  :key="tile.key"
                  class="map-tile"
                  :src="tile.src"
                  alt="Nearby pin map preview"
                  :style="{ left: `${tile.leftPx}px`, top: `${tile.topPx}px` }"
                  loading="lazy"
                />
                <span
                  v-if="card.preview.pinInView"
                  class="map-dot pin-dot"
                  :style="{ left: `${card.preview.pinXPx}px`, top: `${card.preview.pinYPx}px` }"
                ></span>
                <span
                  v-if="card.preview.targetInView"
                  class="map-dot target-dot"
                  :style="{ left: `${card.preview.targetXPx}px`, top: `${card.preview.targetYPx}px` }"
                ></span>
              </div>
              <div v-else class="pin-map-fallback">No map preview</div>
            </div>

            <div class="pin-main">
              <div v-if="card.closed" class="pin-meta-row">
                <span class="lifecycle-badge" :class="card.closed">
                  {{ card.closedLabel }} — lifecycle closed
                </span>
              </div>

              <div class="pin-meta-row">
                <span class="pin-meta-label">Last activity</span>
                <span class="pin-meta-value">{{ card.lastActivityLabel }}</span>
              </div>

              <div class="pin-meta-row">
                <span class="pin-meta-label">Sign Type</span>
                <span class="pin-meta-value">{{ formatSignTypeLabel(card.pin.sign_type, 'Unknown') }}</span>
              </div>

              <div class="pin-meta-row">
                <span class="pin-meta-label">Sign Text</span>
                <span class="pin-meta-value">{{ card.pin.sign_text || 'No text' }}</span>
              </div>

              <div class="pin-meta-row">
                <span class="pin-meta-label">COORDS</span>
                <span class="pin-meta-value pin-coords">{{ card.pin.lat.toFixed(6) }}, {{ card.pin.lng.toFixed(6) }}</span>
              </div>

              <div class="pin-meta-row desc-row">
                <span class="pin-meta-label">Description</span>
                <span class="pin-meta-value pin-desc">{{ card.locationDescription }}</span>
              </div>

              <div v-if="card.pin.photos?.length" class="photo-thumbs">
                <a
                  v-for="(photo, index) in card.pin.photos"
                  :key="index"
                  :href="photo.image_url"
                  class="thumb-link"
                  target="_blank"
                  rel="noopener"
                >
                  <img :src="photo.image_url" alt="Nearby pin photo" />
                </a>
              </div>
            </div>

            <div class="pin-actions">
              <!-- A closed lifecycle takes no new activity: selection is disabled in the
                   report/bulk submission flows. pick-only (map tap chooser) just opens the
                   popup, so closed pins stay selectable there. -->
              <button
                class="btn primary sm"
                :disabled="!pickOnly && !!card.closed"
                :title="!pickOnly && card.closed ? `This pin is ${card.closedLabel.toLowerCase()} — its lifecycle is closed. Report as a new sign instead.` : ''"
                @click="$emit('selectExisting', card.pin)"
              >
                {{ pickOnly ? 'Open' : 'Update Existing' }}
              </button>
            </div>
          </li>
        </ul>

        <p v-else class="empty-text">No nearby pins found for these coordinates.</p>
      </section>

      <footer class="nearby-footer">
        <button v-if="!pickOnly" class="btn success" @click="$emit('confirmNew')">Report As New Sign</button>
        <button class="btn ghost" @click="$emit('cancel')">Cancel</button>
      </footer>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { formatSignTypeLabel, sortPinsByLastActivity } from '@/shared/domain/pinUtils'
import { finalFromIconType } from '@/shared/domain/activityLifecycle'

const props = defineProps({
  visible: Boolean,
  coords: { type: String, default: '' },
  nearbyPins: { type: Array, default: () => [] },
  // Tap-disambiguation mode (#18): choose-a-pin only — no report-flow actions.
  pickOnly: { type: Boolean, default: false },
})

defineEmits(['selectExisting', 'confirmNew', 'cancel'])


const TILE_SIZE = 256
const PREVIEW_SIZE = 132
const PREVIEW_ZOOM =19
const WEB_MERCATOR_MAX_LAT = 85.05112878

function clampLat(lat) {
  const n = Number(lat)
  if (!Number.isFinite(n)) return NaN
  return Math.max(-WEB_MERCATOR_MAX_LAT, Math.min(WEB_MERCATOR_MAX_LAT, n))
}

function normalizeLng(lng) {
  const n = Number(lng)
  if (!Number.isFinite(n)) return NaN
  return ((n + 180) % 360 + 360) % 360 - 180
}

function parseCoords(raw = '') {
  const m = String(raw).trim().match(/(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/)
  if (!m) return null
  const lat = Number(m[1])
  const lng = Number(m[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat: clampLat(lat), lng: normalizeLng(lng) }
}

function latLngToWorldPixel(lat, lng, zoom) {
  const latRad = (lat * Math.PI) / 180
  const scale = TILE_SIZE * (2 ** zoom)
  const x = ((lng + 180) / 360) * scale
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale
  return { x, y }
}

function wrapTileX(tileX, zoom) {
  const n = 2 ** zoom
  return ((tileX % n) + n) % n
}

function isValidTileY(tileY, zoom) {
  const n = 2 ** zoom
  return tileY >= 0 && tileY < n
}

function osmTileUrl(tileXRaw, tileYRaw, zoom) {
  return `https://tile.openstreetmap.org/${zoom}/${wrapTileX(tileXRaw, zoom)}/${tileYRaw}.png`
}

function buildPreview(pin, submittedPoint) {
  const pinLat = clampLat(pin?.lat)
  const pinLng = normalizeLng(pin?.lng)
  if (!Number.isFinite(pinLat) || !Number.isFinite(pinLng)) return null

  const focus = submittedPoint || { lat: pinLat, lng: pinLng }
  const focusWorld = latLngToWorldPixel(focus.lat, focus.lng, PREVIEW_ZOOM)
  const pinWorld = latLngToWorldPixel(pinLat, pinLng, PREVIEW_ZOOM)

  const half = PREVIEW_SIZE / 2
  const topLeftX = focusWorld.x - half
  const topLeftY = focusWorld.y - half

  const startTileX = Math.floor(topLeftX / TILE_SIZE)
  const endTileX = Math.floor((topLeftX + PREVIEW_SIZE - 1) / TILE_SIZE)
  const startTileY = Math.floor(topLeftY / TILE_SIZE)
  const endTileY = Math.floor((topLeftY + PREVIEW_SIZE - 1) / TILE_SIZE)

  const tiles = []
  for (let tileY = startTileY; tileY <= endTileY; tileY += 1) {
    if (!isValidTileY(tileY, PREVIEW_ZOOM)) continue
    for (let tileX = startTileX; tileX <= endTileX; tileX += 1) {
      const leftPx = tileX * TILE_SIZE - topLeftX
      const topPx = tileY * TILE_SIZE - topLeftY
      tiles.push({
        key: `${tileX}:${tileY}`,
        src: osmTileUrl(tileX, tileY, PREVIEW_ZOOM),
        leftPx,
        topPx,
      })
    }
  }

  const pinXPx = pinWorld.x - topLeftX
  const pinYPx = pinWorld.y - topLeftY
  const pinInView = pinXPx >= 0 && pinXPx <= PREVIEW_SIZE && pinYPx >= 0 && pinYPx <= PREVIEW_SIZE

  return {
    tiles,
    pinXPx,
    pinYPx,
    pinInView,
    targetXPx: submittedPoint ? half : pinXPx,
    targetYPx: submittedPoint ? half : pinYPx,
    targetInView: true,
  }
}

const submittedPoint = computed(() => parseCoords(props.coords))

// "Last activity: Plundered · 8/3/2026" — type + date, same date format the
// popup history rows use. Pins without a usable date read "Unknown".
function formatActivityTypeLabel(t) {
  const s = String(t || '').trim()
  if (!s || s === 'unknown') return ''
  return s.charAt(0).toUpperCase() + s.slice(1)
}
function lastActivityLabelFor(pin) {
  const raw = pin?.last_activity_at || pin?.created_at || null
  const d = raw ? new Date(raw) : null
  const date = d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString() : ''
  const type = formatActivityTypeLabel(pin?.last_activity_type || pin?.report_type)
  if (type && date) return `${type} · ${date}`
  return type || date || 'Unknown'
}

const pinCards = computed(() => {
  const source = Array.isArray(props.nearbyPins) ? props.nearbyPins : []
  // Newest-first by last activity regardless of which caller built the list (#55).
  return sortPinsByLastActivity(source).map((pin) => {
    // 'plundered' | 'krakened' | null. findNearbyPins attaches lifecycle_state;
    // the tap chooser's in-memory pins carry icon_type instead.
    const closed = pin?.lifecycle_state || finalFromIconType(pin?.icon_type) || null
    return {
      pin,
      closed,
      closedLabel: closed ? closed.charAt(0).toUpperCase() + closed.slice(1) : '',
      preview: buildPreview(pin, submittedPoint.value),
      locationDescription: String(pin?.description || '').trim() || 'No location description',
      lastActivityLabel: lastActivityLabelFor(pin),
    }
  })
})
</script>

<style scoped>
.nearby-overlay {
  position: fixed;
  top: var(--topbar-h, 56px);
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 7000;
  display: grid;
  place-items: center;
  padding: 12px;
  background: rgba(0, 0, 0, 0.35);
}

.lifecycle-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #fff;
}
.lifecycle-badge.plundered { background: #b45309; }
.lifecycle-badge.krakened { background: #6d28d9; }
.btn.primary.sm:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.nearby-card {
  width: min(720px, calc(100% - 24px));
  max-height: calc(100dvh - var(--topbar-h, 56px) - 24px);
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.nearby-header {
  padding: 10px 14px;
  background: #f5f6f8;
  border-bottom: 1px solid #e9e9e9;
}

.nearby-header h3 {
  margin: 0;
  color: #222;
  font-size: 16px;
  font-weight: 700;
}

.nearby-body {
  padding: 12px;
  background: #fafafa;
  color: #1f2937;
  overflow: auto;
}

.nearby-intro {
  margin: 0 0 8px 0;
  color: #4b5563;
  line-height: 1.35;
}

.nearby-map-note {
  margin: 0 0 12px 0;
  color: #6b7280;
  font-size: 12px;
  display: flex;
  gap: 12px;
  align-items: center;
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  display: inline-block;
  vertical-align: middle;
  margin-right: 4px;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px rgba(17, 24, 39, 0.3);
}

.pin-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 10px;
}

.pin-item {
  display: grid;
  grid-template-columns: 132px 1fr auto;
  gap: 12px;
  align-items: flex-start;
  padding: 12px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
}

.pin-map-cell {
  width: 132px;
}

.pin-map-thumb {
  position: relative;
  width: 132px;
  height: 132px;
  overflow: hidden;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  background: #e5e7eb;
}

.map-tile {
  position: absolute;
  width: 256px;
  height: 256px;
  object-fit: cover;
  display: block;
  user-select: none;
  pointer-events: none;
}

.pin-map-fallback {
  width: 132px;
  height: 132px;
  border-radius: 8px;
  border: 1px dashed #cbd5e1;
  background: #f3f4f6;
  color: #6b7280;
  display: grid;
  place-items: center;
  font-size: 12px;
}

.map-dot {
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  transform: translate(-50%, -50%);
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px rgba(17, 24, 39, 0.35);
}

.pin-dot {
  background: #ef4444;
}

.target-dot {
  background: #1e90ff;
}

.pin-main {
  min-width: 0;
}

.pin-meta-row {
  display: flex;
  gap: 8px;
  align-items: baseline;
}

.pin-meta-row + .pin-meta-row {
  margin-top: 4px;
}

.pin-meta-label {
  width: 84px;
  flex: 0 0 84px;
  color: #6b7280;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.pin-meta-value {
  color: #1f2937;
  font-size: 14px;
  word-break: break-word;
}

.pin-coords {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.desc-row {
  align-items: flex-start;
}

.pin-desc {
  display: block;
  max-height: 3.9em;
  line-height: 1.3;
  overflow: auto;
  padding-right: 2px;
}

.photo-thumbs {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.thumb-link {
  display: inline-block;
  line-height: 0;
}

.photo-thumbs img {
  width: 52px;
  height: 52px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  transition: transform 0.12s ease;
}

.photo-thumbs img:hover {
  transform: scale(1.04);
}

.pin-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.nearby-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 16px;
  background: #f7f7f7;
  border-top: 1px solid #e6e6e6;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 8px;
  border: 1px solid transparent;
  cursor: pointer;
  font-weight: 600;
  font-size: 14px;
}

.btn.sm {
  padding: 7px 10px;
  font-size: 13px;
}

.btn.primary {
  background: #1e90ff;
  color: #fff;
}

.btn.primary:hover {
  filter: brightness(1.05);
}

.btn.success {
  background: #2e9d45;
  color: #fff;
}

.btn.success:hover {
  filter: brightness(1.05);
}

.btn.ghost {
  background: #fff;
  color: #333;
  border-color: #d7d7d7;
}

.btn.ghost:hover {
  background: #f3f4f6;
}

.empty-text {
  margin: 2px 0 0 0;
  color: #6b7280;
}

@media (max-width: 760px) {
  .pin-item {
    grid-template-columns: 1fr;
  }

  .pin-actions {
    justify-content: flex-start;
  }
}

@media (max-width: 640px) {
  .nearby-footer {
    flex-direction: column-reverse;
  }

  .nearby-footer .btn {
    width: 100%;
  }
}
</style>
