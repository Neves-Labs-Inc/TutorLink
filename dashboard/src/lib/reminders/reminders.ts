import type { Role } from '@/lib/auth/auth'
import { ADMIN_ROLES } from '@/lib/auth/auth'
import { addDaysIso, formatIsoDate, formatTime, todayLocalIso } from '@/lib/dates/dates'

export type SkipReason = 'blocked_by_whatsapp' | 'takeover' | 'template_not_approved'
export type ReminderStatus = 'sent' | 'delivered' | 'read' | 'failed' | 'undeliverable' | 'skipped'
export type Language = 'en' | 'es'

export type ReminderPreviewItem = {
  guardian_id: string
  guardian_name: string
  child_names: string[]
  language: Language
  skip_reason: SkipReason | null
}

export type ReminderRow = {
  guardian_id: string
  guardian_name: string
  child_names: string[]
  language: Language
  status: ReminderStatus
  skip_reason: SkipReason | null
  error_code: string | null
  may_have_been_delivered: boolean
  sent_at: string | null
}

export type ReminderWeek = {
  week_start: string
  has_run: boolean
  preview: ReminderPreviewItem[] | null
  rows: ReminderRow[]
}

export type DetailTone = 'error' | 'warning' | 'muted' | 'none'

export const ATTENTION_STATUSES = 'undeliverable,failed,skipped'
export const NO_VALUE = '—'

const ATTENTION_SET: ReadonlySet<ReminderStatus> = new Set(['undeliverable', 'failed', 'skipped'])
const PREVIEW_REASONS: Record<SkipReason, string> = {
  blocked_by_whatsapp: 'Blocked by WhatsApp.',
  takeover: 'A Staff member is holding the chat (takeover).',
  template_not_approved: 'Template not approved.',
}
const SENT_REASONS: Record<SkipReason, string> = {
  blocked_by_whatsapp: 'Blocked by WhatsApp.',
  takeover: 'A Staff member held the chat (takeover).',
  template_not_approved: 'Template not approved.',
}
const ERROR_MEANINGS: Record<string, string> = {
  '63049': 'Meta chose not to deliver this message.',
  '63016': 'outside the allowed window.',
}
const DELIVERY_UNKNOWN_TEXT = 'Delivery unknown: it may have been delivered.'
export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MONDAY_INDEX = 1
const DAYS_PER_WEEK = 7
const NOON = 12

export const previewOutcome = (
  item: Pick<ReminderPreviewItem, 'skip_reason'>,
): { key: 'will_send' | 'will_skip'; reason: string | null } =>
  item.skip_reason === null
    ? { key: 'will_send', reason: null }
    : { key: 'will_skip', reason: PREVIEW_REASONS[item.skip_reason] }

// Shared with the Guardian screen's last-reminder line, so both say the same thing.
export const sentDetail = (row: ReminderRow): { text: string | null; tone: DetailTone } => {
  if (row.may_have_been_delivered) return { text: DELIVERY_UNKNOWN_TEXT, tone: 'warning' }

  if (row.error_code !== null) {
    const meaning = ERROR_MEANINGS[row.error_code]

    return {
      text: meaning === undefined ? `Error ${row.error_code}.` : `Error ${row.error_code}: ${meaning}`,
      tone: 'error',
    }
  }

  if (row.skip_reason !== null) return { text: SENT_REASONS[row.skip_reason], tone: 'muted' }

  return { text: null, tone: 'none' }
}

export const isPaused = (preview: Pick<ReminderPreviewItem, 'skip_reason'>[]): boolean =>
  preview.length > 0 && preview.every((item) => item.skip_reason === 'template_not_approved')

export const attentionCount = (rows: Pick<ReminderRow, 'status'>[]): number =>
  rows.filter((row) => ATTENTION_SET.has(row.status)).length

export const weekLabel = (weekStart: string): string => `Week of ${formatIsoDate(weekStart)}`

// The week lives in the URL, so anything but a real Monday date is treated as no param.
export const parseWeekParam = (raw: string | null): string | null => {
  if (raw === null || !ISO_DATE.test(raw)) return null

  const [year, month, day] = raw.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  const isRealDate =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day

  return isRealDate && date.getUTCDay() === MONDAY_INDEX ? raw : null
}

// Returns the `?week=` value for the new week, or null when it is the default week (no param).
// The default week can be unknown (still loading), which must not stop Previous.
export const stepWeek = (
  shown: string,
  direction: 1 | -1,
  defaultWeek: string | undefined,
): string | null => {
  const next = addDaysIso(shown, direction * DAYS_PER_WEEK)

  return next === defaultWeek ? null : next
}

export const hourLabel = (hour: number): string =>
  `${hour % NOON === 0 ? NOON : hour % NOON} ${hour < NOON ? 'AM' : 'PM'}`

type SettingPair = { key: string; value: string }

// Managers cannot read Settings, and the rule is the same one the Settings page uses.
export const scheduleLine = (role: Role | null, settings: SettingPair[] | undefined): string | null => {
  if (role === null || !ADMIN_ROLES.includes(role) || settings === undefined) return null

  const valueOf = (key: string) => settings.find((setting) => setting.key === key)?.value
  const weekday = Number(valueOf('reminder_weekday'))
  const hour = Number(valueOf('reminder_hour'))
  const timezone = valueOf('business_timezone')
  const isComplete = WEEKDAY_NAMES[weekday - 1] !== undefined && Number.isInteger(hour) && timezone !== undefined

  return isComplete ? `Sends ${WEEKDAY_NAMES[weekday - 1]} at ${hourLabel(hour)}, ${timezone}.` : null
}

export const sentAtLabel = (sentAt: string | null): string => {
  if (sentAt === null) return NO_VALUE

  const date = new Date(sentAt)

  return `${formatIsoDate(todayLocalIso(date))}, ${formatTime(`${date.getHours()}:${date.getMinutes()}`)}`
}

// ISO dates sort as text. A hand-edited ?week= at or past the default week has nothing after it.
export const isCurrentWeek = (week: string | null, defaultWeek: string | undefined): boolean =>
  week === null || (defaultWeek !== undefined && week >= defaultWeek)
