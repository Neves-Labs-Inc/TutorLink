import {
  AGENDA_LIST_CLASSES,
  CalendarDayHeading,
  GRID_LIST_CLASSES,
} from '@/components/bookings/CalendarDayHeading'
import { cn } from '@/lib/utils'

type CalendarWeekSkeletonProps = { days: string[]; todayIso: string }

// Skeleton entries per weekday, Monday first: a plausible week, not a wall of blocks.
const GRID_COUNTS = [2, 1, 2, 1, 2, 0, 0]
const AGENDA_GROUPS = [0, 1]
const AGENDA_ROWS = [0, 1]

const barClasses = 'rounded-lg bg-muted animate-pulse motion-reduce:animate-none'
const badgeBarClasses = 'h-5 w-16 rounded-full bg-muted animate-pulse motion-reduce:animate-none'
// Each bar is one line of the entry it stands in for (`text-xs` lines are 16px, `text-sm` 20px),
// so a skeleton week reserves the same height as a loaded one (DESIGN.md R2). At `lg` the
// ~126px columns wrap the time range onto two lines, hence the double bar.
const compactLineClasses = 'h-4'
const rowLineClasses = 'h-5'
const rowMetaLineClasses = 'h-4'

// Content-shaped: the real day headings sit over entry-shaped blocks, so the layout does not jump
// when the bookings arrive.
export const CalendarWeekSkeleton = ({ days, todayIso }: CalendarWeekSkeletonProps) => (
  <div aria-busy="true">
    <span className="sr-only">Loading bookings…</span>
    <ol className={GRID_LIST_CLASSES}>
      {days.map((dayIso, index) => (
        <li key={dayIso} className="min-w-0 space-y-2">
          <CalendarDayHeading
            dayIso={dayIso}
            index={index}
            isToday={dayIso === todayIso}
            variant="grid"
          />
          {Array.from({ length: GRID_COUNTS[index] }, (_, entry) => (
            <div key={entry} className="space-y-1 rounded-lg border border-border p-2">
              <div>
                <div className={cn(barClasses, compactLineClasses, 'w-16')} />
                <div className={cn(barClasses, compactLineClasses, 'w-14')} />
              </div>
              <div className={cn(barClasses, compactLineClasses, 'w-16')} />
              <div className={cn(barClasses, compactLineClasses, 'w-12')} />
              <div className={cn(barClasses, compactLineClasses, 'w-10')} />
              <div className={badgeBarClasses} />
            </div>
          ))}
        </li>
      ))}
    </ol>
    <ol className={AGENDA_LIST_CLASSES}>
      {AGENDA_GROUPS.map((group) => (
        <li key={group} className="space-y-2">
          <div className={cn(barClasses, 'h-4 w-20')} />
          {AGENDA_ROWS.map((row) => (
            <div key={row} className="space-y-1 rounded-lg border border-border px-3 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className={cn(barClasses, rowLineClasses, 'w-32')} />
                <div className={badgeBarClasses} />
              </div>
              <div className={cn(barClasses, rowLineClasses, 'w-28')} />
              <div className={cn(barClasses, rowMetaLineClasses, 'w-40')} />
            </div>
          ))}
        </li>
      ))}
    </ol>
  </div>
)
