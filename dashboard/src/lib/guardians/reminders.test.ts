import { describe, expect, it } from 'vitest'
import {
  blockedReason,
  canRecordConsent,
  consentSentence,
  lastReminderView,
  nextConsentAction,
  type GuardianConsent,
} from './reminders'

const consent = (overrides: Partial<GuardianConsent> = {}): GuardianConsent => ({
  state: 'opt_in',
  source: 'intake',
  set_at: '2026-09-30T15:00:00',
  blocked_by_whatsapp: false,
  ...overrides,
})

describe('consentSentence', () => {
  it.each([
    [{ state: 'opt_in', source: 'intake' }, 'Opted in since 30 Sep 2026, from Intake'],
    [{ state: 'opt_in', source: 'staff' }, 'Opted in since 30 Sep 2026, from Staff'],
    [{ state: 'opt_in', source: 'message' }, 'Opted in since 30 Sep 2026, from a message'],
    [{ state: 'opt_out', source: 'message' }, 'Opted out 30 Sep 2026, from a message'],
    [{ state: 'opt_out', source: 'intake' }, 'Opted out 30 Sep 2026, from Intake'],
    [{ state: 'opt_out', source: 'staff' }, 'Opted out 30 Sep 2026, from Staff'],
    [
      { state: 'opt_out', source: 'system' },
      'Opted out 30 Sep 2026, WhatsApp reported the number blocked us',
    ],
  ] as const)('words %j', (overrides, sentence) => {
    expect(consentSentence(consent(overrides))).toBe(sentence)
  })

  it('says never opted in with no consent', () => {
    expect(consentSentence(consent({ state: 'never', source: null, set_at: null }))).toBe('Never opted in')
  })
})

describe('the record button', () => {
  it('offers opt-out while opted in', () => {
    expect(nextConsentAction(consent())).toBe('opt_out')
  })

  it('offers opt-in otherwise', () => {
    expect(nextConsentAction(consent({ state: 'opt_out' }))).toBe('opt_in')
    expect(nextConsentAction(consent({ state: 'never', source: null, set_at: null }))).toBe('opt_in')
  })

  it('hides opt-in while WhatsApp blocks the Guardian, even after a Staff opt-out', () => {
    expect(canRecordConsent(consent({ state: 'opt_out', source: 'staff', blocked_by_whatsapp: true }))).toBe(false)
  })

  it('allows opt-in when not blocked', () => {
    expect(canRecordConsent(consent({ state: 'opt_out' }))).toBe(true)
  })

  it('allows opt-out when blocked and opted in', () => {
    expect(canRecordConsent(consent({ blocked_by_whatsapp: true }))).toBe(true)
  })
})

describe('blockedReason', () => {
  it('does not repeat the block when the latest row is the system opt-out', () => {
    expect(blockedReason(consent({ state: 'opt_out', source: 'system', blocked_by_whatsapp: true }))).toBe(
      'Only the Guardian can turn reminders back on, by messaging START.',
    )
  })

  it('explains the block when Staff opted out after it', () => {
    expect(blockedReason(consent({ state: 'opt_out', source: 'staff', blocked_by_whatsapp: true }))).toContain(
      'WhatsApp reported the number blocked us.',
    )
  })
})

describe('lastReminderView', () => {
  const last = (overrides: object) => ({
    week_start: '2026-09-28',
    status: 'sent' as const,
    error_code: null,
    skip_reason: null,
    ...overrides,
  })

  it.each([
    ['sent', 'Sent'],
    ['delivered', 'Delivered'],
    ['read', 'Read'],
  ] as const)('has no detail for %s', (status, label) => {
    expect(lastReminderView(last({ status }))).toEqual({
      weekLine: 'Week of 28 Sep 2026 · ',
      status: label,
      detail: null,
      tone: 'none',
    })
  })

  it('shows the error for failed, in the error tone', () => {
    const view = lastReminderView(last({ status: 'failed', error_code: '63016' }))

    expect(view).toMatchObject({
      status: 'Failed',
      detail: 'Error 63016: outside the allowed window.',
      tone: 'error',
    })
  })

  it('shows an unknown error code without a meaning', () => {
    expect(lastReminderView(last({ status: 'undeliverable', error_code: '99999' }))).toMatchObject({
      status: 'Undeliverable',
      detail: 'Error 99999.',
      tone: 'error',
    })
  })

  it('shows the skip reasons, muted', () => {
    expect(lastReminderView(last({ status: 'skipped', skip_reason: 'takeover' }))).toMatchObject({
      status: 'Skipped',
      detail: 'A Staff member held the chat (takeover).',
      tone: 'muted',
    })
    expect(lastReminderView(last({ status: 'skipped', skip_reason: 'template_not_approved' }))).toMatchObject({
      detail: 'Template not approved.',
      tone: 'muted',
    })
  })
})
