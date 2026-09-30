import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { addDaysIso, DAY_LABELS, formatIsoDate, formatTime, todayLocalIso } from './dates'

describe('todayLocalIso', () => {
  const cases: { name: string; now: Date; expected: string }[] = [
    { name: 'a plain date', now: new Date(2026, 7, 27, 9, 30), expected: '2026-08-27' },
    { name: 'a single-digit month and day', now: new Date(2026, 0, 5, 12, 0), expected: '2026-01-05' },
    { name: 'the last minute of a month', now: new Date(2026, 0, 31, 23, 59), expected: '2026-01-31' },
    { name: 'the last minute of a year', now: new Date(2026, 11, 31, 23, 59), expected: '2026-12-31' },
    { name: 'a leap day', now: new Date(2024, 1, 29, 6, 0), expected: '2024-02-29' },
  ]

  it.each(cases)('formats $name', ({ now, expected }) => {
    expect(todayLocalIso(now)).toBe(expected)
  })
})

describe('addDaysIso', () => {
  const cases: { iso: string; days: number; expected: string }[] = [
    { iso: '2026-08-27', days: 0, expected: '2026-08-27' },
    { iso: '2026-08-27', days: 1, expected: '2026-08-28' },
    { iso: '2026-01-31', days: 1, expected: '2026-02-01' },
    { iso: '2026-12-31', days: 1, expected: '2027-01-01' },
    { iso: '2024-02-28', days: 1, expected: '2024-02-29' },
    { iso: '2026-02-28', days: 1, expected: '2026-03-01' },
    { iso: '2026-03-01', days: -1, expected: '2026-02-28' },
    { iso: '2027-01-01', days: -1, expected: '2026-12-31' },
    { iso: '2026-01-05', days: 7, expected: '2026-01-12' },
  ]

  it.each(cases)('adds $days day(s) to $iso', ({ iso, days, expected }) => {
    expect(addDaysIso(iso, days)).toBe(expected)
  })
})

describe('formatIsoDate', () => {
  const cases: { iso: string; expected: string }[] = [
    { iso: '2026-08-27', expected: '27 Aug 2026' },
    { iso: '2026-01-05', expected: '5 Jan 2026' },
    { iso: '2026-12-31', expected: '31 Dec 2026' },
    { iso: '2024-02-29', expected: '29 Feb 2024' },
  ]

  it.each(cases)('formats $iso', ({ iso, expected }) => {
    expect(formatIsoDate(iso)).toBe(expected)
  })
})

describe('formatTime', () => {
  const cases: { hms: string; expected: string }[] = [
    { hms: '00:00:00', expected: '12:00 AM' },
    { hms: '00:30:00', expected: '12:30 AM' },
    { hms: '09:00:00', expected: '9:00 AM' },
    { hms: '11:59:00', expected: '11:59 AM' },
    { hms: '12:00:00', expected: '12:00 PM' },
    { hms: '13:05:00', expected: '1:05 PM' },
    { hms: '23:45:00', expected: '11:45 PM' },
  ]

  it.each(cases)('formats $hms', ({ hms, expected }) => {
    expect(formatTime(hms)).toBe(expected)
  })
})

describe('DAY_LABELS', () => {
  const cases: { index: number; expected: string }[] = [
    { index: 0, expected: 'Mon' },
    { index: 1, expected: 'Tue' },
    { index: 2, expected: 'Wed' },
    { index: 3, expected: 'Thu' },
    { index: 4, expected: 'Fri' },
    { index: 5, expected: 'Sat' },
    { index: 6, expected: 'Sun' },
  ]

  it.each(cases)('labels index $index as $expected', ({ index, expected }) => {
    expect(DAY_LABELS[index]).toBe(expected)
  })

  it('carries exactly seven labels', () => {
    expect(DAY_LABELS).toHaveLength(7)
  })
})

describe('in a negative UTC offset', () => {
  beforeAll(() => {
    vi.stubEnv('TZ', 'America/New_York')
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it('names the local calendar day, not the UTC one', () => {
    const lateEvening = new Date(Date.UTC(2026, 7, 28, 3, 0))

    expect(lateEvening.toISOString().slice(0, 10)).toBe('2026-08-28')
    expect(todayLocalIso(lateEvening)).toBe('2026-08-27')
  })

  it('names the local calendar day when UTC is still on the previous one', () => {
    const earlyMorning = new Date(Date.UTC(2026, 0, 1, 4, 30))

    expect(todayLocalIso(earlyMorning)).toBe('2025-12-31')
  })

  it('formats a bare API date without shifting it a day back', () => {
    expect(new Date('2026-08-27').getDate()).toBe(26)
    expect(formatIsoDate('2026-08-27')).toBe('27 Aug 2026')
  })

  it('adds days across a spring-forward boundary', () => {
    expect(addDaysIso('2026-03-07', 2)).toBe('2026-03-09')
  })

  it('adds days across a fall-back boundary', () => {
    expect(addDaysIso('2026-10-31', 2)).toBe('2026-11-02')
  })
})
