import { AxiosError, type AxiosResponse } from 'axios'
import { describe, it, expect } from 'vitest'
import { conflictOf } from './api'

const failure = (status: number, data: unknown): AxiosError =>
  new AxiosError('failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    data,
  } as AxiosResponse)

describe('conflictOf', () => {
  it('reads the warnings of a warnings 409', () => {
    const warnings = [{ code: 'gap', message: 'Too close to another booking' }]
    const error = failure(409, {
      detail: 'This booking needs the listed warnings confirmed',
      warnings,
    })

    expect(conflictOf(error)).toEqual({ kind: 'warnings', warnings })
  })

  it('tells a stale save from an overlap refusal', () => {
    const stale = failure(409, {
      detail: 'That booking changed since it was opened',
    })
    const picked = failure(409, {
      detail: 'That booking changed since it was picked',
    })
    const overlap = failure(409, {
      detail: 'That Staff member already has a booking overlapping this time',
    })
    const revert = failure(409, {
      detail: 'Reverting would overlap another live booking of this Staff member',
    })

    expect(conflictOf(stale)).toEqual({ kind: 'stale' })
    expect(conflictOf(picked)).toEqual({ kind: 'stale' })
    expect(conflictOf(overlap)).toEqual({ kind: 'overlap' })
    expect(conflictOf(revert)).toEqual({ kind: 'overlap' })
  })

  it('calls any other 409 a plain refusal with its sentence', () => {
    const error = failure(409, {
      detail: 'Only a future Cancelled Booking can be restored',
    })

    expect(conflictOf(error)).toEqual({
      kind: 'refused',
      detail: 'Only a future Cancelled Booking can be restored',
    })
  })

  it('is null for anything that is not a 409', () => {
    expect(conflictOf(failure(400, { detail: 'nope' }))).toBeNull()
    expect(conflictOf(new Error('boom'))).toBeNull()
  })
})
