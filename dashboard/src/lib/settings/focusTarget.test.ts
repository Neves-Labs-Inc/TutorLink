import { describe, expect, it } from 'vitest'

import { focusTarget } from '@/lib/settings/focusTarget'

describe('focusTarget', () => {
  it('moves focus to the saved message after a successful save', () => {
    expect(focusTarget('saved', false)).toBe('saved-message')
  })

  it('keeps focus on Save after a failed save that left changes to retry', () => {
    expect(focusTarget('save-failed', true)).toBe('save-button')
  })

  it('falls back to the first field when a failed save left Save disabled', () => {
    expect(focusTarget('save-failed', false)).toBe('first-field')
  })

  it('moves focus to the first field after a discard', () => {
    expect(focusTarget('discarded', false)).toBe('first-field')
  })
})
