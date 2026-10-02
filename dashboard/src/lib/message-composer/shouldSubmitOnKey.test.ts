import { describe, it, expect } from 'vitest'
import { shouldSubmitOnKey } from './shouldSubmitOnKey'

describe('shouldSubmitOnKey', () => {
  it('submits on a plain Enter', () => {
    expect(shouldSubmitOnKey({ key: 'Enter', shiftKey: false, isComposing: false })).toBe(true)
  })

  it('does not submit on Shift+Enter so the newline is inserted', () => {
    expect(shouldSubmitOnKey({ key: 'Enter', shiftKey: true, isComposing: false })).toBe(false)
  })

  it('does not submit on Enter while an IME composition is active', () => {
    expect(shouldSubmitOnKey({ key: 'Enter', shiftKey: false, isComposing: true })).toBe(false)
  })

  it('does not submit on other keys', () => {
    expect(shouldSubmitOnKey({ key: 'a', shiftKey: false, isComposing: false })).toBe(false)
    expect(shouldSubmitOnKey({ key: 'Tab', shiftKey: false, isComposing: false })).toBe(false)
  })
})
