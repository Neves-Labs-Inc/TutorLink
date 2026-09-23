import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import {
  hasDateRolledOver,
  queriedDateLabel,
  tableStatus,
  todaySessionsParams,
  upcomingWeekLabel,
  type TableStatus,
} from './dashboard'

describe('todaySessionsParams', () => {
  it('scopes the list to the live statuses on the one date', () => {
    expect(todaySessionsParams('2026-08-27')).toEqual({
      status: ['pending', 'confirmed'],
      from: '2026-08-27',
      to: '2026-08-27',
      page_size: 100,
    })
  })

  it('names neither cancelled nor completed', () => {
    expect(todaySessionsParams('2026-08-27').status).not.toContain('cancelled')
    expect(todaySessionsParams('2026-08-27').status).not.toContain('completed')
  })
})

describe('upcomingWeekLabel', () => {
  const cases: { name: string; date: string; weekEnd: string; expected: string }[] = [
    {
      name: 'a Sunday, where the window is legitimately empty',
      date: '2026-08-30',
      weekEnd: '2026-08-30',
      expected: 'The rest of this week is over',
    },
    {
      name: 'a mid-week Thursday',
      date: '2026-08-27',
      weekEnd: '2026-08-30',
      expected: 'Tomorrow through Sun 30 Aug 2026',
    },
    {
      name: 'a Saturday, where the window is Sunday alone',
      date: '2026-08-29',
      weekEnd: '2026-08-30',
      expected: 'Tomorrow through Sun 30 Aug 2026',
    },
    {
      name: 'a week crossing a month boundary',
      date: '2026-02-25',
      weekEnd: '2026-03-01',
      expected: 'Tomorrow through Sun 1 Mar 2026',
    },
    {
      name: 'a week crossing a year boundary',
      date: '2026-12-30',
      weekEnd: '2027-01-03',
      expected: 'Tomorrow through Sun 3 Jan 2027',
    },
    {
      name: 'a week crossing a leap-day boundary',
      date: '2024-02-28',
      weekEnd: '2024-03-03',
      expected: 'Tomorrow through Sun 3 Mar 2024',
    },
  ]

  it.each(cases)('labels $name', ({ date, weekEnd, expected }) => {
    expect(upcomingWeekLabel(date, weekEnd)).toBe(expected)
  })
})

describe('queriedDateLabel', () => {
  const cases: { iso: string; expected: string }[] = [
    { iso: '2026-08-27', expected: 'Thursday, 27 Aug 2026' },
    { iso: '2026-08-30', expected: 'Sunday, 30 Aug 2026' },
    { iso: '2026-08-31', expected: 'Monday, 31 Aug 2026' },
    { iso: '2026-01-05', expected: 'Monday, 5 Jan 2026' },
    { iso: '2027-01-03', expected: 'Sunday, 3 Jan 2027' },
    { iso: '2024-02-29', expected: 'Thursday, 29 Feb 2024' },
  ]

  it.each(cases)('labels $iso as $expected', ({ iso, expected }) => {
    expect(queriedDateLabel(iso)).toBe(expected)
  })
})

describe('hasDateRolledOver', () => {
  const cases: { name: string; queried: string; now: Date; expected: boolean }[] = [
    {
      name: 'the same day, minutes in',
      queried: '2026-08-27',
      now: new Date(2026, 7, 27, 0, 1),
      expected: false,
    },
    {
      name: 'the same day, one minute before midnight',
      queried: '2026-08-27',
      now: new Date(2026, 7, 27, 23, 59),
      expected: false,
    },
    {
      name: 'the first minute of the next day',
      queried: '2026-08-27',
      now: new Date(2026, 7, 28, 0, 0),
      expected: true,
    },
    {
      name: 'a laptop that slept through several days',
      queried: '2026-08-27',
      now: new Date(2026, 7, 31, 9, 0),
      expected: true,
    },
    {
      name: 'a month boundary',
      queried: '2026-01-31',
      now: new Date(2026, 1, 1, 0, 1),
      expected: true,
    },
    {
      name: 'a year boundary',
      queried: '2026-12-31',
      now: new Date(2027, 0, 1, 0, 0),
      expected: true,
    },
    {
      name: 'a clock corrected backwards',
      queried: '2026-08-28',
      now: new Date(2026, 7, 27, 10, 0),
      expected: true,
    },
  ]

  it.each(cases)('reports $expected for $name', ({ queried, now, expected }) => {
    expect(hasDateRolledOver(queried, now)).toBe(expected)
  })
})

describe('hasDateRolledOver in a negative UTC offset', () => {
  beforeAll(() => {
    vi.stubEnv('TZ', 'America/New_York')
  })

  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it('does not roll over when only UTC has passed midnight', () => {
    const lateEvening = new Date(Date.UTC(2026, 7, 28, 3, 0))

    expect(lateEvening.toISOString().slice(0, 10)).toBe('2026-08-28')
    expect(hasDateRolledOver('2026-08-27', lateEvening)).toBe(false)
  })

  it('rolls over on the local midnight rather than the UTC one', () => {
    const justAfterLocalMidnight = new Date(Date.UTC(2026, 7, 28, 4, 1))

    expect(hasDateRolledOver('2026-08-27', justAfterLocalMidnight)).toBe(true)
  })

  it('does not roll over across a year boundary UTC has already crossed', () => {
    const newYearsEveEvening = new Date(Date.UTC(2027, 0, 1, 2, 0))

    expect(hasDateRolledOver('2026-12-31', newYearsEveEvening)).toBe(false)
  })
})

describe('tableStatus', () => {
  const cases: { isPending: boolean; isError: boolean; expected: TableStatus }[] = [
    { isPending: true, isError: false, expected: 'pending' },
    { isPending: false, isError: true, expected: 'error' },
    { isPending: false, isError: false, expected: 'ready' },
    { isPending: true, isError: true, expected: 'pending' },
  ]

  it.each(cases)(
    'maps isPending=$isPending isError=$isError to $expected',
    ({ isPending, isError, expected }) => {
      expect(tableStatus(isPending, isError)).toBe(expected)
    },
  )
})
