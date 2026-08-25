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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorDetail } from '@/lib/api'
import { settingQueries, updateSettings } from '@/lib/queries/settings'
import { pendingUpdates, settingControl, settingLabel, type Setting } from '@/lib/settings'

type SettingRowProps = {
  setting: Setting
  value: string
  onChange: (value: string) => void
  disabled: boolean
}

const LOAD_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const SAVE_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const LOADING_ROWS = [0, 1, 2, 3]

const pillClasses =
  'inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'

export const Settings = () => {
  const queryClient = useQueryClient()
  const { data, isPending, isError, error, refetch } = useQuery(settingQueries.list())
  const [draft, setDraft] = useState<Record<string, string>>({})

  const save = useMutation({
    mutationFn: updateSettings,
    onSuccess: (items) => {
      queryClient.setQueryData(settingQueries.list().queryKey, items)
      setDraft({})
    },
  })

  const settings = data ?? []
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
      <Card>
        <CardContent aria-busy="true" className="space-y-3">
          <p className="text-sm text-muted-foreground">Loading settings…</p>
          {LOADING_ROWS.map((row) => (
            <div key={row} className="h-8 animate-pulse rounded-lg bg-muted" />
          ))}
        </CardContent>
      </Card>
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
  } else if (settings.length === 0) {
    content = (
      <Card>
        <CardContent>
          <p className="text-sm text-muted-foreground">No settings are available.</p>
        </CardContent>
      </Card>
    )
  } else {
    content = (
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
