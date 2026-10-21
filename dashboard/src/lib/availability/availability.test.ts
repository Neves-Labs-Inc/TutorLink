import { describe, it, expect } from 'vitest'

import { dayOfWeekFromIso } from './availability'

describe('dayOfWeekFromIso', () => {
  // 2026-08-24 is a Monday; the seven cases below walk one whole week from it.
  const cases: { iso: string; expected: number; label: string }[] = [
    { iso: '2026-08-24', expected: 0, label: 'Mon' },
    { iso: '2026-08-25', expected: 1, label: 'Tue' },
    { iso: '2026-08-26', expected: 2, label: 'Wed' },
    { iso: '2026-08-27', expected: 3, label: 'Thu' },
    { iso: '2026-08-28', expected: 4, label: 'Fri' },
    { iso: '2026-08-29', expected: 5, label: 'Sat' },
    { iso: '2026-08-30', expected: 6, label: 'Sun' },
  ]

  it.each(cases)('reads $iso as index $expected ($label)', ({ iso, expected }) => {
    expect(dayOfWeekFromIso(iso)).toBe(expected)
  })

  it('never returns JavaScript getDay(), which would put Sunday at 0', () => {
    expect(dayOfWeekFromIso('2026-08-30')).not.toBe(new Date(2026, 7, 30).getDay())
    expect(dayOfWeekFromIso('2026-08-24')).not.toBe(new Date(2026, 7, 24).getDay())
  })

  it('holds across a year boundary', () => {
    expect(dayOfWeekFromIso('2025-12-29')).toBe(0)
    expect(dayOfWeekFromIso('2026-01-04')).toBe(6)
  })

  it('holds across a leap day', () => {
    expect(dayOfWeekFromIso('2024-02-29')).toBe(3)
    expect(dayOfWeekFromIso('2024-03-01')).toBe(4)
  })
})
