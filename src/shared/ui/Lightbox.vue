<template>
  <div v-if="open" class="lightbox" @click="$emit('close')" @keydown.esc.prevent="$emit('close')" tabindex="-1">
    <div class="lightbox-inner" @click.stop>
      <img :src="url" :alt="alt" class="lightbox-img" />
      <div v-if="title || canNav" class="lightbox-bar">
        <span class="lightbox-title">{{ title }}</span>
        <span class="lightbox-nav" v-if="canNav">
          <button type="button" class="lightbox-btn" @click.stop="$emit('prev')" aria-label="Previous photo">◀</button>
          <span class="lightbox-count">{{ index + 1 }} / {{ count }}</span>
          <button type="button" class="lightbox-btn" @click.stop="$emit('next')" aria-label="Next photo">▶</button>
        </span>
        <button type="button" class="lightbox-btn" @click.stop="$emit('close')" aria-label="Close">✖</button>
      </div>
    </div>
  </div>
</template>

<script setup>
// Full-screen photo viewer. Single photo by default; pass `count`/`index` and
// listen to prev/next for a carousel.
import { computed } from 'vue'
const props = defineProps({
  open: { type: Boolean, default: false },
  url: { type: String, default: '' },
  alt: { type: String, default: 'photo preview' },
  title: { type: String, default: '' },
  index: { type: Number, default: 0 },
  count: { type: Number, default: 1 },
})
defineEmits(['close', 'prev', 'next'])
const canNav = computed(() => props.count > 1)
</script>

<style scoped>
.lightbox { position: fixed; inset: 0; background: rgba(0,0,0,.8); display: flex; align-items: center; justify-content: center; z-index: 5000; }
.lightbox-inner { max-width: 90vw; max-height: 90vh; display: grid; gap: 8px; justify-items: center; }
.lightbox-img { max-width: 100%; max-height: 84vh; border-radius: 8px; }
.lightbox-bar { display: flex; align-items: center; gap: 10px; color: #eee; font-size: 13px; }
.lightbox-title { opacity: .85; }
.lightbox-nav { display: inline-flex; align-items: center; gap: 6px; }
.lightbox-count { opacity: .8; min-width: 48px; text-align: center; }
.lightbox-btn { background: #333; color: #eee; border: 1px solid #555; border-radius: 6px; padding: 4px 8px; cursor: pointer; }
.lightbox-btn:hover { background: #3d3d3d; }
</style>
