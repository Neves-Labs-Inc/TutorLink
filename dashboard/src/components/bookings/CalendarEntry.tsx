import type { ReactNode } from 'react'

import { StatusBadge } from '@/components/shared/StatusBadge'
import { bookingTimeLabel } from '@/lib/bookings/bookings'
import type { Booking } from '@/lib/queries/bookings'
import { cn } from '@/lib/utils'

export type CalendarEntryVariant = 'compact' | 'row'

type CalendarEntryProps = {
  booking: Booking
  variant: CalendarEntryVariant
  onSelect: (bookingId: string) => void
}

const entryClasses = cn(
  'w-full rounded-lg border border-border bg-card text-start',
  'transition-[background-color,transform] duration-150 ease-out',
  'hover:bg-muted active:translate-y-px',
  'focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
  'motion-reduce:transition-none',
)
const compactClasses = 'space-y-1 p-2 text-xs'
const rowClasses = 'min-h-11 space-y-1 px-3 py-2.5'

// The visible text is the accessible name; no `aria-label` on top of it.
export const CalendarEntry = ({ booking, variant, onSelect }: CalendarEntryProps) => {
  const time = bookingTimeLabel(booking)
  let content: ReactNode

  if (variant === 'compact') {
    content = (
      <>
        <p className="font-medium tabular-nums text-foreground">{time}</p>
        <p className="font-medium text-foreground break-words">{booking.child.name}</p>
        <p className="text-muted-foreground break-words">{booking.tutor.name}</p>
        <p className="text-muted-foreground break-words">{booking.subject.name}</p>
        <StatusBadge status={booking.status} />
      </>
    )
  } else {
    content = (
      <>
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium tabular-nums">{time}</p>
          <StatusBadge status={booking.status} />
        </div>
        <p className="text-sm text-foreground">{booking.child.name}</p>
        <p className="text-xs text-muted-foreground">
          {booking.tutor.name} · {booking.subject.name}
        </p>
      </>
    )
  }

  return (
    <button
      type="button"
      aria-haspopup="dialog"
      className={cn(entryClasses, variant === 'compact' ? compactClasses : rowClasses)}
      onClick={() => onSelect(booking.id)}
    >
      {content}
    </button>
  )
}
