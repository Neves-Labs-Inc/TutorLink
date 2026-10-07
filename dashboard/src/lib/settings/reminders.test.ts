import { describe, expect, it } from 'vitest'
import { hourLabel } from '@/lib/reminders/reminders'
import type { Setting } from './settings'
import {
  generalSettings,
  isLockRefusal,
  isRemindersPaused,
  isTimezoneReadOnly,
  reminderUpdates,
  timezoneOptions,
  withoutTimezone,
  WEEKDAY_OPTIONS,
} from './reminders'

const setting = (key: string, value: string): Setting => ({
  key,
  value,
  value_type: 'string',
  is_developer_only: false,
})

describe('hourLabel', () => {
  it.each([
    [0, '12 AM'],
    [12, '12 PM'],
    [18, '6 PM'],
    [9, '9 AM'],
  ])('labels hour %i as %s', (hour, label) => {
    expect(hourLabel(hour)).toBe(label)
  })
})

describe('WEEKDAY_OPTIONS', () => {
  it('maps 1 to Monday and 7 to Sunday', () => {
    expect(WEEKDAY_OPTIONS[0]).toEqual({ value: 1, label: 'Monday' })
    expect(WEEKDAY_OPTIONS[6]).toEqual({ value: 7, label: 'Sunday' })
    expect(WEEKDAY_OPTIONS).toHaveLength(7)
  })
})

describe('timezoneOptions', () => {
  it('keeps a current value that is not in the list, first', () => {
    expect(timezoneOptions('Asia/Tokyo')[0]).toBe('Asia/Tokyo')
  })

  it('does not repeat a listed value', () => {
    const options = timezoneOptions('America/Chicago')

    expect(options.filter((zone) => zone === 'America/Chicago')).toHaveLength(1)
  })
})

describe('isTimezoneReadOnly', () => {
  it('locks the zone for an admin once locked', () => {
    expect(isTimezoneReadOnly('admin', true)).toBe(true)
  })

  it('leaves it editable for an admin before a booking exists', () => {
    expect(isTimezoneReadOnly('admin', false)).toBe(false)
  })

  it('leaves it editable for a developer even when locked', () => {
    expect(isTimezoneReadOnly('developer', true)).toBe(false)
  })
})

describe('lock refusal', () => {
  const zoneUpdate = [{ key: 'business_timezone', value: 'America/Denver' }]

  it('is a 403 on a save that changed the zone', () => {
    expect(isLockRefusal(403, zoneUpdate)).toBe(true)
  })

  it('is not a 403 on a save without the zone', () => {
    expect(isLockRefusal(403, [{ key: 'reminder_hour', value: '9' }])).toBe(false)
  })

  it('is not another status', () => {
    expect(isLockRefusal(400, zoneUpdate)).toBe(false)
    expect(isLockRefusal(null, zoneUpdate)).toBe(false)
  })

  it('drops only the zone from the draft', () => {
    expect(withoutTimezone({ business_timezone: 'America/Denver', reminder_hour: '9' })).toEqual({
      reminder_hour: '9',
    })
  })
})

describe('isRemindersPaused', () => {
  it('follows the flag', () => {
    expect(isRemindersPaused(true)).toBe(true)
    expect(isRemindersPaused(false)).toBe(false)
    expect(isRemindersPaused(undefined)).toBe(false)
  })
})

describe('splitting the settings', () => {
  const all = [setting('session_length_minutes', '60'), setting('reminder_hour', '18'), setting('business_timezone', 'UTC')]

  it('keeps the reminder keys out of the general card', () => {
    expect(generalSettings(all).map((item) => item.key)).toEqual(['session_length_minutes'])
  })

  it('sends only changed reminder keys, trimmed, and allows a blank template id', () => {
    const settings = [setting('reminder_hour', '18'), setting('reminder_template_sid_en', 'HX1')]

    expect(
      reminderUpdates(settings, { reminder_hour: '18', reminder_template_sid_en: '  ' }),
    ).toEqual([{ key: 'reminder_template_sid_en', value: '' }])
  })
})
