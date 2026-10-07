import { TONE_CLASSES } from '@/lib/status-badge/statusTones'
import { cn } from '@/lib/utils'

export type StatusBadgeProps = { status: string }

const badgeClasses =
  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap'

export const StatusBadge = ({ status }: StatusBadgeProps) => (
  <span className={cn(badgeClasses, TONE_CLASSES[status] ?? TONE_CLASSES.completed)}>
    {humanise(status)}
  </span>
)

const humanise = (value: string): string =>
  value.replace(/_/g, ' ').replace(/^./, (char) => char.toUpperCase())
