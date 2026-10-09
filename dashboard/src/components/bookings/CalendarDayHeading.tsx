import { DAY_LABELS } from '@/lib/dates/dates'
import { dayDateLabel } from '@/lib/tutor-schedule/tutorSchedule'
import { cn } from '@/lib/utils'

export type CalendarDayVariant = 'grid' | 'agenda'

type CalendarDayHeadingProps = {
  dayIso: string
  index: number
  isToday: boolean
  variant: CalendarDayVariant
}

// The grid and the agenda both stay in the DOM and swap on `lg`; `hidden` keeps the inactive copy
// out of the tab order and the accessibility tree.
export const GRID_LIST_CLASSES = 'hidden lg:grid grid-cols-7 gap-2'
export const AGENDA_LIST_CLASSES = 'space-y-4 lg:hidden'

export const CalendarDayHeading = ({ dayIso, index, isToday, variant }: CalendarDayHeadingProps) => {
  const dateLabel = dayDateLabel(dayIso)

  return (
    <h3
      aria-current={isToday ? 'date' : undefined}
      className={cn(
        'text-xs font-medium',
        variant === 'agenda' && 'tracking-wide uppercase',
        isToday ? 'text-primary' : 'text-muted-foreground',
      )}
    >
      {DAY_LABELS[index]}{' '}
      {variant === 'grid' ? <span className="font-normal">{dateLabel}</span> : dateLabel}
    </h3>
  )
}
