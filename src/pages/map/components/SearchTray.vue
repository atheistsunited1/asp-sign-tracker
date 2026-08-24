<template>
  <aside id="search-tray" :class="{ open: searchOpen }" aria-label="Search & Filters" role="dialog">
    <div class="tray-head">
      <div class="tray-head-title">Search & Filters</div>
      <button class="tray-close" @click="searchOpen=false" aria-label="Close">✖</button>
    </div>

    <div class="tray-panels">
      <section class="tray-section">
        <div class="tray-title">Search Pins</div>
        <input
          ref="findSearchRef"
          v-model="remoteSearch.q"
          class="tray-search-input"
          placeholder="Search pins (ID, city/state, ZIP, sign text, activity type)"
          aria-label="Find pins"
          @input="queueRemoteSearch({ resetPage: true })"
          @keydown.enter.prevent="runRemoteSearch({ resetPage: true })"
        />
        <div class="search-actions">
          <button class="ghost" @click="clearSearchAndTrayFilters">Clear Search</button>
        </div>
        <div class="search-meta">
          <template v-if="remoteSearch.loading">Searching…</template>
          <template v-else-if="remoteSearch.error">{{ remoteSearch.error }}</template>
          <template v-else-if="remoteSearch.total > 0">
            {{ remoteSearch.total }} result<span v-if="remoteSearch.total !== 1">s</span>
            (showing {{ remoteSearch.results.length }})
          </template>
        </div>
        <div v-if="remoteSearch.results.length" class="search-results">
          <article
            v-for="row in remoteSearch.results"
            :key="row.id"
            class="search-result-card"
            role="button"
            tabindex="0"
            :title="`Open ${row.friendly_id}`"
            @click="openSearchResultPin(row)"
            @keydown.enter.prevent="openSearchResultPin(row)"
            @keydown.space.prevent="openSearchResultPin(row)"
          >
            <div class="search-result-head">
              <div class="search-result-line">
                <span class="search-result-id">{{ row.friendly_id }}</span>
                <span class="search-result-loc">• {{ searchResultLocation(row) }}</span>
              </div>
              <button
                class="search-save-btn"
                :class="{ active: isPinBookmarked(row.id) }"
                :aria-label="isPinBookmarked(row.id) ? 'Bookmarked pin' : 'Bookmark pin'"
                :title="isPinBookmarked(row.id) ? 'Bookmarked' : 'Bookmark'"
                @click.stop="toggleBookmarkFromResult(row.id)"
              >🔖</button>
            </div>
          </article>
          <div style="display:flex; justify-content:flex-end; margin-top:8px;">
            <button
              v-if="remoteSearch.results.length < remoteSearch.total && remoteSearch.results.length < remoteSearch.cap"
              class="ghost"
              @click="loadMoreRemoteSearch"
            >
              Load More
            </button>
          </div>
        </div>
      </section>

      <section class="tray-section">
        <div class="tray-title">Filters</div>
        <div class="pill-row pill-col" role="group" aria-label="User filters">
          <button
            class="seg-pill"
            :class="{ active: myReportsOnly }"
            :aria-pressed="myReportsOnly"
            @click="myReportsOnly = !myReportsOnly"
            title="Show only pins/submissions reported by me"
          >
            My Reports
          </button>

          <button
            class="seg-pill"
            :class="{ active: bookmarkedOnly }"
            :aria-pressed="bookmarkedOnly"
            @click="bookmarkedOnly = !bookmarkedOnly"
            title="Show only saved bookmarks"
          >
            Bookmarked
          </button>
        </div>
        <div class="pin-filter-grid">
          <label class="tray-field">
            <span>City</span>
            <input
              v-model="pinFilterCity"
              type="text"
              placeholder="Any city"
              aria-label="Filter by city"
            />
          </label>
          <label class="tray-field">
            <span>State</span>
            <input
              v-model="pinFilterState"
              type="text"
              placeholder="Any state"
              aria-label="Filter by state"
            />
          </label>
          <label class="tray-field">
            <span>Country</span>
            <input
              v-model="pinFilterCountry"
              type="text"
              placeholder="Any country"
              aria-label="Filter by country"
            />
          </label>
        </div>
        <div class="row" style="margin-top:10px; display:flex; gap:8px;">
          <button class="ghost" @click="resetAllLocalFilters">Reset Filters</button>
        </div>
      </section>
    </div>

    <div class="tray-actions">
      <p class="muted-help">Search pins by Pin ID. Filters show pins only for selected filters.</p>
    </div>
  </aside>
</template>

<script setup>
// Search & Filters tray: remote pin search with results, user/bookmark pills and city/state/country filters.
// Reads the map page context (mapContext.js); extracted from MapPage.vue in #131 with its CSS.
import { inject } from 'vue'
import { MAP_CTX } from '@/pages/map/mapContext'
const ctx = inject(MAP_CTX)
const {
  bookmarkedOnly,
  clearSearchAndTrayFilters,
  findSearchRef,
  isPinBookmarked,
  loadMoreRemoteSearch,
  myReportsOnly,
  openSearchResultPin,
  pinFilterCity,
  pinFilterCountry,
  pinFilterState,
  queueRemoteSearch,
  remoteSearch,
  resetAllLocalFilters,
  runRemoteSearch,
  searchOpen,
  searchResultLocation,
  toggleBookmarkFromResult,
} = ctx
</script>

<style scoped src="./SearchTray.css"></style>
