import { describe, it, expect } from 'vitest'
import { settingLabel, settingControl, pendingUpdates, type Setting } from './settings'

describe('settingLabel', () => {
  const cases: { key: string; expected: string }[] = [
    { key: 'session_length_minutes', expected: 'Session length minutes' },
    { key: 'session_gap_minutes', expected: 'Session gap minutes' },
    { key: 'booking_lookahead_days', expected: 'Booking lookahead days' },
    { key: 'min_booking_lead_hours', expected: 'Min booking lead hours' },
    { key: 'cancellation_cutoff_hours', expected: 'Cancellation cutoff hours' },
    { key: 'login_rate_limit_ip_max_attempts', expected: 'Login rate limit ip max attempts' },
    { key: 'login_rate_limit_ip_window_minutes', expected: 'Login rate limit ip window minutes' },
    {
      key: 'login_rate_limit_account_max_attempts',
      expected: 'Login rate limit account max attempts',
    },
    {
      key: 'login_rate_limit_account_window_minutes',
      expected: 'Login rate limit account window minutes',
    },
    { key: 'timezone', expected: 'Timezone' },
  ]

  it.each(cases)('labels $key as $expected', ({ key, expected }) => {
    expect(settingLabel(key)).toBe(expected)
  })
})

describe('settingControl', () => {
  const cases: { valueType: string; expected: 'integer' | 'readonly' }[] = [
    { valueType: 'integer', expected: 'integer' },
    { valueType: 'boolean', expected: 'readonly' },
    { valueType: '', expected: 'readonly' },
    { valueType: 'Integer', expected: 'readonly' },
  ]

  it.each(cases)('returns $expected for $valueType', ({ valueType, expected }) => {
    expect(settingControl(valueType)).toBe(expected)
  })
})

describe('pendingUpdates', () => {
  const settings: Setting[] = [
    { key: 'session_length_minutes', value: '60', value_type: 'integer', is_developer_only: false },
    { key: 'session_gap_minutes', value: '15', value_type: 'integer', is_developer_only: false },
    { key: 'timezone', value: 'UTC', value_type: 'string', is_developer_only: true },
  ]

  it('returns an empty array for an empty draft', () => {
    expect(pendingUpdates(settings, {})).toEqual([])
  })

  it('returns an empty array when the draft equals the server value', () => {
    expect(pendingUpdates(settings, { session_length_minutes: '60' })).toEqual([])
  })

  it('returns an empty array when the draft equals the server value after trimming', () => {
    expect(pendingUpdates(settings, { session_length_minutes: '  60  ' })).toEqual([])
  })

  it('returns one entry carrying the trimmed value for a genuine change', () => {
    expect(pendingUpdates(settings, { session_length_minutes: ' 90 ' })).toEqual([
      { key: 'session_length_minutes', value: '90' },
    ])
  })

  it('returns entries in settings order for two changes', () => {
    expect(
      pendingUpdates(settings, {
        session_gap_minutes: '20',
        session_length_minutes: '90',
      }),
    ).toEqual([
      { key: 'session_length_minutes', value: '90' },
      { key: 'session_gap_minutes', value: '20' },
    ])
  })

  it('excludes a draft entry for a key not in settings', () => {
    expect(pendingUpdates(settings, { unknown_key: '1' })).toEqual([])
  })

  it('excludes a draft entry for a setting whose value_type is unrecognised, even when changed', () => {
    expect(pendingUpdates(settings, { timezone: 'America/New_York' })).toEqual([])
  })
})
