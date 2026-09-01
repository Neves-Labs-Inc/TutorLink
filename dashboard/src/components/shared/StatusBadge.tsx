import { cn } from '@/lib/utils'

export type StatusBadgeProps = { status: string }

const TONE_CLASSES: Record<string, string> = {
  pending: 'bg-status-pending-bg text-status-pending',
  confirmed: 'bg-status-confirmed-bg text-status-confirmed',
  approved: 'bg-status-confirmed-bg text-status-confirmed',
  cancelled: 'bg-status-cancelled-bg text-status-cancelled',
  rejected: 'bg-status-cancelled-bg text-status-cancelled',
  completed: 'bg-status-completed-bg text-status-completed',
  active: 'bg-status-confirmed-bg text-status-confirmed',
  inactive: 'bg-status-cancelled-bg text-status-cancelled',
}

const badgeClasses =
  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap'

export const StatusBadge = ({ status }: StatusBadgeProps) => (
  <span className={cn(badgeClasses, TONE_CLASSES[status] ?? TONE_CLASSES.completed)}>
    {capitalise(status)}
  </span>
)

const capitalise = (value: string): string => value.replace(/^./, (char) => char.toUpperCase())
