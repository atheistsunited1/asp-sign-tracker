// Dashboard state: the selected period (a calendar quarter or a custom range,
// mirrored into the URL query so a view is shareable), the RPC load, and the
// derived view model.
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchDashboardStats } from '@/pages/dashboard/dashboardService'
import { buildDashboardModel } from '@/pages/dashboard/aggregate'
import { quarterOf, quarterRange, shiftQuarter, previousWindow, periodLabel, todayIso } from '@/pages/dashboard/quarters'

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/

export function useDashboard() {
  const route = useRoute()
  const router = useRouter()

  const currentQuarter = quarterOf(todayIso())
  // Period selection: either { quarter } or { from, to }
  const quarter = ref(null)
  const customFrom = ref('')
  const customTo = ref('')

  function readFromRoute() {
    const q = String(route.query.q || '')
    const f = String(route.query.from || ''), t = String(route.query.to || '')
    if (ISO_RE.test(f) && ISO_RE.test(t) && f <= t) { quarter.value = null; customFrom.value = f; customTo.value = t; return }
    quarter.value = quarterRange(q) ? q : currentQuarter
    customFrom.value = ''; customTo.value = ''
  }
  readFromRoute()

  const range = computed(() => quarter.value ? quarterRange(quarter.value) : { from: customFrom.value, to: customTo.value })
  const isCustom = computed(() => !quarter.value)
  const label = computed(() => periodLabel(range.value.from, range.value.to))
  const previous = computed(() => previousWindow(range.value.from, range.value.to))
  const canGoForward = computed(() => !!quarter.value && quarter.value < currentQuarter)

  const loading = ref(false)
  const error = ref('')
  const stats = ref(null)
  const model = computed(() => (stats.value ? buildDashboardModel(stats.value) : null))

  async function load() {
    const { from, to } = range.value
    if (!from || !to) return
    loading.value = true; error.value = ''
    try {
      stats.value = await fetchDashboardStats({ from, to })
    } catch (e) {
      error.value = e?.message || String(e)
      stats.value = null
    } finally {
      loading.value = false
    }
  }

  function syncRoute() {
    const query = quarter.value ? { q: quarter.value } : { from: customFrom.value, to: customTo.value }
    router.replace({ query }).catch(() => {})
  }

  function setQuarter(q) { if (quarterRange(q)) { quarter.value = q; customFrom.value = ''; customTo.value = '' } }
  function stepQuarter(n) { const q = shiftQuarter(quarter.value || currentQuarter, n); if (q && q <= currentQuarter) setQuarter(q) }
  function setCustom(from, to) { if (ISO_RE.test(from) && ISO_RE.test(to) && from <= to) { quarter.value = null; customFrom.value = from; customTo.value = to } }

  watch(range, (r, old) => {
    if (!r?.from || !r?.to) return
    if (old && r.from === old.from && r.to === old.to) return
    syncRoute()
    load()
  }, { immediate: true })

  return {
    currentQuarter, quarter, customFrom, customTo, range, isCustom, label, previous, canGoForward,
    loading, error, stats, model,
    load, setQuarter, stepQuarter, setCustom,
  }
}
