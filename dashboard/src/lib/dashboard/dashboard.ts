import { dayOfWeekFromIso } from '@/lib/availability/availability'
import { DAY_LABELS, formatIsoDate, todayLocalIso } from '@/lib/dates/dates'
import type { BookingListParams } from '@/lib/queries/bookings'

export type TableStatus = 'pending' | 'error' | 'ready'

export const TODAY_SESSIONS_PAGE_SIZE = 100

const WEEKDAY_LABELS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]

export const todaySessionsParams = (date: string): BookingListParams => ({
  status: ['pending', 'confirmed'],
  from: date,
  to: date,
  page_size: TODAY_SESSIONS_PAGE_SIZE,
})

export const upcomingWeekLabel = (date: string, weekEnd: string): string => {
  let label: string

  if (weekEnd === date) {
    label = 'The rest of this week is over'
  } else {
    const weekday = DAY_LABELS[dayOfWeekFromIso(weekEnd)]

    label = `Tomorrow through ${weekday} ${formatIsoDate(weekEnd)}`
  }

  return label
}

export const queriedDateLabel = (iso: string): string =>
  `${WEEKDAY_LABELS[dayOfWeekFromIso(iso)]}, ${formatIsoDate(iso)}`

export const todaySessionsCaption = (date: string, total: number): string => {
  let caption = `Live sessions on ${formatIsoDate(date)}`

  if (total > TODAY_SESSIONS_PAGE_SIZE) {
    caption += ` (showing first ${TODAY_SESSIONS_PAGE_SIZE} of ${total})`
  }

  return caption
}

export const hasDateRolledOver = (queriedIso: string, now: Date): boolean =>
  todayLocalIso(now) !== queriedIso

export const tableStatus = (isPending: boolean, isError: boolean): TableStatus => {
  let status: TableStatus

  if (isPending) {
    status = 'pending'
  } else if (isError) {
    status = 'error'
  } else {
    status = 'ready'
  }

  return status
}
