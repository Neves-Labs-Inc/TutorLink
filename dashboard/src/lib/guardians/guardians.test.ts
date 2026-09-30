import { describe, it, expect } from 'vitest'
import {
  guardianFormErrors,
  createGuardianPayload,
  formatPhoneForDisplay,
  type GuardianDraft,
} from './guardians'
import type { GuardianCreate } from '../queries/guardians'

describe('formatPhoneForDisplay', () => {
  const cases: { input: string; expected: string }[] = [
    { input: '+12025550123', expected: '+1 (202) 555-0123' },
    { input: '+442071838750', expected: '+442071838750' },
    { input: '+5511987654321', expected: '+5511987654321' },
    { input: '+1202555012', expected: '+1202555012' },
    { input: '2025550123', expected: '2025550123' },
    { input: '', expected: '' },
  ]

  it.each(cases)('renders $input as $expected', ({ input, expected }) => {
    expect(formatPhoneForDisplay(input)).toBe(expected)
  })
})

describe('guardianFormErrors', () => {
  const emptyHome: GuardianDraft['home'] = { label: '', address: '', accessCode: '' }
  const validDraft: GuardianDraft = { name: 'Jane Doe', phoneNumber: '555-0100', home: emptyHome }

  it('returns no errors for a valid draft with no home', () => {
    expect(guardianFormErrors(validDraft)).toEqual([])
  })

  it('returns no errors for a valid draft with a full home', () => {
    expect(
      guardianFormErrors({
        ...validDraft,
        home: { label: 'Main house', address: '123 Elm St', accessCode: '4321' },
      }),
    ).toEqual([])
  })

  it('reports an empty name', () => {
    expect(guardianFormErrors({ ...validDraft, name: '' })).toEqual(['Name is required.'])
  })

  it('reports a whitespace-only name', () => {
    expect(guardianFormErrors({ ...validDraft, name: '   ' })).toEqual(['Name is required.'])
  })

  it('reports an empty phone number', () => {
    expect(guardianFormErrors({ ...validDraft, phoneNumber: '' })).toEqual([
      'Phone number is required.',
    ])
  })

  it('reports a home missing its access code', () => {
    expect(
      guardianFormErrors({ ...validDraft, home: { ...emptyHome, address: '123 Elm St' } }),
    ).toEqual(['A home requires both an address and an access code.'])
  })

  it('reports a home missing its address', () => {
    expect(
      guardianFormErrors({ ...validDraft, home: { ...emptyHome, accessCode: '4321' } }),
    ).toEqual(['A home requires both an address and an access code.'])
  })

  it('collects multiple errors together', () => {
    expect(
      guardianFormErrors({
        name: '',
        phoneNumber: '',
        home: { ...emptyHome, address: '123 Elm St' },
      }),
    ).toEqual([
      'Name is required.',
      'Phone number is required.',
      'A home requires both an address and an access code.',
    ])
  })
})

describe('createGuardianPayload', () => {
  const emptyHome: GuardianDraft['home'] = { label: '', address: '', accessCode: '' }

  it('trims name and phone and omits home when every home field is blank', () => {
    const expected: GuardianCreate = { name: 'Jane Doe', phone_number: '555-0100' }

    expect(
      createGuardianPayload({ name: '  Jane Doe  ', phoneNumber: '  555-0100  ', home: emptyHome }),
    ).toEqual(expected)
  })

  it('includes a trimmed home with a null label when the label is blank', () => {
    expect(
      createGuardianPayload({
        name: 'Jane Doe',
        phoneNumber: '555-0100',
        home: { label: '  ', address: '  123 Elm St  ', accessCode: '  4321  ' },
      }),
    ).toEqual({
      name: 'Jane Doe',
      phone_number: '555-0100',
      home: { address: '123 Elm St', access_code: '4321', label: null },
    })
  })

  it('includes a trimmed label when present', () => {
    expect(
      createGuardianPayload({
        name: 'Jane Doe',
        phoneNumber: '555-0100',
        home: { label: '  Main house  ', address: '123 Elm St', accessCode: '4321' },
      }),
    ).toEqual({
      name: 'Jane Doe',
      phone_number: '555-0100',
      home: { address: '123 Elm St', access_code: '4321', label: 'Main house' },
    })
  })
})
