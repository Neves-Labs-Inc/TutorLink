import { describe, it, expect } from 'vitest'
import {
  displayNameError,
  editRoleOptions,
  roleLabel,
  roleOptions,
  requiresProfile,
  accessBadge,
  userFormErrors,
  createUserPayload,
  updateUserPayload,
  type UserDraft,
} from './users'

describe('roleOptions', () => {
  const cases: { viewerRole: string; expected: string[] }[] = [
    { viewerRole: 'admin', expected: ['admin', 'manager', 'tutor'] },
    { viewerRole: 'developer', expected: ['admin', 'manager', 'tutor', 'developer'] },
    { viewerRole: 'manager', expected: ['admin', 'manager', 'tutor'] },
    { viewerRole: 'tutor', expected: ['admin', 'manager', 'tutor'] },
  ]

  it.each(cases)('offers $expected for a $viewerRole viewer', ({ viewerRole, expected }) => {
    expect(roleOptions(viewerRole).map((option) => option.value)).toEqual(expected)
  })
})

describe('editRoleOptions', () => {
  it('adds the developer role back in, disabled, for an admin viewing a developer row', () => {
    const options = editRoleOptions('admin', 'developer')

    expect(options.map((option) => option.value)).toEqual(['admin', 'manager', 'tutor', 'developer'])
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

describe('requiresProfile', () => {
  const cases: { role: string; expected: boolean }[] = [
    { role: 'admin', expected: false },
    { role: 'manager', expected: true },
    { role: 'tutor', expected: true },
    { role: 'developer', expected: false },
  ]

  it.each(cases)('returns $expected for role $role', ({ role, expected }) => {
    expect(requiresProfile(role)).toBe(expected)
  })
})

describe('userFormErrors', () => {
  const validDraft: UserDraft = {
    displayName: 'Maria Lopez',
    email: 'person@example.com',
    role: 'admin',
    profile: { phoneNumber: '', bio: '' },
  }
  const withPhone = { phoneNumber: '555-0100', bio: '' }

  it('returns no errors for a valid create draft', () => {
    expect(userFormErrors(validDraft, 'create')).toEqual([])
  })

  it('returns no errors for a valid edit draft', () => {
    expect(userFormErrors(validDraft, 'edit')).toEqual([])
  })

  it('reports an empty email', () => {
    expect(userFormErrors({ ...validDraft, email: '' }, 'create')).toEqual(['Email is required.'])
  })

  it('reports an email with no @', () => {
    expect(userFormErrors({ ...validDraft, email: 'nope' }, 'create')).toEqual([
      'Email must be a valid address.',
    ])
  })

  it.each(['tutor', 'manager'])('requires a phone number for a %s on create', (role) => {
    expect(userFormErrors({ ...validDraft, role }, 'create')).toEqual(['Phone number is required.'])
  })

  it('treats a whitespace-only phone number as missing', () => {
    expect(
      userFormErrors({ ...validDraft, role: 'tutor', profile: { phoneNumber: '   ', bio: '' } }, 'create'),
    ).toEqual(['Phone number is required.'])
  })

  it.each(['tutor', 'manager'])('accepts a %s with a phone number on create', (role) => {
    expect(userFormErrors({ ...validDraft, role, profile: withPhone }, 'create')).toEqual([])
  })

  it('does not ask for a phone number on edit', () => {
    expect(userFormErrors({ ...validDraft, role: 'tutor' }, 'edit')).toEqual([])
  })

  it('does not ask for a phone number for admin or developer on create', () => {
    expect(userFormErrors({ ...validDraft, role: 'admin' }, 'create')).toEqual([])
    expect(userFormErrors({ ...validDraft, role: 'developer' }, 'create')).toEqual([])
  })

  const displayNameCases: { role: string; mode: 'create' | 'edit' }[] = [
    { role: 'admin', mode: 'create' },
    { role: 'manager', mode: 'edit' },
    { role: 'developer', mode: 'create' },
    { role: 'tutor', mode: 'create' },
    { role: 'tutor', mode: 'edit' },
  ]

  it.each(displayNameCases)('requires a Display name for a $role on $mode', ({ role, mode }) => {
    const draft = { ...validDraft, role, profile: withPhone, displayName: '   ' }

    expect(userFormErrors(draft, mode)).toEqual(['Display name is required.'])
  })

  it('refuses a Display name over 255 characters, tutor included', () => {
    const draft = { ...validDraft, role: 'tutor', profile: withPhone, displayName: 'a'.repeat(256) }

    expect(userFormErrors(draft, 'create')).toEqual(['Display name must be 255 characters or fewer.'])
  })

  it('collects multiple errors together', () => {
    expect(
      userFormErrors(
        { displayName: '', email: '', role: 'tutor', profile: { phoneNumber: '', bio: '' } },
        'create',
      ),
    ).toEqual(['Display name is required.', 'Email is required.', 'Phone number is required.'])
  })
})

describe('createUserPayload', () => {
  const draftFor = (role: string, profile = { phoneNumber: '', bio: '' }): UserDraft => ({
    displayName: '  Maria Lopez  ',
    email: '  person@example.com  ',
    role,
    profile,
  })

  it('trims the email and name and sends no tutor or password for an Admin', () => {
    expect(
      createUserPayload(draftFor('admin', { phoneNumber: '555-0100', bio: 'left over' })),
    ).toEqual({ email: 'person@example.com', name: 'Maria Lopez', role: 'admin' })
  })

  it.each(['tutor', 'manager'])('sends a trimmed tutor profile for a %s', (role) => {
    expect(
      createUserPayload(draftFor(role, { phoneNumber: '  555-0100  ', bio: '  Loves algebra  ' })),
    ).toEqual({
      email: 'person@example.com',
      name: 'Maria Lopez',
      role,
      tutor: { phone_number: '555-0100', bio: 'Loves algebra' },
    })
  })

  it('omits bio from the profile when blank', () => {
    expect(createUserPayload(draftFor('tutor', { phoneNumber: '555-0100', bio: '   ' }))).toEqual({
      email: 'person@example.com',
      name: 'Maria Lopez',
      role: 'tutor',
      tutor: { phone_number: '555-0100' },
    })
  })

  it('never carries a password, tutor_id or tutor name', () => {
    const payload = createUserPayload(draftFor('tutor', { phoneNumber: '555-0100', bio: '' }))

    expect(payload).not.toHaveProperty('password')
    expect(payload).not.toHaveProperty('tutor_id')
    expect(payload.tutor).not.toHaveProperty('name')
  })
})

describe('updateUserPayload', () => {
  it('sends the account fields and no password', () => {
    expect(
      updateUserPayload({
        displayName: ' Maria Lopez ',
        email: ' person@example.com ',
        role: 'admin',
        profile: { phoneNumber: '', bio: '' },
        isActive: false,
      }),
    ).toEqual({ email: 'person@example.com', name: 'Maria Lopez', role: 'admin', is_active: false })
  })
})

describe('accessBadge', () => {
  const user = { has_password: true, invite_expires_at: null }

  it('is null for a user with a password', () => {
    expect(accessBadge(user)).toBeNull()
  })

  it('is no_login for a user without a password or an invite', () => {
    expect(accessBadge({ ...user, has_password: false })).toBe('no_login')
  })

  it('is invited when an invite expiry is set', () => {
    expect(accessBadge({ has_password: false, invite_expires_at: '2026-10-20T00:00:00Z' })).toBe('invited')
  })
})

describe('displayNameError', () => {
  it('accepts a normal name', () => {
    expect(displayNameError('Maria Lopez')).toBeNull()
  })

  it('refuses a blank name', () => {
    expect(displayNameError('')).toBe('Display name is required.')
  })

  it('refuses a whitespace-only name', () => {
    expect(displayNameError('   ')).toBe('Display name is required.')
  })

  it('accepts exactly 255 characters', () => {
    expect(displayNameError('a'.repeat(255))).toBeNull()
  })

  it('refuses 256 characters', () => {
    expect(displayNameError('a'.repeat(256))).toBe('Display name must be 255 characters or fewer.')
  })

  it('measures the trimmed name, as the server stores it', () => {
    expect(displayNameError(`  ${'a'.repeat(255)}  `)).toBeNull()
  })

  it('counts characters, not UTF-16 units, as the server does', () => {
    expect(displayNameError('😀'.repeat(255))).toBeNull()
  })
})

describe('roleLabel', () => {
  const cases: { role: string; expected: string }[] = [
    { role: 'admin', expected: 'Admin' },
    { role: 'manager', expected: 'Manager' },
    { role: 'tutor', expected: 'Tutor' },
    { role: 'developer', expected: 'Developer' },
  ]

  it.each(cases)('labels $role as $expected', ({ role, expected }) => {
    expect(roleLabel(role)).toBe(expected)
  })
})
