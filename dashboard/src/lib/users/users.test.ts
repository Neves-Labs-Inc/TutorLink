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
    tutorMode: 'link',
    newTutor: { name: '', phoneNumber: '', bio: '' },
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

  it('reports a missing name and phone for a new tutor on create', () => {
    expect(
      userFormErrors({ ...validDraft, role: 'tutor', tutorMode: 'new' }, 'create'),
    ).toEqual(['New tutor name is required.', 'New tutor phone number is required.'])
  })

  it('accepts a new tutor with a name and phone on create', () => {
    expect(
      userFormErrors(
        { ...validDraft, role: 'tutor', tutorMode: 'new', newTutor: { name: 'Jane', phoneNumber: '555-0100', bio: '' } },
        'create',
      ),
    ).toEqual([])
  })

  it('does not report missing new-tutor fields for a tutor role on edit', () => {
    expect(userFormErrors({ ...validDraft, role: 'tutor', tutorMode: 'new' }, 'edit')).toEqual([])
  })

  it('reports no tutor errors for a non-tutor role, whichever tutor mode the draft is left in', () => {
    expect(userFormErrors({ ...validDraft, role: 'admin', tutorMode: 'new' }, 'create')).toEqual([])
    expect(
      userFormErrors({ ...validDraft, role: 'developer', tutorMode: 'link', tutorId: null }, 'create'),
    ).toEqual([])
  })

  it('collects multiple errors together', () => {
    expect(
      userFormErrors(
        { email: '', password: 'short', role: 'tutor', tutorId: null, tutorMode: 'link', newTutor: { name: '', phoneNumber: '', bio: '' } },
        'create',
      ),
    ).toEqual([
      'Email is required.',
      'Password must be at least 8 characters.',
      'A tutor account requires a linked tutor.',
    ])
  })
})

describe('createUserPayload', () => {
  const emptyNewTutor = { name: '', phoneNumber: '', bio: '' }

  it('trims the email and omits tutor_id and tutor for a non-tutor role', () => {
    expect(
      createUserPayload({
        email: '  person@example.com  ',
        password: 'longenough',
        role: 'admin',
        tutorId: null,
        tutorMode: 'link',
        newTutor: emptyNewTutor,
      }),
    ).toEqual({ email: 'person@example.com', password: 'longenough', role: 'admin' })
  })

  it('includes tutor_id for a tutor role linking an existing tutor', () => {
    expect(
      createUserPayload({
        email: 'person@example.com',
        password: 'longenough',
        role: 'tutor',
        tutorId: 'tutor-1',
        tutorMode: 'link',
        newTutor: emptyNewTutor,
      }),
    ).toEqual({ email: 'person@example.com', password: 'longenough', role: 'tutor', tutor_id: 'tutor-1' })
  })

  it('omits tutor_id for a tutor role with no selection', () => {
    expect(
      createUserPayload({
        email: 'person@example.com',
        password: 'longenough',
        role: 'tutor',
        tutorId: null,
        tutorMode: 'link',
        newTutor: emptyNewTutor,
      }),
    ).toEqual({ email: 'person@example.com', password: 'longenough', role: 'tutor' })
  })

  it('includes a trimmed tutor object for a tutor role creating a new tutor', () => {
    expect(
      createUserPayload({
        email: 'person@example.com',
        password: 'longenough',
        role: 'tutor',
        tutorId: null,
        tutorMode: 'new',
        newTutor: { name: '  Jane Doe  ', phoneNumber: '  555-0100  ', bio: '  Loves algebra  ' },
      }),
    ).toEqual({
      email: 'person@example.com',
      password: 'longenough',
      role: 'tutor',
      tutor: { name: 'Jane Doe', phone_number: '555-0100', bio: 'Loves algebra' },
    })
  })

  it('omits bio from the tutor object when blank', () => {
    expect(
      createUserPayload({
        email: 'person@example.com',
        password: 'longenough',
        role: 'tutor',
        tutorId: null,
        tutorMode: 'new',
        newTutor: { name: 'Jane Doe', phoneNumber: '555-0100', bio: '' },
      }),
    ).toEqual({
      email: 'person@example.com',
      password: 'longenough',
      role: 'tutor',
      tutor: { name: 'Jane Doe', phone_number: '555-0100' },
    })
  })

  // The draft can hold a tutor selection and a filled-in new tutor at the same time — switching
  // the radio back and forth leaves both populated. The server rejects a request carrying both
  // `tutor_id` and `tutor`, so `tutorMode` alone must decide which one ships.
  it('sends only tutor_id when a new tutor is also filled in and the mode is link', () => {
    expect(
      createUserPayload({
        email: 'person@example.com',
        password: 'longenough',
        role: 'tutor',
        tutorId: 'tutor-1',
        tutorMode: 'link',
        newTutor: { name: 'Jane Doe', phoneNumber: '555-0100', bio: 'Loves algebra' },
      }),
    ).toEqual({ email: 'person@example.com', password: 'longenough', role: 'tutor', tutor_id: 'tutor-1' })
  })

  it('sends only tutor when a tutor is also selected and the mode is new', () => {
    expect(
      createUserPayload({
        email: 'person@example.com',
        password: 'longenough',
        role: 'tutor',
        tutorId: 'tutor-1',
        tutorMode: 'new',
        newTutor: { name: 'Jane Doe', phoneNumber: '555-0100', bio: '' },
      }),
    ).toEqual({
      email: 'person@example.com',
      password: 'longenough',
      role: 'tutor',
      tutor: { name: 'Jane Doe', phone_number: '555-0100' },
    })
  })

  it('sends neither tutor_id nor tutor for a non-tutor role, even with both filled in', () => {
    expect(
      createUserPayload({
        email: 'person@example.com',
        password: 'longenough',
        role: 'admin',
        tutorId: 'tutor-1',
        tutorMode: 'new',
        newTutor: { name: 'Jane Doe', phoneNumber: '555-0100', bio: 'Loves algebra' },
      }),
    ).toEqual({ email: 'person@example.com', password: 'longenough', role: 'admin' })
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
