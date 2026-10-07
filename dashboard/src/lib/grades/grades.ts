// Grades run K to 12, with Kindergarten stored as 0: the API's bounds for the Overall grade,
// Subject levels and a tutor's ceiling alike.
export const LOWEST_GRADE = 0
export const HIGHEST_GRADE = 12

// Text inputs, so unparseable text such as "e" reaches validation instead of reading as empty.
const WHOLE_NUMBER_PATTERN = /^\d+$/

export const isGradeText = (text: string): boolean => {
  const trimmed = text.trim()

  return WHOLE_NUMBER_PATTERN.test(trimmed) && Number(trimmed) <= HIGHEST_GRADE
}

const KINDERGARTEN = 'Kindergarten'
const KINDERGARTEN_SHORT = 'K'

// "Kindergarten" / "Grade 7": how a grade reads on its own.
export const gradeName = (level: number): string =>
  level === LOWEST_GRADE ? KINDERGARTEN : `Grade ${level}`

// "K" / "7": the compact form for inline lists.
export const gradeShort = (level: number): string =>
  level === LOWEST_GRADE ? KINDERGARTEN_SHORT : String(level)
