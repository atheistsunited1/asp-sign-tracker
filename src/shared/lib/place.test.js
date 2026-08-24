import { describe, it, expect } from 'vitest'
import { formatPlace, formatCityState } from './place.js'

describe('place helpers', () => {
  it('joins city and state, degrades gracefully', () => {
    expect(formatPlace('Portland', 'OR')).toBe('Portland, OR')
    expect(formatPlace('Portland', '')).toBe('Portland')
    expect(formatPlace('', ' OR ')).toBe('OR')
    expect(formatPlace('', '')).toBe('—')
    expect(formatPlace(null, null, 'Unknown')).toBe('Unknown')
    expect(formatCityState({ city: 'LA', state: 'CA' })).toBe('LA, CA')
    expect(formatCityState(null)).toBe('—')
  })
})
