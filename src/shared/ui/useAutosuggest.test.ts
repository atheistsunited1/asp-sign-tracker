// Tests for the shared sign-text autosuggest composable used by
// ReportForm and BulkPhotoReports. Focused on issue #51: the list must not
// reopen after choosing a suggestion until the text actually changes.
import { describe, it, expect } from 'vitest'
import { nextTick, ref } from 'vue'
import { useAutosuggest } from '@/shared/ui/useAutosuggest'

function setup(initial = '') {
  const model = ref(initial)
  const sug = useAutosuggest(model, {
    items: () => [
      { text: 'STOP', n: 5 },
      { text: 'STOP AHEAD', n: 2 },
      { text: 'YIELD', n: 3 },
    ],
  })
  return { model, sug }
}

describe('useAutosuggest choose()', () => {
  it('does not reopen via open() while the text still equals the chosen suggestion', () => {
    const { model, sug } = setup('sto')
    sug.open()
    expect(sug.openList.value).toBe(true)

    sug.choose({ text: 'STOP' })
    expect(model.value).toBe('STOP')
    expect(sug.openList.value).toBe(false)

    // e.g. focus/input events re-firing openSuggest() after the selection
    sug.open()
    sug.open()
    expect(sug.openList.value).toBe(false)
  })

  it('re-enables open() as soon as the text changes', async () => {
    const { model, sug } = setup('sto')
    sug.choose({ text: 'STOP' })

    model.value = 'STOP A'
    await nextTick()
    sug.open()
    expect(sug.openList.value).toBe(true)
  })

  it('opens for text retyped to equal an earlier selection', async () => {
    const { model, sug } = setup('sto')
    sug.choose({ text: 'STOP' })

    // Edit away from the chosen text, then back to the same string.
    model.value = 'STO'
    await nextTick()
    model.value = 'STOP'
    await nextTick()

    sug.open()
    expect(sug.openList.value).toBe(true)
  })
})

describe('useAutosuggest keyboard flow', () => {
  it('move() steps the selection and apply() commits it', () => {
    const { model, sug } = setup('sto')
    sug.open()
    expect(sug.selIndex.value).toBe(-1)

    // Filtered + sorted: ['STOP', 'STOP AHEAD']
    sug.move(1)
    expect(sug.selIndex.value).toBe(0)
    sug.move(1)
    expect(sug.selIndex.value).toBe(1)
    sug.move(1) // wraps
    expect(sug.selIndex.value).toBe(0)

    sug.apply()
    expect(model.value).toBe('STOP')
    expect(sug.openList.value).toBe(false)
  })

  it('apply() via keyboard also suppresses reopening until the text changes', () => {
    const { sug } = setup('sto')
    sug.open()
    sug.move(1)
    sug.apply()

    sug.open()
    expect(sug.openList.value).toBe(false)
  })
})
