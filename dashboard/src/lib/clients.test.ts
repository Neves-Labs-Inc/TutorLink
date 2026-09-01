import { describe, it, expect } from 'vitest'
import { clientListParams, formatPhoneForDisplay, type ClientFilterState } from './clients'
import type { ClientListParams } from './queries/clients'

describe('clientListParams', () => {
  const baseState: ClientFilterState = { q: '', isActive: true, page: 1, pageSize: 20 }

  const cases: { name: string; state: ClientFilterState; expected: ClientListParams }[] = [
    {
      name: 'drops an empty search term',
      state: baseState,
      expected: { is_active: true, page: 1, page_size: 20 },
    },
    {
      name: 'drops a whitespace-only search term',
      state: { ...baseState, q: '   ' },
      expected: { is_active: true, page: 1, page_size: 20 },
    },
    {
      name: 'keeps a search term of pure digits',
      state: { ...baseState, q: '555' },
      expected: { q: '555', is_active: true, page: 1, page_size: 20 },
    },
    {
      name: 'trims a padded search term',
      state: { ...baseState, q: '  ann  ' },
      expected: { q: 'ann', is_active: true, page: 1, page_size: 20 },
    },
    {
      name: 'carries page and page size on a later page',
      state: { ...baseState, page: 3, pageSize: 50 },
      expected: { is_active: true, page: 3, page_size: 50 },
    },
    {
      name: 'asks for inactive clients',
      state: { ...baseState, isActive: false },
      expected: { is_active: false, page: 1, page_size: 20 },
    },
  ]

  it.each(cases)('$name', ({ state, expected }) => {
    expect(clientListParams(state)).toEqual(expected)
  })
})

describe('formatPhoneForDisplay', () => {
  const cases: { input: string; expected: string }[] = [
    { input: '+12025550123', expected: '+1 (202) 555-0123' },
    { input: '+442071838750', expected: '+442071838750' },
    { input: '+5511987654321', expected: '+5511987654321' },
    { input: '+1202555012', expected: '+1202555012' },
    { input: '2025550123', expected: '2025550123' },
    { input: '', expected: '' },
  ]

  it.each(cases)('renders $input as $expected', ({ input, expected }) => {
    expect(formatPhoneForDisplay(input)).toBe(expected)
  })
})
