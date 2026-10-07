import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { WeeklyRemindersCard, WeeklyRemindersSkeleton } from '@/components/settings/WeeklyRemindersCard'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorDetail } from '@/lib/api'
import { settingQueries, updateSettings } from '@/lib/queries/settings'
import { generalSettings } from '@/lib/settings/reminders'
import { pendingUpdates, settingControl, settingLabel, type Setting } from '@/lib/settings/settings'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'

type SettingRowProps = {
  setting: Setting
  value: string
  onChange: (value: string) => void
  disabled: boolean
}

const LOAD_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const SAVE_FALLBACK_ERROR = 'Something went wrong. Please try again.'
// One per setting that loads in the general card, so the Weekly reminders card does not jump.
const LOADING_ROWS = [0, 1, 2, 3, 4, 5]
const bar = 'animate-pulse rounded-lg bg-muted motion-reduce:animate-none'

const pillClasses =
  'inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'

export const Settings = () => {
  const queryClient = useQueryClient()
  const { data, isPending, isError, error, refetch } = useQuery(settingQueries.page())
  const role = useAuthStore((state) => state.role)
  const [draft, setDraft] = useState<Record<string, string>>({})

  const save = useMutation({
    mutationFn: updateSettings,
    onSuccess: (updated) => {
      queryClient.setQueryData(settingQueries.page().queryKey, updated)
      setDraft({})
    },
  })

  const allSettings = data?.items ?? []
  // The reminder keys have their own card and form, so one save never submits the other.
  const settings = generalSettings(allSettings)
  const updates = pendingUpdates(settings, draft)
  let content: ReactNode

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    save.mutate(updates)
  }

  const handleDiscard = () => {
    setDraft({})
    save.reset()
  }

  if (isPending) {
    content = (
      <div aria-busy="true" className="space-y-6">
        <span className="sr-only">Loading settings…</span>
        <Card>
          <CardHeader>
            <div className={cn(bar, 'h-5 w-24')} />
            <div className={cn(bar, 'h-4 w-72 max-w-full')} />
          </CardHeader>
          <CardContent className="space-y-6">
            {LOADING_ROWS.map((row) => (
              <div key={row} className="space-y-1.5">
                <div className={cn(bar, 'h-4 w-32')} />
                <div className={cn(bar, 'h-10 w-full')} />
                <div className={cn(bar, 'h-3 w-40')} />
              </div>
            ))}
          </CardContent>
        </Card>
        <WeeklyRemindersSkeleton />
      </div>
    )
  } else if (isError) {
    content = (
      <Card>
        <CardContent className="space-y-4">
          <p role="alert" className="text-sm font-medium text-destructive">
            {errorDetail(error) ?? LOAD_FALLBACK_ERROR}
          </p>
          <Button type="button" variant="outline" onClick={() => refetch()}>
            Try again
          </Button>
        </CardContent>
      </Card>
    )
  } else if (allSettings.length === 0) {
    content = (
      <Card>
        <CardContent>
          <p className="text-sm text-muted-foreground">No settings are available.</p>
        </CardContent>
      </Card>
    )
  } else {
    content = (
      <>
        {settings.length > 0 && (
        <form onSubmit={handleSubmit}>
          <Card>
            <CardHeader>
              <CardTitle>Settings</CardTitle>
              <CardDescription>
                These values apply system-wide and take effect immediately.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {settings.map((setting) => (
                <SettingRow
                  key={setting.key}
                  setting={setting}
                  value={draft[setting.key] ?? setting.value}
                  onChange={(next) => setDraft((current) => ({ ...current, [setting.key]: next }))}
                  disabled={save.isPending}
                />
              ))}
            </CardContent>
            <CardFooter className="flex-col items-stretch gap-3">
              {save.isError && (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {errorDetail(save.error) ?? SAVE_FALLBACK_ERROR}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={updates.length === 0 || save.isPending}>
                  {save.isPending ? 'Saving…' : 'Save changes'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
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
                  <span className="text-sm text-muted-foreground">Saved.</span>
                )}
              </div>
            </CardFooter>
          </Card>
        </form>
        )}
        <WeeklyRemindersCard page={data} role={role} />
      </>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">Settings</h1>
      {content}
    </div>
  )
}

const SettingRow = ({ setting, value, onChange, disabled }: SettingRowProps) => {
  const fieldId = `setting-${setting.key}`
  const isEditable = settingControl(setting.value_type) === 'integer'
  let control: ReactNode

  if (isEditable) {
    control = (
      <Input
        id={fieldId}
        name={setting.key}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-10"
      />
    )
  } else {
    control = (
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-foreground">{setting.value}</span>
        <span className={pillClasses}>Read-only</span>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={isEditable ? fieldId : undefined}>{settingLabel(setting.key)}</Label>
        {setting.is_developer_only && <span className={pillClasses}>Developer only</span>}
      </div>
      {control}
      <p className="font-mono text-xs text-muted-foreground">{setting.key}</p>
    </div>
  )
}
