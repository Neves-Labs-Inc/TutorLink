import { describe, it, expect } from 'vitest'
import { displayNameError, roleLabel } from './users'

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
