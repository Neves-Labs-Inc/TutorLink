import { describe, it, expect } from 'vitest'
import { shouldSubmitOnKey } from './shouldSubmitOnKey'

describe('shouldSubmitOnKey', () => {
  it('submits on a plain Enter', () => {
    expect(shouldSubmitOnKey({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13 })).toBe(true)
  })

  it('does not submit on Shift+Enter so the newline is inserted', () => {
    expect(shouldSubmitOnKey({ key: 'Enter', shiftKey: true, isComposing: false, keyCode: 13 })).toBe(false)
  })

  it('does not submit on Enter while an IME composition is active', () => {
    expect(shouldSubmitOnKey({ key: 'Enter', shiftKey: false, isComposing: true, keyCode: 13 })).toBe(false)
  })

  it('does not submit on the Safari IME-commit Enter, which reports keyCode 229', () => {
    expect(shouldSubmitOnKey({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 229 })).toBe(false)
  })

  it('does not submit on other keys', () => {
    expect(shouldSubmitOnKey({ key: 'a', shiftKey: false, isComposing: false, keyCode: 65 })).toBe(false)
    expect(shouldSubmitOnKey({ key: 'Tab', shiftKey: false, isComposing: false, keyCode: 9 })).toBe(false)
  })
})
