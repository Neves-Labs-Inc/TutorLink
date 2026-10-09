import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { TutorLinkMissing } from '@/components/layout/TutorLinkMissing'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/hooks/useAuth'
import { errorDetail } from '@/lib/api'
import { byDayOfWeek, modeLabel, slotRangeLabel } from '@/lib/availability/availability'
import { DAY_LABELS, todayLocalIso } from '@/lib/dates/dates'
import { availabilityQueries, type AvailabilitySlot } from '@/lib/queries/availability'
import { exceptionQueries, type TutorException } from '@/lib/queries/exceptions'
import {
  activeSlots,
  approvedOnDay,
  dayDateLabel,
  shiftWeek,
  slotBlocking,
  weekDaysIso,
  weekRangeLabel,
  weekStartIso,
  type SlotBlocking,
} from '@/lib/tutor-schedule/tutorSchedule'
import { cn } from '@/lib/utils'

type ScheduleWeekProps = { tutorId: string }

type DayColumnProps = {
  label: string
  dateLabel: string
  slots: AvailabilitySlot[]
  dayExceptions: TutorException[]
}

type SlotChipProps = { slot: AvailabilitySlot; blocking: SlotBlocking }

const FALLBACK_ERROR = 'Something went wrong. Please try again.'
const LOADING_ROWS = [0, 1, 2, 3]

const chipClasses = 'rounded-lg border p-2 text-xs'
const linkClasses =
  'rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

export const Schedule = () => {
  const { tutorId } = useAuth()
  let content: ReactNode

  if (tutorId === null) {
    content = <TutorLinkMissing />
  } else {
    content = <ScheduleWeek tutorId={tutorId} />
  }

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">My Schedule</h1>
      {content}
    </div>
  )
}

const ScheduleWeek = ({ tutorId }: ScheduleWeekProps) => {
  const [weekStart, setWeekStart] = useState(() => weekStartIso(todayLocalIso(new Date())))
  const days = weekDaysIso(weekStart)

  const availability = useQuery(availabilityQueries.forTutor(tutorId))
  // The window is part of the key, so paging to another week is another query rather than a
  // silently reused cache entry. `start_date`/`end_date` are bare business-local dates, so the
  // heading names the week that was actually asked for.
  const exceptions = useQuery(exceptionQueries.forTutor(tutorId, { from: weekStart, to: days[6] }))

  const isPending = availability.isPending || exceptions.isPending
  const isError = availability.isError || exceptions.isError
  const slotsByDay = byDayOfWeek(activeSlots(availability.data?.items ?? []))
  const exceptionRows = exceptions.data?.items ?? []
  let body: ReactNode

  const handleRetry = () => {
    availability.refetch()
    exceptions.refetch()
  }

  if (isPending) {
    body = (
      <div aria-busy="true" className="space-y-3">
        <p className="text-sm text-muted-foreground">Loading your week…</p>
        {LOADING_ROWS.map((row) => (
          <div key={row} className="h-8 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    )
  } else if (isError) {
    body = (
      <div className="space-y-4">
        <p role="alert" className="text-sm font-medium text-destructive">
          {errorDetail(availability.error ?? exceptions.error) ?? FALLBACK_ERROR}
        </p>
        <Button type="button" variant="outline" onClick={handleRetry}>
          Try again
        </Button>
      </div>
    )
  } else {
    body = (
      <div className="overflow-x-auto pb-1">
        <ul className="grid min-w-[42rem] grid-cols-7 gap-2">
          {days.map((dayIso, index) => (
            <DayColumn
              key={dayIso}
              label={DAY_LABELS[index]}
              dateLabel={dayDateLabel(dayIso)}
              slots={slotsByDay[index]}
              dayExceptions={approvedOnDay(dayIso, exceptionRows)}
            />
          ))}
        </ul>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{weekRangeLabel(weekStart)}</CardTitle>
        <CardDescription>
          Your weekly availability, Monday first, with approved time off blocked out. This grid is
          read-only: availability changes are an admin action, and absences are requested on{' '}
          <Link to="/time-off" className={linkClasses}>
            Time Off
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            aria-label="Previous week"
            onClick={() => setWeekStart(shiftWeek(weekStart, -1))}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setWeekStart(weekStartIso(todayLocalIso(new Date())))}
          >
            This week
          </Button>
          <Button
            type="button"
            variant="outline"
            aria-label="Next week"
            onClick={() => setWeekStart(shiftWeek(weekStart, 1))}
          >
            Next
          </Button>
        </div>
        {body}
      </CardContent>
    </Card>
  )
}

const DayColumn = ({ label, dateLabel, slots, dayExceptions }: DayColumnProps) => (
  <li className="space-y-2">
    <h3 className="text-xs font-medium text-muted-foreground">
      {label} <span className="font-normal">{dateLabel}</span>
    </h3>
    {slots.length === 0 ? (
      <p className="text-xs text-muted-foreground">None</p>
    ) : (
      slots.map((slot) => (
        <SlotChip key={slot.id} slot={slot} blocking={slotBlocking(slot, dayExceptions)} />
      ))
    )}
  </li>
)

const SlotChip = ({ slot, blocking }: SlotChipProps) => (
  <div
    className={cn(
      chipClasses,
      blocking.state === 'clear' ? 'border-border' : 'border-dashed border-border bg-muted/40',
    )}
  >
    <p
      className={
        blocking.state === 'blocked'
          ? 'text-muted-foreground line-through'
          : 'font-medium text-foreground'
      }
    >
      {slotRangeLabel(slot)}
    </p>
    <p className="text-muted-foreground">{modeLabel(slot.mode)}</p>
    {blocking.label !== null && (
      <p className="text-muted-foreground">
        {blocking.state === 'blocked' ? 'Blocked' : 'Partly blocked'} — {blocking.label}
      </p>
    )}
  </div>
)
