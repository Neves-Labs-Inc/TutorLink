import { formatIsoDate, todayLocalIso } from '@/lib/dates/dates'
import type { ChildDetail, ChildInput, ChildUpdate } from '@/lib/queries/children'
import type { GuardianDetail, Home } from '@/lib/queries/guardians'

export type ChildDraft = {
  name: string
  dateOfBirth: string
  gradeLevel: string
  schoolName: string
  notes: string
}

export const EMPTY_CHILD_DRAFT: ChildDraft = {
  name: '',
  dateOfBirth: '',
  gradeLevel: '',
  schoolName: '',
  notes: '',
}

const MIN_DATE_OF_BIRTH = '1900-01-01'
const MAX_NOTES_LENGTH = 2000
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

const isRealIsoDate = (value: string): boolean => {
  let result = false

  if (ISO_DATE_PATTERN.test(value)) {
    const [year, month, day] = value.split('-').map(Number)
    const date = new Date(Date.UTC(year, month - 1, day))

    result =
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
  }

  return result
}

export const childDraftErrors = (draft: ChildDraft, today: Date): string[] => {
  const errors: string[] = []
  const dateOfBirth = draft.dateOfBirth.trim()

  if (draft.name.trim() === '') {
    errors.push('Name is required.')
  }

  if (dateOfBirth === '') {
    errors.push('Date of birth is required.')
  } else if (!isRealIsoDate(dateOfBirth)) {
    errors.push('Date of birth must be a real date.')
  } else if (dateOfBirth > todayLocalIso(today)) {
    errors.push('Date of birth cannot be in the future.')
  } else if (dateOfBirth < MIN_DATE_OF_BIRTH) {
    errors.push('Date of birth must be on or after 1900-01-01.')
  }

  const gradeLevel = Number(draft.gradeLevel)

  if (draft.gradeLevel.trim() === '' || !Number.isInteger(gradeLevel) || gradeLevel < 1) {
    errors.push('Grade level must be a whole number of at least 1.')
  }

  if (draft.schoolName.trim() === '') {
    errors.push('School name is required.')
  }

  if (draft.notes.length > MAX_NOTES_LENGTH) {
    errors.push(`Notes cannot be longer than ${MAX_NOTES_LENGTH} characters.`)
  }

  return errors
}

export const childInput = (draft: ChildDraft): ChildInput => {
  const notes = draft.notes.trim()

  return {
    name: draft.name.trim(),
    date_of_birth: draft.dateOfBirth.trim(),
    grade_level: Number(draft.gradeLevel),
    school_name: draft.schoolName.trim(),
    notes: notes === '' ? null : notes,
  }
}

export const childDraftFrom = (child: ChildDetail): ChildDraft => ({
  name: child.name,
  dateOfBirth: child.date_of_birth ?? '',
  gradeLevel: String(child.grade_level),
  schoolName: child.school_name,
  notes: child.notes ?? '',
})

export const childUpdate = (draft: ChildDraft, original: ChildDetail): ChildUpdate => {
  const update: ChildUpdate = {}
  const name = draft.name.trim()
  const dateOfBirth = draft.dateOfBirth.trim()
  const gradeLevel = Number(draft.gradeLevel)
  const schoolName = draft.schoolName.trim()
  const notes = draft.notes.trim()

  if (name !== original.name) {
    update.name = name
  }

  if (dateOfBirth !== (original.date_of_birth ?? '')) {
    update.date_of_birth = dateOfBirth
  }

  if (gradeLevel !== original.grade_level) {
    update.grade_level = gradeLevel
  }

  if (schoolName !== original.school_name) {
    update.school_name = schoolName
  }

  if (notes !== (original.notes ?? '')) {
    update.notes = notes
  }

  return update
}

export const homesToOffer = (guardians: GuardianDetail[]): Home[] => {
  const seen = new Set<string>()
  const homes: Home[] = []

  for (const guardian of guardians) {
    for (const home of guardian.homes) {
      if (home.is_active && !seen.has(home.id)) {
        seen.add(home.id)
        homes.push(home)
      }
    }
  }

  return homes
}

export const ageOn = (dateOfBirth: string, today: Date): number => {
  const [birthYear, birthMonth, birthDay] = dateOfBirth.split('-').map(Number)
  const todayMonth = today.getMonth() + 1
  const todayDay = today.getDate()
  let age = today.getFullYear() - birthYear

  if (todayMonth < birthMonth || (todayMonth === birthMonth && todayDay < birthDay)) {
    age -= 1
  }

  return age
}

export const formatDateOfBirth = (dateOfBirth: string | null, today: Date): string => {
  let result: string

  if (dateOfBirth === null) {
    result = 'Not recorded'
  } else {
    result = `${formatIsoDate(dateOfBirth)} (age ${ageOn(dateOfBirth, today)})`
  }

  return result
}
