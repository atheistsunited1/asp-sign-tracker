<template>
  <div id="report-form" v-show="visible" :aria-busy="submitting">

    <div class="sheet" :class="{ compact: isExistingQuickAction }" :aria-busy="submitting">

      <!-- header -->
      <div class="form-header">
        <h3>{{ formTitle }}</h3>
        
        <div class="header-right">
          <span v-if="selectedPinFriendlyId" class="id-pill">Pin {{ selectedPinFriendlyId }}</span>
          <button
            class="icon-button"
            :disabled="submitting"
            @click="!submitting && closeForm()"
            aria-label="Close"
          >✖</button>

        </div>
      </div>

      <!-- body -->
      <div class="form-body">
        <div class="field" v-if="isExistingQuickAction">
          <label>Pin Details</label>
          <div class="pin-summary">
            <div><b>Sign Text:</b> {{ selectedPin?.sign_text || '—' }}</div>
            <div><b>Sign Type:</b> {{ formatSignTypeLabel(selectedPin?.sign_type, '—') }}</div>
            <div><b>Description:</b> {{ selectedPin?.description || '—' }}</div>
            <div><b>Coordinates:</b> {{ coords || '—' }}</div>
            <div><b>Activity Type:</b> {{ reportType || '—' }}</div>
          </div>
        </div>

        <!-- Quick updates carry no free text of their own; a note is appended, dated, to the pin's description -->
        <div class="field" v-if="isExistingQuickAction">
          <label>Add a note (optional)</label>
          <input
            type="text"
            v-model="updateNote"
            placeholder="e.g., torn but still readable; moved to the other pole"
          />
          <small class="muted">Added to the pin's description with today's date.</small>
        </div>


        <!-- 1) Sign Text FIRST + autosuggest -->
        <div class="field signtext-wrap" v-if="!isExistingQuickAction">
          <label>Sign Text</label>
          <input
            type="text"
            v-model="signText"
            :class="{ invalid: invalid.signText }"
            ref="signInput"
            @focus="openSuggest()"
            @input="openSuggest()"
            @keydown.down.prevent="moveSel(1)"
            @keydown.up.prevent="moveSel(-1)"
            @keydown.enter.prevent="applySel()"
            @blur="closeSuggestSoon()"
          />
          <ul v-if="showSuggest && filteredSuggestions.length" class="suggest-list">
            <li
              v-for="(s, i) in filteredSuggestions"
              :key="s.text"
              :class="{ active: i === selIndex }"
              @mousedown.prevent="chooseSuggestion(s)"
              @mouseenter="selIndex = i"
            >
              {{ s.text }}
            </li>
          </ul>

        </div>


        <!-- 2) Photos (moved up) -->
        <div class="field">
          <label>Photos</label>
          <div class="photo-actions">
            <button class="btn warn sm" @click="onAddPhotosClick">📷 Add photos</button>
            <button v-if="isDirty" class="btn ghost sm" @click="resetToSnapshot">↩️ Reset form</button>
            <span class="muted" :class="{ overmax: overMax }" style="margin-left:4px;">
              Max {{ MAX_PHOTOS }} photos.
            </span>
          </div>
        </div>

        <!-- 3) Previews (moved up) -->
        <div class="field" v-if="stagedPhotos.length">
          <div class="preview-grid small">
            <div v-for="p in stagedPhotos" :key="p.id" class="thumb-wrap">
              <img
                :src="p.url"
                class="thumb clickable"
                :style="{ transform: `rotate(${p.rotation || 0}deg)` }"
                @click="openLightbox(p.url)"
              />
              <button
                class="thumb-x"
                type="button"
                aria-label="Remove photo"
                @click="removePhoto(p.id)"
                title="Remove"
              >✖</button>
              <button
                class="thumb-x thumb-rot"
                type="button"
                aria-label="Rotate photo 90 degrees clockwise"
                @click="rotatePhoto(p.id)"
                title="Rotate 90° clockwise"
              >↻</button>
            </div>
          </div>
        </div>

        <!-- Lightbox -->
        <div
          v-if="lightboxOpen"
          class="lightbox"
          @click="closeLightbox"              
        >
          <div class="lightbox-inner" @click.stop> 
            <button class="lb-close" @click="closeLightbox" aria-label="Close">✖</button>
            <img :src="lightboxSrc" alt="Preview" class="lightbox-img" />
          </div>
        </div>


        <!-- 4) Activity Type (segmented) -->
        <div class="field" v-if="!isExistingQuickAction">
          <label>Activity Type</label>
          <div class="seg">
            <label v-for="opt in rtOpts" :key="opt.v" class="seg-item">
              <input type="radio" name="rt" :value="opt.v" v-model="reportType" />
              <span>{{ opt.l }}</span>
            </label>
          </div>
        </div>

        <!-- 5) Sign Type (segmented) -->
        <div class="field" v-if="!isExistingQuickAction">
          <label>Sign Type</label>
          <div class="seg small">
            <label v-for="opt in stOpts" :key="opt.v" class="seg-item">
              <input type="radio" name="st" :value="opt.v" v-model="signType" :class="{ invalid: invalid.signType }" />
              <span>{{ opt.l }}</span>
            </label>
          </div>
        </div>

        <!-- 6) Description -->
        <div class="field" v-if="!isExistingQuickAction">
          <label>Description</label>
          <input
            type="text"
            v-model="locationDescription"
            placeholder="How to find it on site — pole, corner, anything unusual"
          />
        </div>

        <!-- 8) Coordinates (input + copy / edit / maps buttons) -->
        <div class="field" v-if="!isExistingQuickAction">
          <label>{{ coordLabel }}</label>

          <div class="coord-row">
            <input
              id="report-coords"
              type="text"
              v-model="coords"
              :class="{ invalid: invalid.coords }"
              :readonly="!coordsEditable"
              placeholder="Enter GPS coordinates <LAT, LNG>"
              @change="onCoordsChange"
            />
            <button
              class="btn icon sm"
              @click="toggleCoordsEdit"
              :title="coordsEditable ? 'Lock coords' : 'Edit coords'"
              aria-label="Edit coords"
            >✏️</button>
            <button class="btn icon sm" @click="copyCoords" title="Copy coords">📋</button>
            <button
              class="btn icon sm"
              @click="openInMaps"
              title="Open in Google Maps"
              aria-label="Open in Google Maps"
            >🗺️</button>
          </div>
        </div>
      </div>



      <!-- sticky actions -->
      <div class="actions">
        <button class="btn primary" :disabled="submitting" @click="onSubmitClick">
          {{ submitting ? 'Submitting…' : '🚀 Submit' }}
        </button>
      </div>
    </div>

    <!-- LOCK OVERLAY: blocks all taps while submitting -->
    <div v-if="submitting" class="form-freeze" aria-hidden="true">
      <div class="freeze-inner" role="status" aria-live="polite">
        <div class="freeze-spinner" aria-hidden="true"></div>
        <div class="freeze-text">Submitting…</div>
      </div>
    </div>

  </div>
  

  <!-- Photo picker. Opened programmatically (openGalleryPicker); it sits
       outside #report-form, so hide it explicitly or it renders as a stray
       native "Choose Files" control below the map. -->
  <input
    type="file"
    accept="image/*"
    multiple
    style="display:none"
    @change="handlePhotoUpload"
    ref="fileInput"
  />

  <!-- Nearby Pin Selector (shows above the sheet) -->
