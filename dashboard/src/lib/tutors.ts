import type { TutorCreate, TutorListParams, TutorSubject } from '@/lib/queries/tutors'

export type TutorFilterState = {
  q: string
  subjectId: string
  isActive: boolean
  page: number
  pageSize: number
}

export type TutorDraft = {
  name: string
  email: string
  phone: string
  bio: string
}

export const ALL_SUBJECTS = 'all'

const NO_SUBJECTS = '—'

export const tutorListParams = ({
  q,
  subjectId,
  isActive,
  page,
  pageSize,
}: TutorFilterState): TutorListParams => {
  const params: TutorListParams = { is_active: isActive, page, page_size: pageSize }
  const term = q.trim()

  if (term !== '') {
    params.q = term
  }

  if (subjectId !== ALL_SUBJECTS) {
    params.subject_id = subjectId
  }

  return params
}

export const subjectSummary = (subjects: TutorSubject[]): string =>
  subjects.length === 0
    ? NO_SUBJECTS
    : subjects.map((subject) => `${subject.name} (to ${subject.max_grade_level})`).join(', ')

export const tutorFormErrors = (draft: TutorDraft): string[] => {
  const errors: string[] = []

  if (draft.name.trim() === '') {
    errors.push('Name is required.')
  }

  if (draft.email.trim() === '') {
    errors.push('Email is required.')
  } else if (!draft.email.includes('@')) {
    errors.push('Email must be a valid address.')
  }

  if (draft.phone.trim() === '') {
    errors.push('Phone number is required.')
  }

  return errors
}

export const tutorBioPayload = (bio: string): string => bio.trim()

export const tutorCreatePayload = (draft: TutorDraft): TutorCreate => ({
  name: draft.name.trim(),
  email: draft.email.trim(),
  phone_number: draft.phone.trim(),
  bio: tutorBioPayload(draft.bio),
})
