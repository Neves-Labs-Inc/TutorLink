import { exceptionTimesAcceptable, exceptionWindowLabel } from '@/lib/availability/availability'
import { addDaysIso } from '@/lib/dates/dates'
import type { ExceptionCreate, ExceptionReason, TutorException } from '@/lib/queries/exceptions'

export type TimeOffTab = 'upcoming' | 'past'

export type ExceptionDraft = {
  startDate: string
  endDate: string
  startTime: string
  endTime: string
  reason: ExceptionReason
  notes: string
}

export const emptyDraft = (): ExceptionDraft => ({
  startDate: '',
  endDate: '',
  startTime: '',
  endTime: '',
  reason: 'vacation',
  notes: '',
})

export const timeOffWindow = (
  tab: TimeOffTab,
  todayIso: string,
): { from?: string; to?: string } =>
  tab === 'upcoming' ? { from: todayIso } : { to: addDaysIso(todayIso, -1) }

export const draftProblem = (draft: ExceptionDraft): string | null => {
  let problem: string | null = null

  if (draft.startDate === '' || draft.endDate === '') {
    problem = 'Choose both a first and a last day.'
  } else if (draft.endDate < draft.startDate) {
    problem = 'The last day must be on or after the first day.'
  } else if (!exceptionTimesAcceptable(draft.startTime, draft.endTime)) {
    problem = 'Set both times, or neither, and end the range after it starts.'
  }

  return problem
}

export const draftToCreate = (draft: ExceptionDraft): ExceptionCreate => ({
  start_date: draft.startDate,
  end_date: draft.endDate,
  start_time: draft.startTime === '' ? null : draft.startTime,
  end_time: draft.endTime === '' ? null : draft.endTime,
  reason: draft.reason,
  notes: draft.notes.trim() === '' ? null : draft.notes.trim(),
})

export const canWithdraw = (exception: TutorException): boolean => exception.status === 'pending'

export const withdrawConfirmBody = (exception: TutorException): string =>
  `Your request for ${exceptionWindowLabel(exception)} is removed. Nothing about your availability changes, because a pending request does not block bookings.`

export const lockedReason = (exception: TutorException): string | null => {
  let reason: string | null = null

  if (exception.status === 'approved') {
    reason = 'An admin has approved this request.'
  } else if (exception.status === 'rejected') {
    reason = 'An admin has rejected this request.'
  }

  return reason
}
