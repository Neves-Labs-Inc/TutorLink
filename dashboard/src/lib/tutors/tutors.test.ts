import { describe, it, expect } from 'vitest'

import {
  ALL_SUBJECTS,
  ceilingError,
  subjectSummary,
  tutorBioPayload,
  tutorCreatePayload,
  tutorFormErrors,
  tutorListParams,
  type TutorDraft,
  type TutorFilterState,
} from './tutors'
import type { TutorSubject } from '@/lib/queries/tutors'

const baseState: TutorFilterState = {
  q: '',
  subjectId: ALL_SUBJECTS,
  isActive: true,
  page: 1,
  pageSize: 20,
}

describe('tutorListParams', () => {
  it('always carries page, page_size and is_active', () => {
    expect(tutorListParams({ ...baseState, isActive: false, page: 3, pageSize: 50 })).toEqual({
      is_active: false,
      page: 3,
      page_size: 50,
    })
  })

  const blankTerms: { label: string; q: string }[] = [
    { label: 'empty', q: '' },
    { label: 'a single space', q: ' ' },
    { label: 'only whitespace', q: '   \t ' },
  ]

  it.each(blankTerms)('omits q when the term is $label', ({ q }) => {
    expect(tutorListParams({ ...baseState, q })).not.toHaveProperty('q')
  })

  it('trims a padded term', () => {
    expect(tutorListParams({ ...baseState, q: '  ada  ' }).q).toBe('ada')
  })

  it('omits subject_id for the all-subjects sentinel', () => {
    expect(tutorListParams({ ...baseState, subjectId: ALL_SUBJECTS })).not.toHaveProperty(
      'subject_id',
    )
  })

  it('carries a chosen subject_id', () => {
    expect(tutorListParams({ ...baseState, subjectId: 'subject-1' }).subject_id).toBe('subject-1')
  })

  it('composes a search term with a subject filter', () => {
    expect(tutorListParams({ ...baseState, q: 'ada', subjectId: 'subject-1', page: 2 })).toEqual({
      q: 'ada',
      subject_id: 'subject-1',
      is_active: true,
      page: 2,
      page_size: 20,
    })
  })
})

describe('subjectSummary', () => {
  const subject = (name: string, max_grade_level: number): TutorSubject => ({
    subject_id: name,
    name,
    max_grade_level,
  })

  it('renders an em-dash for no subjects', () => {
    expect(subjectSummary([])).toBe('—')
  })

  it('renders one subject with its grade ceiling', () => {
    expect(subjectSummary([subject('Math', 8)])).toBe('Math (to 8)')
  })

  it('joins several subjects with commas', () => {
    expect(subjectSummary([subject('Math', 8), subject('Science', 6)])).toBe(
      'Math (to 8), Science (to 6)',
    )
  })

  it('reads a Kindergarten ceiling as K', () => {
    expect(subjectSummary([subject('Reading', 0)])).toBe('Reading (to K)')
  })
})

describe('tutorFormErrors', () => {
  const validDraft: TutorDraft = {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: '+15551234567',
    bio: '',
  }

  it('accepts a valid draft', () => {
    expect(tutorFormErrors(validDraft)).toEqual([])
  })

  const singleFieldCases: { label: string; draft: Partial<TutorDraft>; expected: string }[] = [
    { label: 'an empty name', draft: { name: '' }, expected: 'Name is required.' },
    { label: 'a whitespace-only name', draft: { name: '   ' }, expected: 'Name is required.' },
    { label: 'an empty email', draft: { email: '' }, expected: 'Email is required.' },
    {
      label: 'an email with no @',
      draft: { email: 'ada.example.com' },
      expected: 'Email must be a valid address.',
    },
    { label: 'an empty phone', draft: { phone: '' }, expected: 'Phone number is required.' },
    {
      label: 'a whitespace-only phone',
      draft: { phone: '  ' },
      expected: 'Phone number is required.',
    },
  ]

  it.each(singleFieldCases)('reports $label', ({ draft, expected }) => {
    expect(tutorFormErrors({ ...validDraft, ...draft })).toEqual([expected])
  })

  it('does not judge the phone number format — the server owns that', () => {
    expect(tutorFormErrors({ ...validDraft, phone: 'not a phone' })).toEqual([])
  })

  it('collects every failure together', () => {
    expect(tutorFormErrors({ name: '', email: 'nope', phone: '', bio: '' })).toEqual([
      'Name is required.',
      'Email must be a valid address.',
      'Phone number is required.',
    ])
  })
})

describe('tutorBioPayload', () => {
  it('sends a blank bio as an empty string, never null', () => {
    expect(tutorBioPayload('   ')).toBe('')
  })

  it('trims a bio that has content', () => {
    expect(tutorBioPayload(' Teaches algebra ')).toBe('Teaches algebra')
  })
})

describe('tutorCreatePayload', () => {
  it('trims each field and sends a blank bio as an empty string', () => {
    expect(
      tutorCreatePayload({
        name: '  Ada Lovelace ',
        email: ' ada@example.com ',
        phone: ' +15551234567 ',
        bio: '   ',
      }),
    ).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      phone_number: '+15551234567',
      bio: '',
    })
  })

  it('keeps a trimmed bio when there is one', () => {
    expect(
      tutorCreatePayload({ name: 'Ada', email: 'a@b.c', phone: '1', bio: ' Teaches ' }),
    ).toEqual({ name: 'Ada', email: 'a@b.c', phone_number: '1', bio: 'Teaches' })
  })
})

describe('ceilingError', () => {
  it.each(['0', '12', ' 8 '])('accepts %s (0 is Kindergarten)', (text) => {
    expect(ceilingError(text)).toBeNull()
  })

  it.each(['-1', '13', '2.5', '', 'e'])('refuses %j', (text) => {
    expect(ceilingError(text)).toBe(
      'Highest grade taught must be a whole number from 0 (Kindergarten) to 12.',
    )
  })
})
