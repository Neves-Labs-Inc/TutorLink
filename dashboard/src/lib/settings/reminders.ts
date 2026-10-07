import type { Role } from '@/lib/auth/auth'
import { WEEKDAY_NAMES } from '@/lib/reminders/reminders'
import type { Setting, SettingUpdate } from '@/lib/settings/settings'

export const REMINDER_KEYS: readonly string[] = [
  'reminder_weekday',
  'reminder_hour',
  'business_timezone',
  'reminder_template_sid_en',
  'reminder_template_sid_es',
  'takeover_template_sid_en',
  'takeover_template_sid_es',
  'takeover_generic_template_sid_en',
  'takeover_generic_template_sid_es',
]

export const TEMPLATE_KEYS: readonly string[] = REMINDER_KEYS.filter((key) => key.includes('_template_sid_'))

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
]
const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

export const WEEKDAY_OPTIONS: { value: number; label: string }[] = WEEKDAY_NAMES.map((label, index) => ({
  value: index + 1,
  label,
}))

export const HOUR_VALUES: readonly number[] = HOURS

// A saved zone outside the list must stay selectable, or opening the page would silently change it.
export const timezoneOptions = (current: string): string[] =>
  TIMEZONES.includes(current) ? TIMEZONES : [current, ...TIMEZONES]

// Only a developer can change the zone once a booking exists.
export const isTimezoneReadOnly = (role: Role | null, isLocked: boolean): boolean =>
  role !== 'developer' && isLocked

const TIMEZONE_KEY = 'business_timezone'
const FORBIDDEN_STATUS = 403

// An Admin's save that included the zone and came back 403 means the zone is now locked.
export const isLockRefusal = (status: number | null, updates: SettingUpdate[]): boolean =>
  status === FORBIDDEN_STATUS && updates.some((update) => update.key === TIMEZONE_KEY)

// Other changes in the same save stay in the draft so Save can be pressed again.
export const withoutTimezone = (draft: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(draft).filter(([key]) => key !== TIMEZONE_KEY))

export const isRemindersPaused = (flag: boolean | undefined): boolean => flag === true

export const isReminderKey = (key: string): boolean => REMINDER_KEYS.includes(key)

export const generalSettings = (settings: Setting[]): Setting[] =>
  settings.filter((setting) => !isReminderKey(setting.key))

export const reminderSettings = (settings: Setting[]): Setting[] =>
  settings.filter((setting) => isReminderKey(setting.key))

// Template ids may be blank (not approved), so unlike `pendingUpdates` there is no integer filter.
export const reminderUpdates = (settings: Setting[], draft: Record<string, string>): SettingUpdate[] =>
  reminderSettings(settings).flatMap((setting) => {
    const draftValue = draft[setting.key]
    const trimmed = draftValue?.trim()

    return trimmed === undefined || trimmed === setting.value ? [] : [{ key: setting.key, value: trimmed }]
  })
