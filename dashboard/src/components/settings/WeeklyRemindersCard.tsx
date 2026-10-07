import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { errorDetail, errorStatus } from '@/lib/api'
import { hourLabel } from '@/lib/reminders/reminders'
import { settingQueries, updateSettings, type SettingsPage } from '@/lib/queries/settings'
import {
  HOUR_VALUES,
  TEMPLATE_KEYS,
  WEEKDAY_OPTIONS,
  isLockRefusal,
  isRemindersPaused,
  isTimezoneReadOnly,
  reminderSettings,
  reminderUpdates,
  timezoneOptions,
  withoutTimezone,
} from '@/lib/settings/reminders'
import { settingLabel } from '@/lib/settings/settings'
import type { Role } from '@/lib/auth/auth'
import { cn } from '@/lib/utils'

export type WeeklyRemindersCardProps = {
  page: SettingsPage
  role: Role | null
}

const SAVE_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const TIMEZONE_KEY = 'business_timezone'
const LOCK_NOTE =
  'Admins can change this until the first booking exists. After that, only a developer can change it.'
const DEVELOPER_LOCK_NOTE = ' A booking exists, so only you (developer) can change it now.'
const FADE_IN = 'animate-in fade-in-0 ease-out motion-reduce:animate-none'
const bar = 'animate-pulse rounded-lg bg-muted motion-reduce:animate-none'

const pillClasses =
  'inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
const controlClasses = 'h-11 md:h-10'

export const WeeklyRemindersSkeleton = () => (
  <Card aria-busy="true">
    <CardHeader>
      <div className={cn(bar, 'h-5 w-40')} />
      <div className={cn(bar, 'h-4 w-80 max-w-full')} />
    </CardHeader>
    <CardContent className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1].map((pair) => (
          <div key={pair} className="space-y-1.5">
            <div className={cn(bar, 'h-4 w-12')} />
            <div className={cn(bar, 'h-11 w-full md:h-10')} />
          </div>
        ))}
      </div>
      <div className="space-y-1.5">
        <div className={cn(bar, 'h-4 w-36')} />
        <div className={cn(bar, 'h-11 w-full sm:max-w-sm md:h-10')} />
        <div className={cn(bar, 'h-3 w-full')} />
      </div>
    </CardContent>
    <CardFooter>
      <div className={cn(bar, 'h-11 w-28 md:h-8')} />
    </CardFooter>
  </Card>
)

export const WeeklyRemindersCard = ({ page, role }: WeeklyRemindersCardProps) => {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Record<string, string>>({})

  const save = useMutation({
    mutationFn: updateSettings,
    onSuccess: (updated) => {
      queryClient.setQueryData(settingQueries.page().queryKey, updated)
      setDraft({})
    },
    onError: (failure, updates) => {
      if (isLockRefusal(errorStatus(failure), updates)) {
        setDraft(withoutTimezone)
        // The server says whether the zone is locked, so a return visit stays read-only.
        void queryClient.invalidateQueries({ queryKey: settingQueries.page().queryKey })
      }
    },
  })

  const settings = reminderSettings(page.items)
  const updates = reminderUpdates(page.items, draft)
  const valueOf = (key: string) => draft[key] ?? settings.find((setting) => setting.key === key)?.value ?? ''
  const savedValueOf = (key: string) => settings.find((setting) => setting.key === key)?.value ?? ''
  const timezone = valueOf(TIMEZONE_KEY)
  const isLocked = page.business_timezone_locked
  const isReadOnly = isTimezoneReadOnly(role, isLocked)
  const templateSettings = TEMPLATE_KEYS.flatMap((key) => settings.filter((setting) => setting.key === key))
  const setValue = (key: string, value: string) => setDraft((current) => ({ ...current, [key]: value }))

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    save.mutate(updates)
  }

  const handleDiscard = () => {
    setDraft({})
    save.reset()
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>Weekly reminders</CardTitle>
          <CardDescription>
            Once a week, Guardians who opted in get a Booking reminder on WhatsApp.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isRemindersPaused(page.reminders_paused) && (
            <p
              role="status"
              className={cn('rounded-lg border border-border bg-muted px-3 py-2 text-sm duration-200', FADE_IN)}
            >
              <span className="font-medium">Reminders are paused.</span>{' '}
              <span className="text-muted-foreground">
                No reminder template is approved yet. A developer adds the template ids once WhatsApp approves them.
              </span>
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="reminder-weekday">Day</Label>
              <Select
                id="reminder-weekday"
                className={controlClasses}
                value={valueOf('reminder_weekday')}
                disabled={save.isPending}
                onChange={(event) => setValue('reminder_weekday', event.target.value)}
              >
                {WEEKDAY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reminder-hour">Time</Label>
              <Select
                id="reminder-hour"
                className={controlClasses}
                value={valueOf('reminder_hour')}
                disabled={save.isPending}
                onChange={(event) => setValue('reminder_hour', event.target.value)}
              >
                {HOUR_VALUES.map((hour) => (
                  <option key={hour} value={hour}>
                    {hourLabel(hour)}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor={isReadOnly ? undefined : 'business-timezone'}>Business timezone</Label>
              {isReadOnly && <span className={pillClasses}>Locked</span>}
            </div>
            {isReadOnly ? (
              <p className="font-mono text-sm">{timezone}</p>
            ) : (
              <div className="sm:max-w-sm">
                <Select
                  id="business-timezone"
                  className={controlClasses}
                  value={timezone}
                  disabled={save.isPending}
                  onChange={(event) => setValue(TIMEZONE_KEY, event.target.value)}
                >
                  {timezoneOptions(timezone).map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {LOCK_NOTE}
              {role === 'developer' && isLocked ? DEVELOPER_LOCK_NOTE : ''}
            </p>
          </div>

          {templateSettings.map((setting) => (
            <div key={setting.key} className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor={`setting-${setting.key}`}>{settingLabel(setting.key)}</Label>
                <span className={pillClasses}>Developer only</span>
                {savedValueOf(setting.key) === '' && <span className={pillClasses}>Not approved</span>}
              </div>
              <Input
                id={`setting-${setting.key}`}
                name={setting.key}
                className={cn(controlClasses, 'font-mono')}
                placeholder="Blank = template not approved"
                autoComplete="off"
                value={valueOf(setting.key)}
                disabled={save.isPending}
                onChange={(event) => setValue(setting.key, event.target.value)}
              />
              <p className="font-mono text-xs text-muted-foreground">{setting.key}</p>
            </div>
          ))}
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-3">
          {save.isError && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {errorDetail(save.error) ?? SAVE_FALLBACK_ERROR}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" className="h-11 md:h-8" disabled={updates.length === 0 || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save changes'}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-8"
              disabled={updates.length === 0 || save.isPending}
              onClick={handleDiscard}
            >
              Discard changes
            </Button>
            {updates.length > 0 && (
              <span className="text-sm text-muted-foreground">
                {updates.length === 1 ? '1 change' : `${updates.length} changes`}
              </span>
            )}
            {save.isSuccess && updates.length === 0 && (
              <span className={cn('text-sm text-muted-foreground duration-150', FADE_IN)}>Saved.</span>
            )}
          </div>
        </CardFooter>
      </Card>
    </form>
  )
}
