import { formatIsoDate, formatTime } from '@/lib/dates/dates'
import type { ChildListParams, ChildSummary } from '@/lib/queries/children'

export type ChildrenFilterState = {
  q: string
  showInactive: boolean
  page: number
  pageSize: number
}

// The Tutors/Clients toggle semantics: active by default, `is_active: false` behind "Show
// inactive", never both (constitution §9).
export const childListParams = (state: ChildrenFilterState): ChildListParams => {
  const params: ChildListParams = {
    is_active: !state.showInactive,
    page: state.page,
    page_size: state.pageSize,
  }
  const term = state.q.trim()

  if (term !== '') {
    params.q = term
  }

  return params
}

export const guardianNames = (row: ChildSummary): string =>
  row.guardians.length === 0 ? '—' : row.guardians.map((guardian) => guardian.name).join(', ')

export const homeNames = (row: ChildSummary): string =>
  row.homes.length === 0 ? '—' : row.homes.map((home) => home.label ?? home.address).join(', ')

export const nextSessionLabel = (row: ChildSummary): string => {
  const session = row.next_session

  return session === null
    ? 'None scheduled'
    : `${formatIsoDate(session.scheduled_date)} · ${formatTime(session.start_time)} · ${session.subject.name} with ${session.tutor.name}`
}

// P7C-O: `count` is `upcoming_session_count`, the same predicate the server cancels by.
export const deactivateMessage = (name: string, count: number): string => {
  let message: string

  if (count === 0) {
    message = `Deactivate ${name}?`
  } else if (count === 1) {
    message = `Deactivate ${name}? This will cancel 1 upcoming session. Nobody will be notified.`
  } else {
    message = `Deactivate ${name}? This will cancel ${count} upcoming sessions. Nobody will be notified.`
  }

  return message
}
