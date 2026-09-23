import { describe, it, expect } from 'vitest'
import {
  clientFormErrors,
  clientListParams,
  createClientPayload,
  formatPhoneForDisplay,
  type ClientDraft,
  type ClientFilterState,
} from './clients'
import type { ClientCreate, ClientListParams } from '../queries/clients'

describe('clientListParams', () => {
  const baseState: ClientFilterState = { q: '', isActive: true, page: 1, pageSize: 20 }

  const cases: { name: string; state: ClientFilterState; expected: ClientListParams }[] = [
    {
      name: 'drops an empty search term',
      state: baseState,
      expected: { is_active: true, page: 1, page_size: 20 },
    },
    {
      name: 'drops a whitespace-only search term',
      state: { ...baseState, q: '   ' },
      expected: { is_active: true, page: 1, page_size: 20 },
    },
    {
      name: 'keeps a search term of pure digits',
      state: { ...baseState, q: '555' },
      expected: { q: '555', is_active: true, page: 1, page_size: 20 },
    },
    {
      name: 'trims a padded search term',
      state: { ...baseState, q: '  ann  ' },
      expected: { q: 'ann', is_active: true, page: 1, page_size: 20 },
    },
    {
      name: 'carries page and page size on a later page',
      state: { ...baseState, page: 3, pageSize: 50 },
      expected: { is_active: true, page: 3, page_size: 50 },
    },
    {
      name: 'asks for inactive clients',
      state: { ...baseState, isActive: false },
      expected: { is_active: false, page: 1, page_size: 20 },
    },
  ]

  it.each(cases)('$name', ({ state, expected }) => {
    expect(clientListParams(state)).toEqual(expected)
  })
})

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

describe('clientFormErrors', () => {
  const emptyHome: ClientDraft['home'] = { label: '', address: '', accessCode: '' }
  const validDraft: ClientDraft = { name: 'Jane Doe', phoneNumber: '555-0100', home: emptyHome }

  it('returns no errors for a valid draft with no home', () => {
    expect(clientFormErrors(validDraft)).toEqual([])
  })

  it('returns no errors for a valid draft with a full home', () => {
    expect(
      clientFormErrors({
        ...validDraft,
        home: { label: 'Main house', address: '123 Elm St', accessCode: '4321' },
      }),
    ).toEqual([])
  })

  it('reports an empty name', () => {
    expect(clientFormErrors({ ...validDraft, name: '' })).toEqual(['Name is required.'])
  })

  it('reports a whitespace-only name', () => {
    expect(clientFormErrors({ ...validDraft, name: '   ' })).toEqual(['Name is required.'])
  })

  it('reports an empty phone number', () => {
    expect(clientFormErrors({ ...validDraft, phoneNumber: '' })).toEqual([
      'Phone number is required.',
    ])
  })

  it('reports a home missing its access code', () => {
    expect(
      clientFormErrors({ ...validDraft, home: { ...emptyHome, address: '123 Elm St' } }),
    ).toEqual(['A home requires both an address and an access code.'])
  })

  it('reports a home missing its address', () => {
    expect(
      clientFormErrors({ ...validDraft, home: { ...emptyHome, accessCode: '4321' } }),
    ).toEqual(['A home requires both an address and an access code.'])
  })

  it('collects multiple errors together', () => {
    expect(
      clientFormErrors({ name: '', phoneNumber: '', home: { ...emptyHome, address: '123 Elm St' } }),
    ).toEqual([
      'Name is required.',
      'Phone number is required.',
      'A home requires both an address and an access code.',
    ])
  })
})

describe('createClientPayload', () => {
  const emptyHome: ClientDraft['home'] = { label: '', address: '', accessCode: '' }

  it('trims name and phone and omits home when every home field is blank', () => {
    const expected: ClientCreate = { name: 'Jane Doe', phone_number: '555-0100' }

    expect(
      createClientPayload({ name: '  Jane Doe  ', phoneNumber: '  555-0100  ', home: emptyHome }),
    ).toEqual(expected)
  })

  it('includes a trimmed home with a null label when the label is blank', () => {
    expect(
      createClientPayload({
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
      createClientPayload({
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
