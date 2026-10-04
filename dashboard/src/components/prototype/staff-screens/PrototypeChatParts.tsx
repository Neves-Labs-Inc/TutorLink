// PROTOTYPE ONLY. Chat and Guardian language pieces shared by screens 3, 5, 6 and 7.
import type { ReactNode } from 'react'

import { Select } from '@/components/ui/select'
import { LANGUAGE_LABELS, type GuardianLanguage } from '@/lib/prototype/staffScreensData'
import { cn } from '@/lib/utils'

export type BubbleAuthor = 'guardian' | 'bot' | 'staff'

type GuardianLanguageSelectProps = {
  id: string
  value: GuardianLanguage
  onChange: (value: GuardianLanguage) => void
  isInline?: boolean
}

type ChatBubbleProps = { author: BubbleAuthor; label?: string; time: string; children: ReactNode }

type SystemLineProps = { children: ReactNode; isFailed?: boolean; action?: ReactNode }

const LANGUAGE_OPTIONS: GuardianLanguage[] = ['en', 'es', 'none']

export const GuardianLanguageSelect = ({ id, value, onChange, isInline = false }: GuardianLanguageSelectProps) => (
  <div className={cn('flex items-center gap-2', !isInline && 'flex-col items-start gap-1.5')}>
    <label htmlFor={id} className={cn(isInline ? 'text-sm text-muted-foreground' : 'text-xs text-muted-foreground')}>
      Language:
    </label>
    <div className={cn(isInline ? 'w-56' : 'w-full max-w-64')}>
      <Select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as GuardianLanguage)}
        className={cn(isInline && 'h-7')}
      >
        {LANGUAGE_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {LANGUAGE_LABELS[option]}
          </option>
        ))}
      </Select>
    </div>
  </div>
)

const bubbleByAuthor: Record<BubbleAuthor, string> = {
  guardian: 'bg-muted text-foreground',
  bot: 'bg-secondary text-secondary-foreground',
  staff: 'bg-primary text-primary-foreground',
}

export const ChatBubble = ({ author, label, time, children }: ChatBubbleProps) => (
  <div className={cn('flex flex-col', author === 'guardian' ? 'items-start' : 'items-end')}>
    {label && <span className="mb-0.5 text-xs text-muted-foreground">{label}</span>}
    <div className={cn('max-w-[85%] rounded-lg px-3 py-2 text-sm sm:max-w-[70%]', bubbleByAuthor[author])}>
      <p className="whitespace-pre-wrap">{children}</p>
    </div>
    <span className="mt-0.5 text-xs text-muted-foreground">{time}</span>
  </div>
)

// Centred grey line, not a bubble: system events the Staff should see but the Guardian did not write.
export const SystemLine = ({ children, isFailed = false, action }: SystemLineProps) => (
  <div className="flex flex-wrap items-center justify-center gap-2 px-6 text-center text-xs">
    <span className={cn(isFailed ? 'font-medium text-destructive' : 'text-muted-foreground')}>{children}</span>
    {action}
  </div>
)
