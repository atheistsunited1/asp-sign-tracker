import { ref, computed, watch } from 'vue'

export type Sug = string | { text: string; n?: number; group?: string }

function norm(items: Sug[]): { text: string; n?: number; group?: string }[] {
  return items.map(s => typeof s === 'string' ? { text: s } : s)
}

export function useAutosuggest(
  modelRef: { value: string },
  opts: {
    items: () => Sug[] | Sug[]   // allow ref/computed or plain array
    max?: number
    sortByCount?: boolean
    biasStartsWith?: boolean
  }
) {
  const openList = ref(false)
  const selIndex = ref(-1)
  // Text set by choose(); while the model still equals it, open() is a no-op
  // so the list doesn't reappear on focus/input events after a selection.
  const chosen = ref<string | null>(null)
  let closeTimer: number | undefined

  watch(() => modelRef.value, v => {
    if (chosen.value !== null && v !== chosen.value) chosen.value = null
  })

  const q = computed(() => (modelRef.value || '').toLowerCase().trim())

  const items = computed(() => {
    const base = typeof opts.items === 'function' ? (opts.items() as Sug[]) : opts.items
    const pool = norm(base)

    let list = q.value
      ? pool.filter(i => i.text.toLowerCase().includes(q.value))
      : pool

    const starts = (t: string) => q.value && t.toLowerCase().startsWith(q.value)

    list = list.slice().sort((a, b) => {
      if (opts.biasStartsWith !== false) {
        const sa = starts(a.text) ? 1 : 0
        const sb = starts(b.text) ? 1 : 0
        if (sa !== sb) return sb - sa
      }
      if (opts.sortByCount !== false) {
        const na = a.n ?? 0, nb = b.n ?? 0
        if (na !== nb) return nb - na
      }
      return a.text.localeCompare(b.text)
    })

    return list.slice(0, opts.max ?? 8)
  })

  function open() {
    if (chosen.value !== null && modelRef.value === chosen.value) return
    // Suggestions only once the user has typed something: no prompts on focus.
    if (!q.value) { openList.value = false; return }
    openList.value = true
    selIndex.value = -1
  }
  function closeSoon() {
    if (closeTimer) clearTimeout(closeTimer)
    closeTimer = window.setTimeout(() => (openList.value = false), 120)
  }
  function move(delta: number) {
    if (!items.value.length) return
    openList.value = true
    const max = items.value.length - 1
    selIndex.value = selIndex.value + delta
    if (selIndex.value < 0) selIndex.value = max
    if (selIndex.value > max) selIndex.value = 0
  }
  function apply() { if (selIndex.value >= 0) choose(items.value[selIndex.value]) }
  function choose(it: { text: string }) {
    modelRef.value = it.text
    chosen.value = it.text
    openList.value = false
  }

  return { items, openList, selIndex, open, closeSoon, move, apply, choose }
}
