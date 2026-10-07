import { useEffect, useRef } from 'react'

import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import {
  LANGUAGE_LABELS,
  NOT_DETECTED_LABEL,
  languageFromOption,
  languageToOption,
} from '@/lib/guardians/language'
import type { Language } from '@/lib/reminders/reminders'
import { cn } from '@/lib/utils'

export type GuardianLanguageSelectProps = {
  id: string
  value: Language | null
  onChange: (value: Language | null) => void
  disabled?: boolean
  variant: 'inline' | 'stacked'
}

const VARIANT_CLASSES = {
  inline: {
    group: 'flex items-center gap-2',
    label: 'text-sm text-muted-foreground',
    wrapper: 'w-56',
    select: 'h-11 md:h-7',
  },
  stacked: {
    group: 'flex flex-col items-start gap-1.5',
    label: 'text-xs text-muted-foreground',
    wrapper: 'w-full max-w-64',
    select: 'h-11 md:h-8',
  },
}

export const GuardianLanguageSelect = ({
  id,
  value,
  onChange,
  disabled = false,
  variant,
}: GuardianLanguageSelectProps) => {
  const classes = VARIANT_CLASSES[variant]
  const selectRef = useRef<HTMLSelectElement>(null)
  const shouldRestoreFocus = useRef(false)

  // A disabled select loses focus, so a keyboard user would restart from the top of the page.
  useEffect(() => {
    if (disabled || !shouldRestoreFocus.current) return

    shouldRestoreFocus.current = false
    if (document.activeElement === document.body) selectRef.current?.focus()
  }, [disabled])

  return (
    <div className={classes.group}>
      <Label htmlFor={id} className={cn('font-normal', classes.label)}>
        Language:
      </Label>
      <div className={classes.wrapper}>
        <Select
          ref={selectRef}
          id={id}
          className={classes.select}
          value={languageToOption(value)}
          disabled={disabled}
          onChange={(event) => {
            shouldRestoreFocus.current = document.activeElement === event.currentTarget
            onChange(languageFromOption(event.target.value))
          }}
        >
          <option value="en">{LANGUAGE_LABELS.en}</option>
          <option value="es">{LANGUAGE_LABELS.es}</option>
          <option value="">{NOT_DETECTED_LABEL}</option>
        </Select>
      </div>
    </div>
  )
}
