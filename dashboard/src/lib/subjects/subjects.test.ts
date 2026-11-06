import { describe, expect, it } from 'vitest'
import {
  descriptionValue,
  isNameEsError,
  isNameError,
  spanishNameDisplay,
  spanishNameValue,
  subjectErrorMessage,
  subjectNameValue,
  tutorCountSentence,
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

describe('isNameEsError', () => {
  it('is true for a name_es detail', () => {
    expect(isNameEsError('name_es: String should have at most 100 characters')).toBe(true)
  })

  it('is false for a name detail and for anything else', () => {
    expect(isNameEsError('name: Field required')).toBe(false)
    expect(isNameEsError(null)).toBe(false)
  })
})

describe('descriptionValue', () => {
  it('trims the draft', () => {
    expect(descriptionValue('  Fractions ')).toBe('Fractions')
  })

  it('sends a blank draft as null', () => {
    expect(descriptionValue('  ')).toBeNull()
  })
})

describe('tutorCountSentence', () => {
  it('says no tutors teach it for 0', () => {
    expect(tutorCountSentence(0)).toBe('No tutors teach it.')
  })

  it('says 1 tutor teaches it for 1', () => {
    expect(tutorCountSentence(1)).toBe('1 tutor teaches it.')
  })

  it('says N tutors teach it for more', () => {
    expect(tutorCountSentence(4)).toBe('4 tutors teach it.')
  })
})
