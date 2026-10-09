import { describe, it, expect } from 'vitest'
import {
  ADMIN_ROLES,
  ROLES,
  OFFICE_ROLES,
  chromeFor,
  decodeAccessToken,
  guardDecision,
  isOfficeRole,
  landingPath,
  type Role,
} from './auth'

const encodeToken = (payload: Record<string, unknown>): string => {
  const header = btoa(JSON.stringify({ alg: 'none' }))
  const body = btoa(JSON.stringify(payload))
  const signature = 'signature'

  return `${header}.${body}.${signature}`
}

describe('decodeAccessToken', () => {
  const roleCases: { role: Role; tutorId: string | null }[] = [
    { role: 'admin', tutorId: null },
    { role: 'tutor', tutorId: 'tutor-123' },
    { role: 'developer', tutorId: null },
    { role: 'manager', tutorId: null },
  ]

  it.each(roleCases)('decodes a valid $role token', ({ role, tutorId }) => {
    const token = encodeToken({ sub: 'user-1', role, tutor_id: tutorId, exp: 1234567890 })

    expect(decodeAccessToken(token)).toEqual({
      sub: 'user-1',
      role,
      tutorId,
      exp: 1234567890,
    })
  })

  it('maps a missing tutor_id to null', () => {
    const token = encodeToken({ sub: 'user-1', role: 'admin', exp: 1234567890 })

    expect(decodeAccessToken(token)?.tutorId).toBeNull()
  })

  it('maps a non-string tutor_id to null', () => {
    const token = encodeToken({ sub: 'user-1', role: 'admin', tutor_id: 42, exp: 1234567890 })

    expect(decodeAccessToken(token)?.tutorId).toBeNull()
  })

  it('decodes fine even when exp has already passed, since expiry is never checked', () => {
    const token = encodeToken({ sub: 'user-1', role: 'admin', tutor_id: null, exp: 0 })

    expect(decodeAccessToken(token)).toEqual({
      sub: 'user-1',
      role: 'admin',
      tutorId: null,
      exp: 0,
    })
  })

  const rejectionCases: { name: string; token: string }[] = [
    { name: 'an unknown role', token: encodeToken({ sub: 'user-1', role: 'superuser', tutor_id: null, exp: 1 }) },
    { name: 'a missing role', token: encodeToken({ sub: 'user-1', tutor_id: null, exp: 1 }) },
    { name: 'a missing sub', token: encodeToken({ role: 'admin', tutor_id: null, exp: 1 }) },
    { name: 'a non-string sub', token: encodeToken({ sub: 42, role: 'admin', tutor_id: null, exp: 1 }) },
    { name: 'a missing exp', token: encodeToken({ sub: 'user-1', role: 'admin', tutor_id: null }) },
    { name: 'a non-number exp', token: encodeToken({ sub: 'user-1', role: 'admin', tutor_id: null, exp: 'soon' }) },
    { name: 'too few segments', token: 'onlyonesegment' },
    { name: 'too many segments', token: 'a.b.c.d' },
    { name: 'a non-base64 payload segment', token: 'a.not-valid-base64!!!.c' },
    { name: 'a payload that is valid JSON but not an object', token: `${btoa('{}')}.${btoa('"just a string"')}.c` },
  ]

  it.each(rejectionCases)('returns null for $name', ({ token }) => {
    expect(decodeAccessToken(token)).toBeNull()
  })
})

describe('landingPath', () => {
  const cases: { role: Role; expected: string }[] = [
    { role: 'admin', expected: '/dashboard' },
    { role: 'developer', expected: '/dashboard' },
    { role: 'manager', expected: '/dashboard' },
    { role: 'tutor', expected: '/schedule' },
  ]

  it.each(cases)('returns $expected for $role', ({ role, expected }) => {
    expect(landingPath(role)).toBe(expected)
  })
})

describe('role sets', () => {
  it('knows the four roles', () => {
    expect(ROLES).toEqual(['admin', 'manager', 'tutor', 'developer'])
  })

  it('counts every role but tutor as staff', () => {
    expect(OFFICE_ROLES).toEqual(['admin', 'manager', 'developer'])
  })

  it('keeps the admin set to admin and developer only', () => {
    expect(ADMIN_ROLES).toEqual(['admin', 'developer'])
  })
})

describe('isOfficeRole', () => {
  const cases: { role: Role; expected: boolean }[] = [
    { role: 'admin', expected: true },
    { role: 'manager', expected: true },
    { role: 'developer', expected: true },
    { role: 'tutor', expected: false },
  ]

  it.each(cases)('returns $expected for $role', ({ role, expected }) => {
    expect(isOfficeRole(role)).toBe(expected)
  })
})

describe('chromeFor', () => {
  const cases: { role: Role; expected: 'office' | 'tutor' }[] = [
    { role: 'admin', expected: 'office' },
    { role: 'manager', expected: 'office' },
    { role: 'developer', expected: 'office' },
    { role: 'tutor', expected: 'tutor' },
  ]

  it.each(cases)('gives $role the $expected chrome', ({ role, expected }) => {
    expect(chromeFor(role)).toBe(expected)
  })
})

describe('guardDecision', () => {
  it('waits while the session bootstrap is in flight', () => {
    expect(guardDecision('loading', null, OFFICE_ROLES)).toEqual({ kind: 'wait' })
  })

  it('sends an anonymous visitor to login', () => {
    expect(guardDecision('anonymous', null, OFFICE_ROLES)).toEqual({
      kind: 'redirect',
      to: '/login',
    })
  })

  it('lets a manager onto a staff route', () => {
    expect(guardDecision('authenticated', 'manager', OFFICE_ROLES)).toEqual({ kind: 'allow' })
  })

  it('sends a manager on an admin-only route such as /users or /settings to the dashboard', () => {
    expect(guardDecision('authenticated', 'manager', ADMIN_ROLES)).toEqual({
      kind: 'redirect',
      to: '/dashboard',
    })
  })

  it('lets an admin onto an admin-only route', () => {
    expect(guardDecision('authenticated', 'admin', ADMIN_ROLES)).toEqual({ kind: 'allow' })
  })

  it('sends a tutor on a staff route to their schedule', () => {
    expect(guardDecision('authenticated', 'tutor', OFFICE_ROLES)).toEqual({
      kind: 'redirect',
      to: '/schedule',
    })
  })
})
