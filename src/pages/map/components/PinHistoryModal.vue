<template>
  <teleport to="body">
    <div v-if="visible" class="modal-overlay" @click.self="$emit('close')">
      <div class="modal" role="dialog" aria-modal="true" aria-label="Pin history">
        <div class="modal-header">
          <div class="head-main">
            <div class="idline" v-if="pin?.friendly_id">Pin ID: {{ pin.friendly_id }}</div>
            <div class="coords" v-if="pin">📍 {{ pin.lat.toFixed(6) }}, {{ pin.lng.toFixed(6) }}</div>
            <div class="pin-badges" v-if="pin && !pin.is_approved">
              <span class="pill pill--pending" title="This pin is awaiting review">Pin pending approval</span>
            </div>
          </div>
          <button class="close" @click="$emit('close')" aria-label="Close">✖</button>
        </div>

        <div class="modal-body">
          <!-- Guests cannot read activity -->
          <div v-if="!loading && signInRequired" class="muted">🔒 Sign in to see activity and photos.</div>

          <!-- Not found notice -->
          <div v-else-if="!loading && pin === null" class="muted">Pin not found.</div>

          <!-- Normal content -->
          <template v-else>
            <div class="pin-facts" v-if="pin">
              <div class="fact"><span class="k">Sign</span><span class="v">{{ formatSignTypeLabel(pin.sign_type, '—') }}<template v-if="pin.sign_text"> · “{{ pin.sign_text }}”</template></span></div>
              <div class="fact" v-if="pin.description"><span class="k">Description</span><span class="v desc">{{ pin.description }}</span></div>
              <div class="fact" v-if="pin.gsv_date"><span class="k">Latest GSV</span><span class="v">{{ formatMonth(pin.gsv_date) }}</span></div>
            </div>

            <div v-if="loading" class="loading">Loading history…</div>
            <div v-else>
              <div v-if="!reports.length" class="muted">No activity yet.</div>

              <!-- One row per activity: type · date · member · photos. No free text. -->
              <div v-for="r in orderedReports" :key="r.id" class="activity-row">
                <div class="a-head">
                  <span class="pill" :class="`pill--${(r.report_type || 'sighting').toLowerCase()}`">
                    {{ r.report_type || 'sighting' }}
                  </span>
                  <span v-if="r.__pending" class="pill pill--pending" title="Awaiting approval">Pending</span>
                  <span class="a-date">{{ formatDate(r.occurred_on || r.created_at) }}</span>
                  <span v-if="r.__username" class="a-who">· {{ r.__username }}</span>
                </div>
                <div v-if="r.photos?.length" class="a-photos">
                  <a
                    v-for="(p, i) in r.photos"
                    :key="i"
                    :href="p.image_url"
                    target="_blank"
                    rel="noopener"
                    class="thumb-link"
                    title="Open photo"
                  ><img :src="p.image_url" alt="activity photo" loading="lazy" /></a>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </teleport>
</template>

<script setup>
import { ref, watch, inject, computed } from 'vue'
import { fetchPinHistoryById } from '@/pages/map/mapService'
import { logger } from '@/shared/lib/logger'
import { formatSignTypeLabel } from '@/shared/domain/pinUtils'
import { formatDateOnly as formatDate, formatMonthYear as formatMonth } from '@/shared/lib/date'

// Props: parent controls visibility + pinId
const props = defineProps({
  visible: { type: Boolean, default: false },
  pinId:   { type: String,  default: null },   // compat: allow direct id
  source:  { type: String,  default: null }    // compat tokens: 'pin:<id>' | 'usr:<id>' | 'usp:<id>' -> all resolved to <id>
})
defineEmits(['close'])

// Map keeps all pins in memory via a provided ref; read from there first, else fetch.
const supabasePins = inject('supabasePins', null)

const loading = ref(false)
const pin = ref(null)
const reports = ref([])
const signInRequired = ref(false)

// Newest activity first by the domain date; ties by row time.
const orderedReports = computed(() =>
  [...reports.value].sort((a, b) =>
    (Date.parse(b.occurred_on || b.created_at || 0) - Date.parse(a.occurred_on || a.created_at || 0))
    || (Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0))
  )
)


