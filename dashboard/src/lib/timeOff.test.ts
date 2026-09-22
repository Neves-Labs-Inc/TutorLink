import { describe, it, expect } from 'vitest'

import {
  canWithdraw,
  draftProblem,
  draftToCreate,
  emptyDraft,
  lockedReason,
  timeOffWindow,
  withdrawConfirmBody,
  type ExceptionDraft,
} from './timeOff'
import type { TutorException } from './queries/exceptions'

const exception = (overrides: Partial<TutorException>): TutorException => ({
  id: 'exception-1',
  tutor_id: 'tutor-1',
  start_date: '2026-09-21',
  end_date: '2026-09-23',
  start_time: null,
  end_time: null,
  reason: 'vacation',
  notes: null,
  status: 'pending',
  created_at: '2026-09-01T10:00:00Z',
  ...overrides,
})

const filled: ExceptionDraft = {
  startDate: '2026-09-21',
  endDate: '2026-09-23',
  startTime: '',
  endTime: '',
  reason: 'vacation',
  notes: '',
}

describe('timeOffWindow', () => {
  it('bounds upcoming from today with no end', () => {
    expect(timeOffWindow('upcoming', '2026-09-22')).toEqual({ from: '2026-09-22' })
  })

  it('bounds past up to yesterday with no start', () => {
    expect(timeOffWindow('past', '2026-09-22')).toEqual({ to: '2026-09-21' })
  })
})

describe('emptyDraft', () => {
  it('starts with vacation and every field blank', () => {
    expect(emptyDraft()).toEqual({
      startDate: '',
      endDate: '',
      startTime: '',
      endTime: '',
      reason: 'vacation',
      notes: '',
    })
  })
})

describe('draftProblem', () => {
  it('is null for a complete all-day draft', () => {
    expect(draftProblem(filled)).toBeNull()
  })

  it('is null for a complete partial-day draft', () => {
    expect(draftProblem({ ...filled, startTime: '09:00', endTime: '17:00' })).toBeNull()
  })

  it('reports a missing start date', () => {
    expect(draftProblem({ ...filled, startDate: '' })).toBe('Choose both a first and a last day.')
  })

  it('reports a missing end date', () => {
    expect(draftProblem({ ...filled, endDate: '' })).toBe('Choose both a first and a last day.')
  })

  it('reports an end date before the start date', () => {
    expect(draftProblem({ ...filled, startDate: '2026-09-23', endDate: '2026-09-21' })).toBe(
      'The last day must be on or after the first day.',
    )
  })

  it('reports a half-set time pair', () => {
    expect(draftProblem({ ...filled, startTime: '09:00', endTime: '' })).toBe(
      'Set both times, or neither, and end the range after it starts.',
    )
  })

  it('reports an unordered time pair', () => {
    expect(draftProblem({ ...filled, startTime: '17:00', endTime: '09:00' })).toBe(
      'Set both times, or neither, and end the range after it starts.',
    )
  })
})

describe('draftToCreate', () => {
  it('sends no status key', () => {
    expect(draftToCreate(filled)).not.toHaveProperty('status')
  })

  it('turns blank times into null for an all-day request', () => {
    expect(draftToCreate(filled)).toMatchObject({ start_time: null, end_time: null })
  })

  it('keeps set times', () => {
    expect(
      draftToCreate({ ...filled, startTime: '09:00', endTime: '17:00' }),
    ).toMatchObject({ start_time: '09:00', end_time: '17:00' })
  })

  it('turns blank notes into null', () => {
    expect(draftToCreate(filled)).toMatchObject({ notes: null })
  })

  it('trims notes that carry text', () => {
    expect(draftToCreate({ ...filled, notes: '  back Monday  ' })).toMatchObject({
      notes: 'back Monday',
    })
  })
})

describe('canWithdraw', () => {
  const cases: { status: TutorException['status']; expected: boolean }[] = [
    { status: 'pending', expected: true },
    { status: 'approved', expected: false },
    { status: 'rejected', expected: false },
  ]

  it.each(cases)('is $expected for $status', ({ status, expected }) => {
    expect(canWithdraw(exception({ status }))).toBe(expected)
  })
})

describe('withdrawConfirmBody', () => {
  it('names the dates and states the consequence', () => {
    const body = withdrawConfirmBody(exception({}))

    expect(body).toContain('21–23 Sep')
    expect(body).toContain('does not block bookings')
  })
})

describe('lockedReason', () => {
  it('is null for a pending row', () => {
    expect(lockedReason(exception({ status: 'pending' }))).toBeNull()
  })

  it('explains an approved row', () => {
    expect(lockedReason(exception({ status: 'approved' }))).toBe(
      'An admin has approved this request.',
    )
  })

  it('explains a rejected row', () => {
    expect(lockedReason(exception({ status: 'rejected' }))).toBe(
      'An admin has rejected this request.',
    )
  })
})
