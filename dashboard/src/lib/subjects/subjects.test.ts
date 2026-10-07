import { describe, expect, it } from 'vitest'
import { spanishNameDisplay, spanishNameValue, subjectErrorMessage } from './subjects'

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

describe('subjectErrorMessage', () => {
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
