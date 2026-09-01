import { describe, it, expect } from 'vitest'
import {
  editRoleOptions,
  roleOptions,
  requiresTutorLink,
  userFormErrors,
  createUserPayload,
  updateUserPayload,
  type UserDraft,
} from './users'

describe('roleOptions', () => {
  const cases: { viewerRole: string; expected: string[] }[] = [
    { viewerRole: 'admin', expected: ['admin', 'tutor'] },
    { viewerRole: 'developer', expected: ['admin', 'tutor', 'developer'] },
    { viewerRole: 'tutor', expected: ['admin', 'tutor'] },
  ]

  it.each(cases)('offers $expected for a $viewerRole viewer', ({ viewerRole, expected }) => {
    expect(roleOptions(viewerRole).map((option) => option.value)).toEqual(expected)
  })
})

describe('editRoleOptions', () => {
  it('adds the developer role back in, disabled, for an admin viewing a developer row', () => {
    const options = editRoleOptions('admin', 'developer')

    expect(options.map((option) => option.value)).toEqual(['admin', 'tutor', 'developer'])
    expect(options.find((option) => option.value === 'developer')).toEqual({
      value: 'developer',
      label: 'Developer',
      disabled: true,
    })
  })

  it('does not disable any option for an admin viewing an admin row', () => {
    const options = editRoleOptions('admin', 'admin')

    expect(options).toEqual(roleOptions('admin'))
    expect(options.some((option) => option.disabled)).toBe(false)
  })

  it('does not disable any option for a developer viewing a developer row', () => {
    const options = editRoleOptions('developer', 'developer')

    expect(options).toEqual(roleOptions('developer'))
    expect(options.some((option) => option.disabled)).toBe(false)
  })

  it('does not disable any option for a developer viewing an admin row', () => {
    const options = editRoleOptions('developer', 'admin')

    expect(options).toEqual(roleOptions('developer'))
    expect(options.some((option) => option.disabled)).toBe(false)
  })
})

describe('requiresTutorLink', () => {
  const cases: { role: string; expected: boolean }[] = [
    { role: 'admin', expected: false },
    { role: 'tutor', expected: true },
    { role: 'developer', expected: false },
  ]

  it.each(cases)('returns $expected for role $role', ({ role, expected }) => {
    expect(requiresTutorLink(role)).toBe(expected)
  })
})

describe('userFormErrors', () => {
  const validDraft: UserDraft = {
    email: 'person@example.com',
    password: 'longenough',
    role: 'admin',
    tutorId: null,
  }

  it('returns no errors for a valid create draft', () => {
    expect(userFormErrors(validDraft, 'create')).toEqual([])
  })

  it('returns no errors for a valid edit draft with a blank password', () => {
    expect(userFormErrors({ ...validDraft, password: '' }, 'edit')).toEqual([])
  })

  it('reports an empty email', () => {
    expect(userFormErrors({ ...validDraft, email: '' }, 'create')).toEqual(['Email is required.'])
  })

  it('reports an email with no @', () => {
    expect(userFormErrors({ ...validDraft, email: 'nope' }, 'create')).toEqual([
      'Email must be a valid address.',
    ])
  })

  it('reports a short password on create', () => {
    expect(userFormErrors({ ...validDraft, password: 'short' }, 'create')).toEqual([
      'Password must be at least 8 characters.',
    ])
  })

  it('does not check password length on edit, even when short', () => {
    expect(userFormErrors({ ...validDraft, password: 'short' }, 'edit')).toEqual([])
  })

  it('reports a missing tutor link for a tutor role on create', () => {
    expect(
      userFormErrors({ ...validDraft, role: 'tutor', tutorId: null }, 'create'),
    ).toEqual(['A tutor account requires a linked tutor.'])
  })

  it('does not report a missing tutor link for a tutor role on edit', () => {
    expect(userFormErrors({ ...validDraft, role: 'tutor', tutorId: null }, 'edit')).toEqual([])
  })

  it('accepts a tutor role with a tutor link on create', () => {
    expect(
      userFormErrors({ ...validDraft, role: 'tutor', tutorId: 'tutor-1' }, 'create'),
    ).toEqual([])
  })

  it('collects multiple errors together', () => {
    expect(userFormErrors({ email: '', password: 'short', role: 'tutor', tutorId: null }, 'create')).toEqual([
      'Email is required.',
      'Password must be at least 8 characters.',
      'A tutor account requires a linked tutor.',
    ])
  })
})

describe('createUserPayload', () => {
  it('trims the email and omits tutor_id for a non-tutor role', () => {
    expect(
      createUserPayload({ email: '  person@example.com  ', password: 'longenough', role: 'admin', tutorId: null }),
    ).toEqual({ email: 'person@example.com', password: 'longenough', role: 'admin' })
  })

  it('includes tutor_id for a tutor role with a selection', () => {
    expect(
      createUserPayload({ email: 'person@example.com', password: 'longenough', role: 'tutor', tutorId: 'tutor-1' }),
    ).toEqual({ email: 'person@example.com', password: 'longenough', role: 'tutor', tutor_id: 'tutor-1' })
  })

  it('omits tutor_id for a tutor role with no selection', () => {
    expect(
      createUserPayload({ email: 'person@example.com', password: 'longenough', role: 'tutor', tutorId: null }),
    ).toEqual({ email: 'person@example.com', password: 'longenough', role: 'tutor' })
  })
})

describe('updateUserPayload', () => {
  it('omits password when blank', () => {
    expect(
      updateUserPayload({ email: 'person@example.com', password: '', role: 'admin', isActive: true }),
    ).toEqual({ email: 'person@example.com', role: 'admin', is_active: true })
  })

  it('omits password when only whitespace', () => {
    expect(
      updateUserPayload({ email: 'person@example.com', password: '   ', role: 'admin', isActive: true }),
    ).toEqual({ email: 'person@example.com', role: 'admin', is_active: true })
  })

  it('includes password when non-empty', () => {
    expect(
      updateUserPayload({ email: 'person@example.com', password: 'newpassword', role: 'admin', isActive: false }),
    ).toEqual({ email: 'person@example.com', role: 'admin', is_active: false, password: 'newpassword' })
  })

  it('never includes a tutor_id field', () => {
    const payload = updateUserPayload({
      email: 'person@example.com',
      password: '',
      role: 'tutor',
      isActive: true,
    })

    expect(payload).not.toHaveProperty('tutor_id')
  })
})
