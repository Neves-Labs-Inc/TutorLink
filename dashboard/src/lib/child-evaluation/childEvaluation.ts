import { formatIsoDate, todayLocalIso } from '@/lib/dates/dates'
import { gradeLabel } from '@/lib/children/children'
import { guardianNames } from '@/lib/children-list/childrenList'
import { gradeShort, HIGHEST_GRADE, LOWEST_GRADE } from '@/lib/grades/grades'
import type { ChildDetail, ChildLevel, ChildSummary, Evaluated } from '@/lib/queries/children'
import type { Subject } from '@/lib/queries/subjects'

export type ChildTab = 'all' | 'awaiting'

export type AwaitingRow = {
  id: string
  name: string
  guardians: string
  grade: string
  since: string
}

export const OVERALL_GRADE_LABEL = 'Overall grade (estimate)'
export const OVERALL_GRADE_HINT = 'Asked at Intake. Staff-only estimate, never used for matching.'
export const GRADE_NOT_SET = 'Grade not set'
export const NOT_EVALUATED = 'Not evaluated'
export const MARK_NEEDS_LEVEL = 'Add at least one Subject level before marking Evaluated.'
export const LAST_LEVEL_REASON =
  'An Evaluated Child needs at least one Subject level. Clear Evaluated first.'
export const INACTIVE_SUBJECT_SUFFIX = '(inactive subject)'
export const LEVELS_EMPTY = 'No Subject levels yet.'
export const AWAITING_EMPTY = 'No Children awaiting evaluation.'
export const AWAITING_SEARCH_EMPTY = 'No children match that search.'

export const LEVEL_HEADERS = {
  subject: 'Subject',
  level: 'Subject level',
  setBy: 'Set by',
  actions: 'Actions',
}
export const levelFallbackError = (action: 'save' | 'remove' | 'add', subjectName: string): string =>
  `Could not ${action} the ${subjectName} level.`
export const MARK_FALLBACK_ERROR = 'Could not mark this Child Evaluated.'
export const CLEAR_FALLBACK_ERROR = 'Could not clear Evaluated.'

const AWAITING_TAB_LABEL = 'Awaiting evaluation'
const NO_VALUE = '—'
const AWAITING_TAB_VALUE = 'awaiting'

export const LEVEL_OPTIONS: { value: number; label: string }[] = Array.from(
  { length: HIGHEST_GRADE - LOWEST_GRADE + 1 },
  (_, index) => ({ value: LOWEST_GRADE + index, label: gradeShort(LOWEST_GRADE + index) }),
)

// The add-level form's starting (and post-add) level, as a select value.
export const DEFAULT_LEVEL = String(LEVEL_OPTIONS[0].value)

export const levelLabel = (level: number): string => gradeShort(level)

// The mark is business-local; the dashboard's local calendar date is that date (timezone is fixed).
const dateOf = (timestamp: string): string => formatIsoDate(todayLocalIso(new Date(timestamp)))

// The last level of an Evaluated Child holds the mark up, so the API refuses to remove it.
export const canRemoveLevel = (child: ChildDetail): boolean =>
  child.evaluated === null || child.levels.length > 1

export const canMarkEvaluated = (child: ChildDetail): boolean => child.levels.length > 0

export const addableSubjects = (subjects: Subject[], levels: ChildLevel[]): Subject[] => {
  const levelled = new Set(levels.map((entry) => entry.subject_id))

  return subjects.filter((subject) => subject.is_active && !levelled.has(subject.id))
}

export const isLevelMuted = (level: ChildLevel): boolean => !level.is_active

export const evaluatedStatusLabel = (evaluated: Evaluated | null): string =>
  evaluated === null
    ? NOT_EVALUATED
    : `Evaluated by ${evaluated.by.display_name}, ${dateOf(evaluated.at)}`

export const evaluatedCell = (evaluated: Evaluated | null): string =>
  evaluated === null ? NO_VALUE : `${evaluated.by.display_name}, ${dateOf(evaluated.at)}`

const firstName = (name: string): string => name.trim().split(/\s+/)[0]

export const notEvaluatedConsequence = (name: string): string =>
  `The bot sends any booking for ${firstName(name)} to the office as the evaluation session.`

// Split from the subject name so the screen can set the name in bolder type.
export const NO_LEVEL_HINT_REST = ' · No level: the bot hands bookings for this subject to the office.'

export const noLevelHint = (subjectName: string): string => `${subjectName}${NO_LEVEL_HINT_REST}`

export const clearEvaluatedBody = (name: string): string =>
  `${name}'s Subject levels stay. Until Staff mark Evaluated again, the bot sends any booking to the office as the evaluation session.`

export const awaitingTabLabel = (total: number | null): string =>
  total === null ? AWAITING_TAB_LABEL : `${AWAITING_TAB_LABEL} (${total})`

export const awaitingRow = (row: ChildSummary): AwaitingRow => ({
  id: row.id,
  name: row.name,
  guardians: guardianNames(row),
  grade: gradeLabel(row.grade_level),
  since: dateOf(row.created_at),
})

export const childTabFrom = (value: string | null): ChildTab =>
  value === AWAITING_TAB_VALUE ? 'awaiting' : 'all'