watch(() => props.visible, async (v) => {
  if (!v) return
  const token = props.source || (props.pinId ? `pin:${props.pinId}` : null)
  if (!token) return
  await loadHistory(token)
})

/** Fetch a pin (approved or pending) + all its activities; tags __pending / __username. */
async function loadPinAndHistory(id) {
  loading.value = true
  pin.value = null
  reports.value = []
  signInRequired.value = false
  try {
    const cachedPin = supabasePins?.value?.find(p => p.id === id) ?? null
    const history = await fetchPinHistoryById(id, { cachedPin })
    pin.value = history.pin
    reports.value = history.reports
  } catch (e) {
    if (e?.code === '42501' || /permission denied/i.test(e?.message || '')) {
      signInRequired.value = true
    } else {
      logger.error('PinHistoryModal load failed', e)
    }
    reports.value = []
  } finally {
    loading.value = false
  }
}

// Back-compat: any token ('pin:<id>', 'usr:<id>', 'usp:<id>') or raw id resolves to the same loader.
async function loadHistory(token) {
  const m = /^(\w+):(.+)$/.exec(token)
  const id = m ? m[2] : token
  return loadPinAndHistory(id)
}
</script>

<style scoped>
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.55); display: grid; place-items: center; z-index: 3000; }
.modal {
  width: min(760px, 96vw); max-height: 86vh;
  background: #1f1f1f; color: #eee; border: 1px solid #333; border-radius: 12px; overflow: hidden;
  display: grid; grid-template-rows: auto 1fr;
}
.modal-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; padding: 10px 14px; background: #2a2a2a; border-bottom: 1px solid #333; }
.head-main { min-width: 0; }
.modal-header .close { background: transparent; border: none; color: #ddd; font-size: 18px; cursor: pointer; flex: 0 0 auto; }
.modal-body { padding: 12px; overflow: auto; min-height: 0; }
.idline { color: #ffd700; font-weight: 600; }
.coords { opacity: .85; font-size: .9em; }

.pin-facts { display: grid; gap: 4px; margin: 0 0 12px; font-size: .95em; }
.fact { display: grid; grid-template-columns: 96px 1fr; gap: 8px; align-items: baseline; }
.fact .k { color: #9aa3af; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
.fact .v.desc { white-space: pre-wrap; }

.activity-row { background: #242424; border: 1px solid #333; border-radius: 10px; padding: 10px; margin-bottom: 8px; }
.a-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.a-date { opacity: .9; }
.a-who { opacity: .8; }
.a-photos { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.a-photos img { width: 96px; height: 96px; object-fit: cover; border-radius: 6px; border: 1px solid #444; display: block; }
.thumb-link { line-height: 0; }
.muted { opacity: .7; }
.loading { opacity: .85; }

.pill {
  display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; line-height: 1.4;
  border: 1px solid #555; background: #333; color: #eee; text-transform: capitalize;
}
.pill--pending   { background: #8a2a2a; color: #fff; border-color: #b94949; text-transform: none; }
.pill--plundered { background: #4a332b; color: #ffddb8; border-color: #7a584b; }
.pill--krakened  { background: #233b46; color: #b8f0ff; border-color: #3e6473; }
.pin-badges { margin-top: 4px; }

/* Phones: full-screen sheet below the top bar; header stays put, body scrolls */
@media (max-width: 800px) {
  .modal-overlay { place-items: stretch; background: #1f1f1f; }
  .modal {
    width: 100vw; max-height: none; height: 100%;
    border: 0; border-radius: 0;
    margin-top: var(--topbar-h, 56px);
    height: calc(100% - var(--topbar-h, 56px));
  }
  .modal-header { position: sticky; top: 0; z-index: 1; }
  .modal-body { padding: 10px 10px calc(10px + env(safe-area-inset-bottom, 0px)); }
  .fact { grid-template-columns: 1fr; gap: 2px; }
  .a-photos img { width: 84px; height: 84px; }
}
</style>
