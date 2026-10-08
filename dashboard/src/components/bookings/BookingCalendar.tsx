import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import {
  AGENDA_LIST_CLASSES,
  CalendarDayHeading,
  GRID_LIST_CLASSES,
} from '@/components/bookings/CalendarDayHeading'
import { CalendarEntry } from '@/components/bookings/CalendarEntry'
import { CalendarWeekSkeleton } from '@/components/bookings/CalendarWeekSkeleton'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { errorDetail } from '@/lib/api'
import { groupBookingsByDay, type CalendarDay } from '@/lib/booking-calendar/booking-calendar'
import { todayLocalIso } from '@/lib/dates/dates'
import type { Booking } from '@/lib/queries/bookings'
import {
  shiftWeek,
  weekDaysIso,
  weekRangeLabel,
  weekStartIso,
} from '@/lib/tutor-schedule/tutorSchedule'

export type BookingCalendarStatus = 'pending' | 'error' | 'ready'

export type BookingCalendarQuery = {
  status: BookingCalendarStatus
  bookings: Booking[]
  error: unknown
  refetch: () => void
}

type BookingCalendarProps = {
  weekStart: string
  onWeekChange: (weekStart: string) => void
  query: BookingCalendarQuery
  filtersActive: boolean
  onSelect: (bookingId: string) => void
}

type WeekBodyProps = {
  days: CalendarDay[]
  todayIso: string
  onSelect: (bookingId: string) => void
}

const LOAD_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const EMPTY_WEEK = 'No bookings this week.'
const EMPTY_FILTERED_WEEK = 'No bookings match these filters this week.'

const navButtonClasses = 'h-11 md:h-8'

export const BookingCalendar = ({
  weekStart,
  onWeekChange,
  query,
  filtersActive,
  onSelect,
}: BookingCalendarProps) => {
  const todayIso = todayLocalIso(new Date())
  let body: ReactNode

  if (query.status === 'pending') {
    body = <CalendarWeekSkeleton days={weekDaysIso(weekStart)} todayIso={todayIso} />
  } else if (query.status === 'error') {
    body = (
      <div className="space-y-4">
        <p role="alert" className="text-sm font-medium text-destructive">
          {errorDetail(query.error) ?? LOAD_FALLBACK_ERROR}
        </p>
        <Button
          type="button"
          variant="outline"
          className={navButtonClasses}
          onClick={() => query.refetch()}
        >
          Try again
        </Button>
      </div>
    )
  } else if (query.bookings.length === 0) {
    body = (
      <p className="text-sm text-muted-foreground">
        {filtersActive ? EMPTY_FILTERED_WEEK : EMPTY_WEEK}
      </p>
    )
  } else {
    body = (
      <WeekBody
        days={groupBookingsByDay(query.bookings, weekStart)}
        todayIso={todayIso}
        onSelect={onSelect}
      />
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 aria-live="polite">{weekRangeLabel(weekStart)}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className={navButtonClasses}
            aria-label="Previous week"
            onClick={() => onWeekChange(shiftWeek(weekStart, -1))}
          >
            <ChevronLeft data-icon="inline-start" aria-hidden="true" />
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            className={navButtonClasses}
            onClick={() => onWeekChange(weekStartIso(todayLocalIso(new Date())))}
          >
            This week
          </Button>
          <Button
            type="button"
            variant="outline"
            className={navButtonClasses}
            aria-label="Next week"
            onClick={() => onWeekChange(shiftWeek(weekStart, 1))}
          >
            Next
            <ChevronRight data-icon="inline-end" aria-hidden="true" />
          </Button>
        </div>
        {body}
      </CardContent>
    </Card>
  )
}

const WeekBody = ({ days, todayIso, onSelect }: WeekBodyProps) => (
  <>
    <ol className={GRID_LIST_CLASSES}>
      {days.map((day, index) => (
        <li key={day.dayIso} className="min-w-0 space-y-2">
          <CalendarDayHeading
            dayIso={day.dayIso}
            index={index}
            isToday={day.dayIso === todayIso}
            variant="grid"
          />
          {day.bookings.length === 0 ? (
            <p className="text-xs text-muted-foreground">None</p>
          ) : (
            <ul className="space-y-2">
              {day.bookings.map((booking) => (
                <li key={booking.id}>
                  <CalendarEntry booking={booking} variant="compact" onSelect={onSelect} />
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
    <ol className={AGENDA_LIST_CLASSES}>
      {days.map(
        (day, index) =>
          day.bookings.length > 0 && (
            <li key={day.dayIso} className="space-y-2">
              <CalendarDayHeading
                dayIso={day.dayIso}
                index={index}
                isToday={day.dayIso === todayIso}
                variant="agenda"
              />
              <ul className="space-y-2">
                {day.bookings.map((booking) => (
                  <li key={booking.id}>
                    <CalendarEntry booking={booking} variant="row" onSelect={onSelect} />
                  </li>
                ))}
              </ul>
            </li>
          ),
      )}
    </ol>
  </>
)
