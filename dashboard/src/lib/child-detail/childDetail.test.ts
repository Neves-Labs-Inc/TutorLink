import { describe, expect, it } from 'vitest'

import { AxiosError } from 'axios'

import { defaultWindow } from '@/lib/tutor-sessions/tutorSessions'
import type { ChildDetail } from '@/lib/queries/children'
import {
  bookingBlockedReason,
  bookButtonLabel,
  childSessionParams,
  EMPTY_CHILD_SESSION_STATE,
  isNotFoundError,
} from './childDetail'

const TODAY = '2026-09-22'

const child = (overrides: Partial<ChildDetail> = {}): ChildDetail => ({
  id: 'child-1',
  name: 'Tommy Doe',
  date_of_birth: '2014-05-02',
  grade_level: 7,
  school_name: 'Lincoln Middle School',
  notes: null,
  is_active: true,
  upcoming_session_count: 0,
  guardians: [],
  homes: [{ id: 'home-1', label: null, address: '123 Main St', access_code: '1234', is_active: true }],
  ...overrides,
})

describe('childSessionParams', () => {
  it('always carries child_id and never status', () => {
    const params = childSessionParams(
      'child-1',
      { ...EMPTY_CHILD_SESSION_STATE, tab: 'upcoming' },
      1,
      TODAY,
    )

    expect(params.child_id).toBe('child-1')
    expect(params).not.toHaveProperty('status')
  })

  it('defaults the upcoming tab to "from today", never "starts after now" (SA-30)', () => {
    const params = childSessionParams(
      'child-1',
      { ...EMPTY_CHILD_SESSION_STATE, tab: 'upcoming' },
      1,
      TODAY,
    )

    expect(params.from).toBe(TODAY)
    expect(params.to).toBeUndefined()
  })

  it('defaults the past tab to defaultWindow(\'past\', today)', () => {
    const params = childSessionParams('child-1', { tab: 'past', from: '', to: '' }, 1, TODAY)
    const expected = defaultWindow('past', TODAY)

    expect(params.from).toBe(expected.from)
    expect(params.to).toBe(expected.to)
  })

  it('lets an edited from/to widen the window past the default', () => {
    const params = childSessionParams(
      'child-1',
      { tab: 'past', from: '2026-01-01', to: '' },
      1,
      TODAY,
    )

    expect(params.from).toBe('2026-01-01')
    expect(params.to).toBeUndefined()
  })

  it('carries the given page', () => {
    const params = childSessionParams('child-1', EMPTY_CHILD_SESSION_STATE, 3, TODAY)

    expect(params.page).toBe(3)
  })
})

describe('bookingBlockedReason', () => {
  it('returns the reason for an active child with no active home', () => {
    const target = child({
      homes: [{ id: 'home-1', label: null, address: '123 Main St', access_code: '1234', is_active: false }],
    })

    expect(bookingBlockedReason(target)).toBe('Add a home first.')
  })

  it('returns the reason for an inactive child with no active home too', () => {
    const target = child({
      is_active: false,
      homes: [{ id: 'home-1', label: null, address: '123 Main St', access_code: '1234', is_active: false }],
    })

    expect(bookingBlockedReason(target)).toBe('Add a home first.')
  })

  it('returns null when at least one home is active', () => {
    expect(bookingBlockedReason(child())).toBeNull()
  })

  it('returns null for an inactive child with an active home (OQ-68)', () => {
    expect(bookingBlockedReason(child({ is_active: false }))).toBeNull()
  })
})

describe('bookButtonLabel', () => {
  it('reads "Book a session" for an active child', () => {
    expect(bookButtonLabel(child())).toBe('Book a session')
  })

  it('reads "Reactivate and book" only for an inactive child', () => {
    expect(bookButtonLabel(child({ is_active: false }))).toBe('Reactivate and book')
  })
})

describe('isNotFoundError', () => {
  it('is true for a 404 axios error', () => {
    const error = new AxiosError('Not Found', '404', undefined, undefined, {
      status: 404,
      data: { detail: 'Child not found' },
      statusText: 'Not Found',
      headers: {},
      config: {} as never,
    })

    expect(isNotFoundError(error)).toBe(true)
  })

  it('is false for any other error', () => {
    expect(isNotFoundError(new Error('boom'))).toBe(false)
  })
})
