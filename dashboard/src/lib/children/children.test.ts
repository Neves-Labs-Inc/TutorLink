import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import {
  ageOn,
  childDraftErrors,
  childDraftFrom,
  childInput,
  childUpdate,
  formatDateOfBirth,
  homesToOffer,
  type ChildDraft,
} from './children'
import type { ChildDetail } from '@/lib/queries/children'
import type { GuardianDetail, Home } from '@/lib/queries/guardians'

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

const VALID_DRAFT: ChildDraft = {
  name: 'Tommy Doe',
  dateOfBirth: '2016-04-23',
  gradeLevel: '7',
  schoolName: 'Lincoln Middle School',
  notes: '',
}
const TODAY = new Date(2026, 3, 23)

describe('childDraftErrors', () => {
  it('accepts 1900-01-01', () => {
    expect(childDraftErrors({ ...VALID_DRAFT, dateOfBirth: '1900-01-01' }, TODAY)).toEqual([])
  })

  it('accepts today', () => {
    expect(childDraftErrors({ ...VALID_DRAFT, dateOfBirth: '2026-04-23' }, TODAY)).toEqual([])
  })

  it('refuses tomorrow', () => {
    expect(childDraftErrors({ ...VALID_DRAFT, dateOfBirth: '2026-04-24' }, TODAY)).toContain(
      'Date of birth cannot be in the future.',
    )
  })

  it('refuses 1899-12-31', () => {
    expect(childDraftErrors({ ...VALID_DRAFT, dateOfBirth: '1899-12-31' }, TODAY)).toContain(
      'Date of birth must be on or after 1900-01-01.',
    )
  })

  it('refuses 2016-02-30', () => {
    expect(childDraftErrors({ ...VALID_DRAFT, dateOfBirth: '2016-02-30' }, TODAY)).toContain(
      'Date of birth must be a real date.',
    )
  })

  it('refuses grade 0', () => {
    expect(childDraftErrors({ ...VALID_DRAFT, gradeLevel: '0' }, TODAY)).toContain(
      'Grade level must be a whole number of at least 1.',
    )
  })

  it('refuses grade 2.5', () => {
    expect(childDraftErrors({ ...VALID_DRAFT, gradeLevel: '2.5' }, TODAY)).toContain(
      'Grade level must be a whole number of at least 1.',
    )
  })

  it('refuses 2001-character notes', () => {
    expect(
      childDraftErrors({ ...VALID_DRAFT, notes: 'a'.repeat(2001) }, TODAY),
    ).toContain('Notes cannot be longer than 2000 characters.')
  })

  it('refuses a blank name', () => {
    expect(childDraftErrors({ ...VALID_DRAFT, name: '  ' }, TODAY)).toContain('Name is required.')
  })

  it('refuses a blank school', () => {
    expect(childDraftErrors({ ...VALID_DRAFT, schoolName: '  ' }, TODAY)).toContain(
      'School name is required.',
    )
  })
})

describe('childInput', () => {
  it('turns notes "  " into null', () => {
    expect(childInput({ ...VALID_DRAFT, notes: '  ' }).notes).toBeNull()
  })

  it('trims name and school', () => {
    const input = childInput({ ...VALID_DRAFT, name: ' Tommy Doe ', schoolName: ' Lincoln Middle School ' })

    expect(input.name).toBe('Tommy Doe')
    expect(input.school_name).toBe('Lincoln Middle School')
  })
})

const CHILD_DETAIL: ChildDetail = {
  id: 'child-1',
  name: 'Tommy Doe',
  date_of_birth: '2016-04-23',
  grade_level: 7,
  school_name: 'Lincoln Middle School',
  notes: null,
  is_active: true,
  upcoming_session_count: 0,
  guardians: [],
  homes: [],
}

describe('childDraftFrom', () => {
  it('leaves date of birth empty for a legacy child with none', () => {
    expect(childDraftFrom({ ...CHILD_DETAIL, date_of_birth: null }).dateOfBirth).toBe('')
  })
})

describe('childUpdate', () => {
  it('returns {} for an unchanged draft', () => {
    expect(childUpdate(childDraftFrom(CHILD_DETAIL), CHILD_DETAIL)).toEqual({})
  })

  it('returns { notes: "" } for cleared notes', () => {
    const original = { ...CHILD_DETAIL, notes: 'Some notes' }

    expect(childUpdate(childDraftFrom(original), original)).toEqual({})
    expect(
      childUpdate({ ...childDraftFrom(original), notes: '' }, original),
    ).toEqual({ notes: '' })
  })

  it('never includes guardian_ids, home_ids or is_active', () => {
    const original = { ...CHILD_DETAIL, notes: 'Some notes' }
    const update = childUpdate({ ...childDraftFrom(original), name: 'New Name' }, original)

    expect(update).not.toHaveProperty('guardian_ids')
    expect(update).not.toHaveProperty('home_ids')
    expect(update).not.toHaveProperty('is_active')
  })
})

const homeFixture = (id: string, isActive: boolean): Home => ({
  id,
  label: null,
  address: `${id} address`,
  access_code: '1234',
  is_active: isActive,
})

const guardianFixture = (id: string, homes: Home[]): GuardianDetail => ({
  id,
  name: `Guardian ${id}`,
  phone_number: '+12025550123',
  is_active: true,
  homes,
  children: [],
})

describe('homesToOffer', () => {
  it('drops inactive homes, keeps order, and lists a shared home once', () => {
    const homeA = homeFixture('home-a', true)
    const homeB = homeFixture('home-b', true)
    const homeInactive = homeFixture('home-inactive', false)
    const homeC = homeFixture('home-c', true)
    const guardianOne = guardianFixture('g1', [homeA, homeB, homeInactive])
    const guardianTwo = guardianFixture('g2', [homeB, homeC])

    expect(homesToOffer([guardianOne, guardianTwo])).toEqual([homeA, homeB, homeC])
  })

  it('returns [] with no guardians', () => {
    expect(homesToOffer([])).toEqual([])
  })
})
