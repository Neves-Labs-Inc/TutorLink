import { dayOfWeekFromIso, exceptionReasonLabel } from '@/lib/availability/availability'
import { addDaysIso, formatIsoDate, formatTime } from '@/lib/dates/dates'
import type { AvailabilitySlot } from '@/lib/queries/availability'
import type { TutorException } from '@/lib/queries/exceptions'

export type BlockingState = 'clear' | 'partly-blocked' | 'blocked'

export type SlotBlocking = { state: BlockingState; label: string | null }

const DAYS_IN_WEEK = 7

const CLEAR: SlotBlocking = { state: 'clear', label: null }

const BLOCKING_RANK: Record<BlockingState, number> = {
  clear: 0,
  'partly-blocked': 1,
  blocked: 2,
}

// `day_of_week` is 0 = Monday, so a date's own index is how far it sits past its Monday.
// `Date.getDay()` is 0 = Sunday: mixing the two moves the whole grid one day and reports nothing.
export const weekStartIso = (iso: string): string => addDaysIso(iso, -dayOfWeekFromIso(iso))

// Index `i` of the result is `day_of_week === i`, which is what lets the grid index straight off
// `byDayOfWeek` and `DAY_LABELS`.
export const weekDaysIso = (weekStart: string): string[] =>
  Array.from({ length: DAYS_IN_WEEK }, (_, index) => addDaysIso(weekStart, index))

export const weekRangeLabel = (weekStart: string): string =>
  `${formatIsoDate(weekStart)} – ${formatIsoDate(addDaysIso(weekStart, DAYS_IN_WEEK - 1))}`

export const dayDateLabel = (iso: string): string =>
  formatIsoDate(iso).split(' ').slice(0, 2).join(' ')

export const shiftWeek = (weekStart: string, weeks: number): string =>
  addDaysIso(weekStart, weeks * DAYS_IN_WEEK)

// `GET /api/tutors/{id}/availability` deliberately returns deactivated slots (`api-design.md:68`);
// a withdrawn slot is not availability and must not read as bookable time on a tutor's own grid.
export const activeSlots = (slots: AvailabilitySlot[]): AvailabilitySlot[] =>
  slots.filter((slot) => slot.is_active)

// Both dates are inclusive, and only an approved row subtracts from availability — `pending` and
// `rejected` come back in the same list and block nothing (`api-design.md:995`).
export const approvedOnDay = (dayIso: string, exceptions: TutorException[]): TutorException[] =>
  exceptions.filter(
    (exception) =>
      exception.status === 'approved' &&
      exception.start_date <= dayIso &&
      dayIso <= exception.end_date,
  )

export const slotBlocking = (
  slot: AvailabilitySlot,
  dayExceptions: TutorException[],
): SlotBlocking => {
  let blocking = CLEAR

  for (const exception of dayExceptions) {
    const state = blockingState(slot, exception)

    if (BLOCKING_RANK[state] > BLOCKING_RANK[blocking.state]) {
      blocking = { state, label: blockingLabel(exception, state) }
    }
  }

  return blocking
}

// Times are `HH:MM:SS` and compare correctly as strings; parsing them to `Date` would only invent a
// date and a timezone the row does not carry. The hours apply to every day of the span, so the
// caller passes the exceptions that already cover the day being drawn.
const blockingState = (slot: AvailabilitySlot, exception: TutorException): BlockingState => {
  const start = exception.start_time
  const end = exception.end_time
  let state: BlockingState

  if (start === null || end === null) {
    state = 'blocked'
  } else if (start >= slot.end_time || end <= slot.start_time) {
    // Half-open on both sides: an absence ending exactly when a slot starts leaves that slot clear.
    state = 'clear'
  } else if (start <= slot.start_time && end >= slot.end_time) {
    state = 'blocked'
  } else {
    state = 'partly-blocked'
  }

  return state
}

const blockingLabel = (exception: TutorException, state: BlockingState): string => {
  const reason = exceptionReasonLabel(exception.reason)
  let label: string

  if (state === 'partly-blocked' && exception.start_time !== null && exception.end_time !== null) {
    label = `${reason}, ${formatTime(exception.start_time)} – ${formatTime(exception.end_time)}`
  } else {
    label = reason
  }

  return label
}
