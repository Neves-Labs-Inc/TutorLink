import { describe, expect, it } from 'vitest'
import {
  isNameError,
  spanishNameDisplay,
  spanishNameValue,
  subjectErrorMessage,
  subjectNameValue,
} from './subjects'

describe('spanishNameDisplay', () => {
  it('shows the Spanish name when there is one', () => {
    expect(spanishNameDisplay('Matemáticas')).toBe('Matemáticas')
  })

  it('says the English name is used when blank', () => {
    expect(spanishNameDisplay(null)).toBe('— (English name used)')
  })
})

describe('spanishNameValue', () => {
  it('trims the draft', () => {
    expect(spanishNameValue('  Lectura ')).toBe('Lectura')
  })

  it('sends a blank draft as null', () => {
    expect(spanishNameValue('   ')).toBeNull()
  })
})

describe('subjectNameValue', () => {
  it('trims the draft', () => {
    expect(subjectNameValue(' Biology ')).toBe('Biology')
  })
})

describe('isNameError', () => {
  it('is true for a name: detail', () => {
    expect(isNameError('name: must not be blank')).toBe(true)
  })

  it('is false for a name_es: detail', () => {
    expect(isNameError('name_es: too long')).toBe(false)
  })

  it('is false for no detail', () => {
    expect(isNameError(null)).toBe(false)
  })
})

describe('subjectErrorMessage', () => {
  it('names the Name field in place of its raw key', () => {
    expect(subjectErrorMessage('name: must not be blank')).toBe('Name: must not be blank')
  })

  it('names the Spanish name field in place of its raw key', () => {
    expect(subjectErrorMessage('name_es: String should have at most 128 characters')).toBe(
      'Spanish name: String should have at most 128 characters',
    )
  })

  it('keeps other messages and null', () => {
    expect(subjectErrorMessage('Subject name already exists')).toBe('Subject name already exists')
    expect(subjectErrorMessage(null)).toBeNull()
  })
})
