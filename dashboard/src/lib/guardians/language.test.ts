import { describe, expect, it } from 'vitest'
import { isLanguageEditable, languageFromOption, languageNote, languageToOption } from './language'

describe('languageNote', () => {
  it.each([
    ['es', 'The bot writes to this Guardian in Spanish.'],
    ['en', 'The bot writes to this Guardian in English.'],
    [null, 'Not detected yet, so the bot writes in English.'],
  ] as const)('explains %s', (value, note) => {
    expect(languageNote(value)).toBe(note)
  })
})

describe('isLanguageEditable', () => {
  it('is editable when the Guardian has a chat', () => {
    expect(isLanguageEditable('conv-1')).toBe(true)
  })

  it('is read-only without a chat', () => {
    expect(isLanguageEditable(null)).toBe(false)
  })
})

describe('language select options', () => {
  it('maps not detected to the empty option and back', () => {
    expect(languageToOption(null)).toBe('')
    expect(languageFromOption('')).toBeNull()
  })

  it('round-trips a language', () => {
    expect(languageFromOption(languageToOption('es'))).toBe('es')
  })
})
