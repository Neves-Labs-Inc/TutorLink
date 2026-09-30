import { describe, it, expect } from 'vitest'
import { householdListParams, householdCountLabel } from './households'
import type { HouseholdListParams } from '../queries/households'

describe('householdListParams', () => {
  const cases: { name: string; q: string; page: number; pageSize: number; expected: HouseholdListParams }[] = [
    {
      name: 'drops a whitespace-only search term',
      q: '  ',
      page: 2,
      pageSize: 20,
      expected: { page: 2, page_size: 20 },
    },
    {
      name: 'trims a padded search term',
      q: ' Kid ',
      page: 1,
      pageSize: 20,
      expected: { q: 'Kid', page: 1, page_size: 20 },
    },
    {
      name: 'carries page and page size on a later page',
      q: '',
      page: 3,
      pageSize: 50,
      expected: { page: 3, page_size: 50 },
    },
  ]

  it.each(cases)('$name', ({ q, page, pageSize, expected }) => {
    expect(householdListParams(q, page, pageSize)).toEqual(expected)
  })
})

describe('householdCountLabel', () => {
  it('uses the singular for one household', () => {
    expect(householdCountLabel(1)).toBe('1 household')
  })

  it('uses the plural for any other count', () => {
    expect(householdCountLabel(3)).toBe('3 households')
    expect(householdCountLabel(0)).toBe('0 households')
  })
})
