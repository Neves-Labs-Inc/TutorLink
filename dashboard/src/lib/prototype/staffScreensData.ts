// PROTOTYPE ONLY (ticket #112). Hard-coded data for /prototype/staff-screens. Throw away.

export type PrototypeSubject = {
  id: string
  name: string
  spanishName: string | null
  isActive: boolean
}

export type PrototypeSubjectLevel = {
  subjectId: string
  level: number
  setBy: string
}

export type PrototypeEvaluated = { by: string; on: string } | null

export type PrototypeChild = {
  id: string
  name: string
  guardian: string
  overallGrade: number | null
  levels: PrototypeSubjectLevel[]
  evaluated: PrototypeEvaluated
}

export type GuardianLanguage = 'en' | 'es' | 'none'

export const CURRENT_STAFF = 'Daniel Reyes'
export const HOLDING_STAFF = 'Maria Lopez'
export const GUARDIAN_NAME = 'Rosa Torres'
export const GUARDIAN_PHONE = '+1 (305) 555-0142'
export const TODAY_LABEL = 'Oct 4'

export const GRADE_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

export const SUBJECTS: PrototypeSubject[] = [
  { id: 'math', name: 'Math', spanishName: 'Matemáticas', isActive: true },
  { id: 'reading', name: 'Reading', spanishName: 'Lectura', isActive: true },
  { id: 'science', name: 'Science', spanishName: null, isActive: true },
  { id: 'writing', name: 'Writing', spanishName: 'Escritura', isActive: false },
]

export const ACTIVE_SUBJECTS = SUBJECTS.filter((subject) => subject.isActive)

// Shown only when the "inactive subject level" prototype toggle is on.
export const INACTIVE_SUBJECT_LEVEL: PrototypeSubjectLevel = {
  subjectId: 'writing',
  level: 5,
  setBy: 'Maria',
}

export const CHILDREN: Record<string, PrototypeChild> = {
  ana: {
    id: 'ana',
    name: 'Ana Torres',
    guardian: GUARDIAN_NAME,
    overallGrade: 5,
    levels: [
      { subjectId: 'math', level: 4, setBy: 'Maria' },
      { subjectId: 'reading', level: 6, setBy: 'Maria' },
    ],
    evaluated: { by: 'Maria', on: 'Oct 2' },
  },
  luis: {
    id: 'luis',
    name: 'Luis Torres',
    guardian: GUARDIAN_NAME,
    overallGrade: 3,
    levels: [],
    evaluated: null,
  },
}

export type AwaitingRow = {
  childId: string
  child: string
  guardian: string
  overallGrade: number | null
  reason: string
  since: string
}

export const AWAITING_ROWS: AwaitingRow[] = [
  { childId: 'luis', child: 'Luis Torres', guardian: GUARDIAN_NAME, overallGrade: 3, reason: 'Not evaluated', since: 'Sep 28' },
  { childId: 'ana', child: 'Ana Torres', guardian: GUARDIAN_NAME, overallGrade: 5, reason: 'No level: Science', since: 'Oct 3' },
  { childId: 'luis', child: 'Mateo Silva', guardian: 'Carmen Silva', overallGrade: 0, reason: 'Not evaluated', since: 'Oct 1' },
  { childId: 'ana', child: 'Sofia Ramirez', guardian: 'Jorge Ramirez', overallGrade: 8, reason: 'No level: Reading, Science', since: 'Sep 30' },
  { childId: 'luis', child: 'Diego Castro', guardian: 'Lucia Castro', overallGrade: null, reason: 'Not evaluated', since: 'Oct 4' },
]

export type ChildListRow = {
  childId: string
  name: string
  guardian: string
  overallGrade: number | null
  evaluated: string
}

export const ALL_CHILDREN_ROWS: ChildListRow[] = [
  { childId: 'ana', name: 'Ana Torres', guardian: GUARDIAN_NAME, overallGrade: 5, evaluated: 'Maria, Oct 2' },
  { childId: 'luis', name: 'Luis Torres', guardian: GUARDIAN_NAME, overallGrade: 3, evaluated: '—' },
  { childId: 'ana', name: 'Camila Ortiz', guardian: 'Pedro Ortiz', overallGrade: 2, evaluated: 'Daniel, Sep 21' },
  { childId: 'luis', name: 'Mateo Silva', guardian: 'Carmen Silva', overallGrade: 0, evaluated: '—' },
  { childId: 'ana', name: 'Sofia Ramirez', guardian: 'Jorge Ramirez', overallGrade: 8, evaluated: 'Maria, Sep 15' },
  { childId: 'luis', name: 'Diego Castro', guardian: 'Lucia Castro', overallGrade: null, evaluated: '—' },
]

export const formatLevel = (level: number): string => (level === 0 ? 'K' : String(level))

export const formatOverallGrade = (grade: number | null): string => {
  if (grade === null) return 'Grade not set'
  if (grade === 0) return 'Kindergarten'
  return `Grade ${grade}`
}

export const findSubject = (subjectId: string): PrototypeSubject =>
  SUBJECTS.find((subject) => subject.id === subjectId) ?? SUBJECTS[0]

export const LANGUAGE_LABELS: Record<GuardianLanguage, string> = {
  en: 'English',
  es: 'Spanish',
  none: 'Not detected — English used',
}

export const formatHour = (hour: number): string => {
  const suffix = hour < 12 ? 'AM' : 'PM'
  const display = hour % 12 === 0 ? 12 : hour % 12
  return `${display} ${suffix}`
}
