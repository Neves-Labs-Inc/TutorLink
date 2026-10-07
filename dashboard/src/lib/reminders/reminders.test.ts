import { describe, expect, it } from 'vitest'
import {
  attentionCount,
  isCurrentWeek,
  isPaused,
  parseWeekParam,
  previewOutcome,
  scheduleLine,
  sentAtLabel,
  sentDetail,
  stepWeek,
  weekLabel,
  type ReminderRow,
} from './reminders'

const row = (overrides: Partial<ReminderRow> = {}): ReminderRow => ({
  guardian_id: 'g1',
  guardian_name: 'Maria Torres',
  child_names: ['Ana'],
  language: 'es',
  status: 'sent',
  skip_reason: null,
  error_code: null,
  may_have_been_delivered: false,
  sent_at: null,
  ...overrides,
})

describe('previewOutcome', () => {
  it('will send when nothing skips the Guardian', () => {
    expect(previewOutcome({ skip_reason: null })).toEqual({ key: 'will_send', reason: null })
  })

  it('names the takeover for a skipped Guardian', () => {
    expect(previewOutcome({ skip_reason: 'takeover' })).toEqual({
      key: 'will_skip',
      reason: 'A Staff member is holding the chat (takeover).',
    })
  })

  it('names the unapproved template for a skipped Guardian', () => {
    expect(previewOutcome({ skip_reason: 'template_not_approved' })).toEqual({
      key: 'will_skip',
      reason: 'Template not approved.',
    })
  })
})

describe('sentDetail', () => {
  it('is empty for a delivered row', () => {
    expect(sentDetail(row({ status: 'delivered' }))).toEqual({ text: null, tone: 'none' })
  })

  it('shows the skip reason in muted text for a skipped row', () => {
    expect(sentDetail(row({ status: 'skipped', skip_reason: 'takeover' }))).toEqual({
      text: 'A Staff member held the chat (takeover).',
      tone: 'muted',
    })
  })

  it('shows the error code with its meaning when known', () => {
    expect(sentDetail(row({ status: 'undeliverable', error_code: '63049' }))).toEqual({
      text: 'Error 63049: Meta chose not to deliver this message.',
      tone: 'error',
    })
  })

  it('shows an unknown error code on its own', () => {
    expect(sentDetail(row({ status: 'failed', error_code: '99999' }))).toEqual({
      text: 'Error 99999',
      tone: 'error',
    })
  })

  it('says delivery is unknown when the send may have gone out', () => {
    expect(
      sentDetail(row({ status: 'failed', error_code: 'interrupted', may_have_been_delivered: true })),
    ).toEqual({ text: 'Delivery unknown: it may have been delivered.', tone: 'warning' })
  })
})

describe('isPaused', () => {
  it('holds when every row is skipped for the unapproved template', () => {
    expect(
      isPaused([{ skip_reason: 'template_not_approved' }, { skip_reason: 'template_not_approved' }]),
    ).toBe(true)
  })

  it('does not hold for an empty preview', () => {
    expect(isPaused([])).toBe(false)
  })

  it('does not hold when any Guardian will send or skips for another reason', () => {
    expect(isPaused([{ skip_reason: 'template_not_approved' }, { skip_reason: null }])).toBe(false)
    expect(isPaused([{ skip_reason: 'template_not_approved' }, { skip_reason: 'takeover' }])).toBe(false)
  })
})

describe('attentionCount', () => {
  it('counts failed, undeliverable and skipped rows', () => {
    const rows = [
      row({ status: 'sent' }),
      row({ status: 'read' }),
      row({ status: 'failed' }),
      row({ status: 'undeliverable' }),
      row({ status: 'skipped' }),
    ]

    expect(attentionCount(rows)).toBe(3)
  })
})

describe('weekLabel', () => {
  it('reads "Week of" the Monday', () => {
    expect(weekLabel('2026-10-12')).toBe('Week of 12 Oct 2026')
  })
})

describe('parseWeekParam', () => {
  it('accepts a Monday', () => {
    expect(parseWeekParam('2026-10-12')).toBe('2026-10-12')
  })

  it.each([null, '', 'soon', '2026-13-01', '2026-10-13', '2026-02-30'])('rejects %s', (value) => {
    expect(parseWeekParam(value)).toBeNull()
  })
})

describe('stepWeek', () => {
  const DEFAULT_WEEK = '2026-10-12'

  it('steps back from the default week', () => {
    expect(stepWeek(DEFAULT_WEEK, -1, DEFAULT_WEEK)).toBe('2026-10-05')
  })

  it('steps forward to a later past week', () => {
    expect(stepWeek('2026-09-28', 1, DEFAULT_WEEK)).toBe('2026-10-05')
  })

  it('returns null (the default week) when stepping forward onto it', () => {
    expect(stepWeek('2026-10-05', 1, DEFAULT_WEEK)).toBeNull()
  })

  it('steps back when the default week is not known yet', () => {
    expect(stepWeek('2026-10-05', -1, undefined)).toBe('2026-09-28')
  })

  it('crosses a year boundary', () => {
    expect(stepWeek('2026-01-05', -1, DEFAULT_WEEK)).toBe('2025-12-29')
  })
})

describe('scheduleLine', () => {
  const settings = [
    { key: 'reminder_weekday', value: '7' },
    { key: 'reminder_hour', value: '18' },
    { key: 'business_timezone', value: 'America/New_York' },
  ]

  it('is shown to an admin', () => {
    expect(scheduleLine('admin', settings)).toBe('Sends Sunday at 6 PM, America/New_York.')
  })

  it('is shown to a developer', () => {
    expect(scheduleLine('developer', settings)).toBe('Sends Sunday at 6 PM, America/New_York.')
  })

  it('is hidden from a manager', () => {
    expect(scheduleLine('manager', settings)).toBeNull()
  })

  it('is hidden while the settings are missing', () => {
    expect(scheduleLine('admin', undefined)).toBeNull()
    expect(scheduleLine('admin', [])).toBeNull()
  })

  it('labels midnight and noon', () => {
    const at = (hour: string) => [
      { key: 'reminder_weekday', value: '1' },
      { key: 'reminder_hour', value: hour },
      { key: 'business_timezone', value: 'UTC' },
    ]

    expect(scheduleLine('admin', at('0'))).toBe('Sends Monday at 12 AM, UTC.')
    expect(scheduleLine('admin', at('12'))).toBe('Sends Monday at 12 PM, UTC.')
  })
})

describe('sentAtLabel', () => {
  it('is a dash when nothing was sent', () => {
    expect(sentAtLabel(null)).toBe('—')
  })

  it('shows the date and time in local time', () => {
    expect(sentAtLabel(new Date(2026, 9, 11, 18, 2).toISOString())).toBe('11 Oct 2026, 6:02 PM')
  })
})

describe('isCurrentWeek', () => {
  const DEFAULT_WEEK = '2026-10-12'

  it('treats no param as the current week', () => {
    expect(isCurrentWeek(null, DEFAULT_WEEK)).toBe(true)
  })

  it('treats the default week and any later week as current', () => {
    expect(isCurrentWeek('2026-10-12', DEFAULT_WEEK)).toBe(true)
    expect(isCurrentWeek('2026-10-19', DEFAULT_WEEK)).toBe(true)
  })

  it('treats an earlier week as past', () => {
    expect(isCurrentWeek('2026-10-05', DEFAULT_WEEK)).toBe(false)
  })

  it('does not know yet while the default week is loading', () => {
    expect(isCurrentWeek('2026-10-05', undefined)).toBe(false)
  })
})