<NearbyPinSelector
  v-if="showPinSelector"
  :visible="showPinSelector"
  :coords="coords"
  :nearbyPins="nearbyPins"
  @selectExisting="handleSelectExistingPin"
  @confirmNew="submitNewFromSelector"
  @cancel="showPinSelector = false"
/>

</template>


<script setup>
// Report form (opened from the map): wiring only. State lives in useReportForm,
// staged photos in usePhotoStaging, submission in useSubmitReport; the photo and
// submission pipelines are shared (shared/domain/*Service).
import { ref, inject, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import NearbyPinSelector from '@/shared/domain/NearbyPinSelector.vue'
import { formatSignTypeLabel } from '@/shared/domain/pinUtils'
import { useAutosuggest } from '@/shared/ui/useAutosuggest'
import { SIGN_TEXT_SUGGESTIONS_WITH_COUNTS as SUGS } from '@/shared/data/signTextSuggestionsWithCounts'
import { useConfirm } from '@/shared/ui/useConfirm'
import { useToast } from '@/shared/ui/useToast'
import { scope } from '@/shared/lib/debug'
import { makeClientLogger } from '@/shared/data/telemetry'
import { ACTIVITY_TYPE_OPTIONS as rtOpts, SIGN_TYPE_OPTIONS as stOpts } from '@/shared/domain/activityOptions'
import { usePhotoStaging } from '@/pages/map/report-form/usePhotoStaging'
import { useReportForm } from '@/pages/map/report-form/useReportForm'
import { useSubmitReport } from '@/pages/map/report-form/useSubmitReport'

const emit = defineEmits(['refreshPins', 'submitted'])
defineProps({ pins: Array })

const { show: showToast } = useToast()
const { confirm } = useConfirm()
const log = scope('ReportForm')
const user = inject('user')
const userProfile = inject('userProfile', ref(null))
const supabasePins = inject('supabasePins')
const logClient = makeClientLogger('report_form', user)

const photos = usePhotoStaging({ showToast, confirm, log, logClient, onUseGps: (gps) => { form.coords.value = gps } })
const form = useReportForm({ user, supabasePins, showToast, confirm, log, photos, onForgetTransient: () => { showSuggest.value = false } })
const submission = useSubmitReport({ form, photos, user, userProfile, showToast, log, logClient, emit })
form.bindSubmission(submission)

// Template bindings
const {
  visible, updateNote, reportType, signText, signType, coords, locationDescription, invalid, signInput,
  showPinSelector, nearbyPins, selectedPin, selectedPinFriendlyId, isExistingQuickAction, formTitle,
  coordLabel, coordsEditable, toggleCoordsEdit, openInMaps, onCoordsChange, copyCoords,
  isDirty, resetToSnapshot, closeForm,
} = form
const {
  fileInput, stagedPhotos, MAX_PHOTOS, overMax, openGalleryPicker, onAddPhotosClick,
  lightboxOpen, lightboxSrc, openLightbox, closeLightbox, handlePhotoUpload, rotatePhoto, removePhoto, clearStagedPhotos,
} = photos
const { submitting, onSubmitClick, handleSelectExistingPin, submitNewFromSelector } = submission

// Sign-text typeahead
const {
  items: filteredSuggestions,
  openList: showSuggest,
  selIndex,
  open: openSuggest,
  closeSoon: closeSuggestSoon,
  move: moveSel,
  apply: applySel,
  choose: chooseSuggestion,
} = useAutosuggest(signText, {
  items: () => SUGS.map(s => ({ text: s.sign_text, n: s.n })), // keep n so we can sort by frequency
  max: 8,
  sortByCount: true,
})

// Field-level invalid flags clear as the user edits
watch(signText, () => { invalid.signText = false })
watch(signType, () => { invalid.signType = false })
watch(coords, () => { invalid.coords = false })

watch(visible, async (v) => {
  log('visible changed', { visible: v })
  if (v) {
    await nextTick()
    // give parent a tick to prefill coords/sign text etc., then snapshot
    requestAnimationFrame(() => form.takeSnapshot())
    form.updateCoordLocale()          // refresh the label when the form shows
    submission.resetSubmissionState()
  } else {
    // any path that hides the sheet (programmatic or user) gets a clean slate
    submission.resetSubmissionState()
    form.forgetTransientState()
  }
})
watch(coords, () => {
  if (visible.value) form.updateCoordLocale()
})

// ESC closes the lightbox first, then the form (ignored during a locked submit)
const cleanupFns = []
onMounted(() => {
  log('mounted', { visible: visible.value, hasUser: !!user?.value, coords: coords.value })
  const onKey = (e) => {
    if (e.key !== 'Escape') return
    if (submitting.value) return
    if (lightboxOpen.value) { e.preventDefault(); e.stopPropagation(); closeLightbox(); return }
    if (visible.value) { e.preventDefault(); e.stopPropagation(); closeForm() }
  }
  window.addEventListener('keydown', onKey)
  cleanupFns.push(() => window.removeEventListener('keydown', onKey))
})
onBeforeUnmount(() => {
  cleanupFns.forEach(fn => { try { fn() } catch {} })
  form.forgetTransientState()
  log('beforeUnmount')
})

defineExpose({
  openWithPrefill: form.openWithPrefill,
  openGalleryPicker,
  clearStagedPhotos,
})
</script>

<style scoped src="./ReportForm.css"></style>

