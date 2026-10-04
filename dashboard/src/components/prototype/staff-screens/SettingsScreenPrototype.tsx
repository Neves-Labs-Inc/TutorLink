// PROTOTYPE ONLY (ticket #112, screen `settings`). "Weekly reminders" section on Settings.
import { useState } from 'react'

import { PrototypeControls, PrototypeToggle } from '@/components/prototype/PrototypeControls'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { formatHour } from '@/lib/prototype/staffScreensData'

type OnOff = 'off' | 'on'

type TemplateSids = {
  reminder_template_sid_en: string
  reminder_template_sid_es: string
  takeover_template_sid_en: string
  takeover_template_sid_es: string
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const HOURS = Array.from({ length: 24 }, (_, hour) => hour)
const DEFAULT_WEEKDAY = 'Sunday'
const DEFAULT_HOUR = 18
const DEFAULT_TIMEZONE = 'America/New_York'
const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Puerto_Rico',
  'America/Mexico_City',
  'America/Bogota',
  'Europe/Madrid',
]
const TIMEZONE_LOCK_NOTE =
  'Admins can change this until the first booking exists. After that, only a developer can change it.'

const APPROVED_SIDS: TemplateSids = {
  reminder_template_sid_en: 'HX1f9c0a2b7e3d4c5b6a7980112233aabb',
  reminder_template_sid_es: 'HX2a8d1b3c9f4e5d6c7b8a90112233ccdd',
  takeover_template_sid_en: 'HX3b7e2c4d0a5f6e7d8c9b01122334eeff',
  takeover_template_sid_es: '',
}
const BLANK_REMINDER_SIDS: TemplateSids = {
  ...APPROVED_SIDS,
  reminder_template_sid_en: '',
  reminder_template_sid_es: '',
}

const pillClasses =
  'inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'

const ON_OFF = [
  { value: 'off' as const, label: 'off' },
  { value: 'on' as const, label: 'on' },
]

export const SettingsScreenPrototype = () => {
  const [locked, setLocked] = useState<OnOff>('off')
  const [developerView, setDeveloperView] = useState<OnOff>('off')
  const [weekday, setWeekday] = useState(DEFAULT_WEEKDAY)
  const [hour, setHour] = useState(DEFAULT_HOUR)
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE)
  const [sids, setSids] = useState<TemplateSids>(APPROVED_SIDS)
  const [isSaved, setIsSaved] = useState(false)

  const isDeveloper = developerView === 'on'
  const isTimezoneReadOnly = locked === 'on' && !isDeveloper
  const isPaused = sids.reminder_template_sid_en === '' && sids.reminder_template_sid_es === ''

  return (
    <div className="space-y-6">
      <PrototypeControls>
        <PrototypeToggle label="timezone locked (a booking exists)" options={ON_OFF} value={locked} onChange={setLocked} />
        <PrototypeToggle label="developer view" options={ON_OFF} value={developerView} onChange={setDeveloperView} />
        <button
          type="button"
          className="rounded border border-dashed border-muted-foreground/40 px-1.5 py-0.5 hover:bg-muted"
          onClick={() => setSids(isPaused ? APPROVED_SIDS : BLANK_REMINDER_SIDS)}
        >
          {isPaused ? 'restore reminder sids' : 'blank both reminder sids'}
        </button>
      </PrototypeControls>

      <h1 className="font-heading text-2xl font-semibold tracking-tight">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
          <CardDescription>These values apply system-wide and take effect immediately.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">(Existing settings rows, unchanged.)</p>
        </CardContent>
      </Card>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          setIsSaved(true)
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle>Weekly reminders</CardTitle>
            <CardDescription>
              Once a week, Guardians who opted in get a Booking reminder on WhatsApp.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {isPaused && (
              <p role="status" className="rounded-lg border border-border bg-muted px-3 py-2 text-sm">
                <span className="font-medium">Reminders are paused.</span>{' '}
                <span className="text-muted-foreground">
                  No reminder template is approved yet. A developer adds the template ids once
                  WhatsApp approves them.
                </span>
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="reminder-weekday">Day</Label>
                <Select id="reminder-weekday" value={weekday} onChange={(event) => setWeekday(event.target.value)}>
                  {WEEKDAYS.map((day) => (
                    <option key={day}>{day}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reminder-hour">Time</Label>
                <Select id="reminder-hour" value={hour} onChange={(event) => setHour(Number(event.target.value))}>
                  {HOURS.map((value) => (
                    <option key={value} value={value}>
                      {formatHour(value)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor={isTimezoneReadOnly ? undefined : 'reminder-timezone'}>Business timezone</Label>
                {isTimezoneReadOnly && <span className={pillClasses}>Locked</span>}
              </div>
              {isTimezoneReadOnly ? (
                <p className="font-mono text-sm">{timezone}</p>
              ) : (
                <div className="sm:max-w-sm">
                  <Select id="reminder-timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                    {TIMEZONES.map((zone) => (
                      <option key={zone}>{zone}</option>
                    ))}
                  </Select>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {TIMEZONE_LOCK_NOTE}
                {locked === 'on' && isDeveloper && ' A booking exists, so only you (developer) can change it now.'}
              </p>
            </div>

            {isDeveloper &&
              (Object.keys(sids) as (keyof TemplateSids)[]).map((key) => (
                <div key={key} className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label htmlFor={`sid-${key}`}>{key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}</Label>
                    <span className={pillClasses}>Developer only</span>
                    {sids[key] === '' && <span className={pillClasses}>Not approved</span>}
                  </div>
                  <Input
                    id={`sid-${key}`}
                    className="h-10 font-mono"
                    placeholder="Blank = template not approved"
                    value={sids[key]}
                    onChange={(event) => setSids((current) => ({ ...current, [key]: event.target.value }))}
                  />
                  <p className="font-mono text-xs text-muted-foreground">{key}</p>
                </div>
              ))}
          </CardContent>
          <CardFooter className="flex-wrap gap-3">
            <Button type="submit">Save changes</Button>
            {isSaved && <span className="text-sm text-muted-foreground">Saved.</span>}
          </CardFooter>
        </Card>
      </form>
    </div>
  )
}
