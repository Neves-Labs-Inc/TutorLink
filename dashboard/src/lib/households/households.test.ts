import { describe, it, expect } from 'vitest'
import { householdListParams, householdCountLabel, householdCardTargetId } from './households'
import type { Household, HouseholdListParams } from '../queries/households'

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

describe('householdCardTargetId', () => {
  const guardian = (id: string) => ({
    id,
    name: `Guardian ${id}`,
    phone_number: '+15550100',
    is_active: true,
  })
  const cases: { name: string; guardianIds: string[]; expected: string | null }[] = [
    { name: 'returns the first guardian id when there are several', guardianIds: ['g-1', 'g-2', 'g-3'], expected: 'g-1' },
    { name: 'returns the only guardian id', guardianIds: ['g-9'], expected: 'g-9' },
    { name: 'returns null when there are no guardians', guardianIds: [], expected: null },
  ]

  it.each(cases)('$name', ({ guardianIds, expected }) => {
    const household: Household = { key: 'h', guardians: guardianIds.map(guardian), children: [] }

    expect(householdCardTargetId(household)).toBe(expected)
  })
})
