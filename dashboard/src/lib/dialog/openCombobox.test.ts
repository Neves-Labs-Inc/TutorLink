import { describe, it, expect } from 'vitest'
import { isOpenCombobox } from './openCombobox'

const elementWith = (attributes: Record<string, string>) => ({
  getAttribute: (name: string) => attributes[name] ?? null,
})

describe('isOpenCombobox', () => {
  it('is true for a combobox whose list is open', () => {
    expect(isOpenCombobox(elementWith({ role: 'combobox', 'aria-expanded': 'true' }))).toBe(true)
  })

  it('is false for a combobox whose list is closed', () => {
    expect(isOpenCombobox(elementWith({ role: 'combobox', 'aria-expanded': 'false' }))).toBe(false)
  })

  it('is false for an expanded element that is not a combobox', () => {
    expect(isOpenCombobox(elementWith({ role: 'button', 'aria-expanded': 'true' }))).toBe(false)
  })

  it('is false for a plain input', () => {
    expect(isOpenCombobox(elementWith({}))).toBe(false)
  })

  it('is false when there is no element', () => {
    expect(isOpenCombobox(null)).toBe(false)
  })
})
