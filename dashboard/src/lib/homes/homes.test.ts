import { describe, it, expect } from 'vitest'
import {
  homeDraftErrors,
  homeDraftFrom,
  homeInput,
  homeName,
  homeUpdate,
  type HomeDraft,
} from './homes'
import type { Home } from '../queries/guardians'

const BASE_HOME: Home = {
  id: 'home-1',
  label: "Mum's",
  address: '123 Main St',
  access_code: '1234',
  is_active: true,
}

describe('homeDraftErrors', () => {
  const validDraft: HomeDraft = { label: '', address: '123 Main St', accessCode: '1234' }

  it('refuses a blank address', () => {
    expect(homeDraftErrors({ ...validDraft, address: '   ' })).toContain('Address is required.')
  })

  it('refuses a blank access code', () => {
    expect(homeDraftErrors({ ...validDraft, accessCode: '' })).toContain(
      'Access code is required.',
    )
  })

  it('refuses a 65-character label', () => {
    expect(homeDraftErrors({ ...validDraft, label: 'a'.repeat(65) })).toContain(
      'Label must be 64 characters or fewer.',
    )
  })

  it('accepts a valid draft', () => {
    expect(homeDraftErrors(validDraft)).toEqual([])
  })
})

describe('homeInput', () => {
  it('sends label: null for an empty label', () => {
    expect(homeInput({ label: '', address: '123 Main St', accessCode: '1234' })).toEqual({
      label: null,
      address: '123 Main St',
      access_code: '1234',
    })
  })

  it('trims and keeps a non-empty label', () => {
    expect(homeInput({ label: " Mum's ", address: '123 Main St', accessCode: '1234' })).toEqual({
      label: "Mum's",
      address: '123 Main St',
      access_code: '1234',
    })
  })
})

describe('homeDraftFrom', () => {
  it('falls back to an empty label', () => {
    expect(homeDraftFrom({ ...BASE_HOME, label: null })).toEqual({
      label: '',
      address: '123 Main St',
      accessCode: '1234',
    })
  })
})

describe('homeUpdate', () => {
  it('returns {} for no change', () => {
    expect(homeUpdate(homeDraftFrom(BASE_HOME), BASE_HOME)).toEqual({})
  })

  it('returns { label: "" } for a cleared label', () => {
    expect(homeUpdate({ label: '', address: '123 Main St', accessCode: '1234' }, BASE_HOME)).toEqual({
      label: '',
    })
  })

  it('returns only the changed field', () => {
    expect(
      homeUpdate({ label: "Mum's", address: '123 Main St', accessCode: '0000' }, BASE_HOME),
    ).toEqual({ access_code: '0000' })
  })
})

describe('homeName', () => {
  it('uses the label when present', () => {
    expect(homeName(BASE_HOME)).toBe("Mum's")
  })

  it('falls back to the address', () => {
    expect(homeName({ ...BASE_HOME, label: null })).toBe('123 Main St')
  })
})
