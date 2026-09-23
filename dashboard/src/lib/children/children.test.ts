import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { ageOn, formatDateOfBirth } from './children'

describe('ageOn', () => {
  const cases: { name: string; dateOfBirth: string; today: Date; expected: number }[] = [
    {
      name: 'turns the new age on the birthday itself',
      dateOfBirth: '2016-04-23',
      today: new Date(2026, 3, 23),
      expected: 10,
    },
    {
      name: 'stays one less the day before the birthday',
      dateOfBirth: '2016-04-23',
      today: new Date(2026, 3, 22),
      expected: 9,
    },
    {
      name: 'ages a leap-day birthday on 28 Feb of a non-leap year',
      dateOfBirth: '2016-02-29',
      today: new Date(2025, 1, 28),
      expected: 8,
    },
    {
      name: 'ages a leap-day birthday on 1 Mar of a non-leap year',
      dateOfBirth: '2016-02-29',
      today: new Date(2025, 2, 1),
      expected: 9,
    },
  ]

  it.each(cases)('$name', ({ dateOfBirth, today, expected }) => {
    expect(ageOn(dateOfBirth, today)).toBe(expected)
  })
})

describe('formatDateOfBirth', () => {
  it('renders "Not recorded" for a null date of birth', () => {
    expect(formatDateOfBirth(null, new Date(2026, 3, 23))).toBe('Not recorded')
  })

  it('renders the formatted date with the derived age', () => {
    expect(formatDateOfBirth('2016-04-23', new Date(2026, 3, 23))).toBe('23 Apr 2016 (age 10)')
  })

  describe('in a negative UTC offset', () => {
    beforeAll(() => {
      vi.stubEnv('TZ', 'America/Los_Angeles')
    })

    afterAll(() => {
      vi.unstubAllEnvs()
    })

    it('does not shift a bare API date a day back', () => {
      expect(formatDateOfBirth('2016-04-23', new Date(2026, 3, 23))).toBe(
        '23 Apr 2016 (age 10)',
      )
    })
  })
})
