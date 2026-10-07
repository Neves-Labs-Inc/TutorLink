import { formatIsoDate, todayLocalIso } from '@/lib/dates/dates'
import { sentDetail, type DetailTone, type ReminderStatus, type SkipReason } from '@/lib/reminders/reminders'

export type ConsentState = 'opt_in' | 'opt_out' | 'never'
export type ConsentAction = 'opt_in' | 'opt_out'
export type ConsentSource = 'intake' | 'message' | 'staff' | 'system'

export type GuardianConsent = {
  state: ConsentState
  source: ConsentSource | null
  set_at: string | null
  blocked_by_whatsapp: boolean
}

export type LastReminder = {
  week_start: string
  status: ReminderStatus
  error_code: string | null
  skip_reason: SkipReason | null
}

export const CONSENT_ACTION_LABELS: Record<ConsentAction, string> = {
  opt_in: 'Opted in',
  opt_out: 'Opted out',
}
export const CONSENT_SOURCE_LABELS: Record<ConsentSource, string> = {
  intake: 'Intake',
  message: 'Message',
  staff: 'Staff',
  system: 'System',
}

const NEVER_OPTED_IN = 'Never opted in'
export const NO_REMINDER_YET = 'No reminder sent yet'
const START_REASON = 'Only the Guardian can turn reminders back on, by messaging START.'
const BLOCKED_REASON = `WhatsApp reported the number blocked us. ${START_REASON}`

// The sentence already says WhatsApp blocked us when the latest row is the system's own.
export const blockedReason = (consent: GuardianConsent): string =>
  consent.source === 'system' ? START_REASON : BLOCKED_REASON
const SOURCE_PHRASES: Record<ConsentSource, string> = {
  intake: 'from Intake',
  message: 'from a message',
  staff: 'from Staff',
  system: 'WhatsApp reported the number blocked us',
}
const STATUS_LABELS: Record<ReminderStatus, string> = {
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Failed',
  undeliverable: 'Undeliverable',
  skipped: 'Skipped',
}

const localDate = (isoInstant: string): string => formatIsoDate(todayLocalIso(new Date(isoInstant)))

export const consentSentence = (consent: GuardianConsent): string => {
  if (consent.state === 'never' || consent.set_at === null || consent.source === null) {
    return NEVER_OPTED_IN
  }

  const date = localDate(consent.set_at)
  const phrase = SOURCE_PHRASES[consent.source]

  if (consent.state === 'opt_in') return `Opted in since ${date}, ${phrase}`

  return `Opted out ${date}, ${phrase}`
}

// The one action the button offers: turn off when on, otherwise turn on.
export const nextConsentAction = (consent: GuardianConsent): ConsentAction =>
  consent.state === 'opt_in' ? 'opt_out' : 'opt_in'

// WhatsApp's block holds until the Guardian acts, so only "Turn off" stays available.
export const canRecordConsent = (consent: GuardianConsent): boolean =>
  !(consent.blocked_by_whatsapp && nextConsentAction(consent) === 'opt_in')

export type LastReminderView = {
  weekLine: string
  status: string
  detail: string | null
  tone: DetailTone
}

// Wording of the detail is `sentDetail`'s, so this card and the Reminders page agree.
export const lastReminderView = (last: LastReminder): LastReminderView => {
  const { text, tone } = sentDetail({
    guardian_id: '',
    guardian_name: '',
    child_names: [],
    language: 'en',
    status: last.status,
    skip_reason: last.skip_reason,
    error_code: last.error_code,
    may_have_been_delivered: false,
    sent_at: null,
  })

  return {
    weekLine: `Week of ${formatIsoDate(last.week_start)} · `,
    status: STATUS_LABELS[last.status],
    detail: text,
    tone,
  }
}
