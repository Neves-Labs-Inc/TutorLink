import type { Language } from '@/lib/reminders/reminders'

export const LANGUAGE_LABELS: Record<Language, string> = { en: 'English', es: 'Spanish' }
export const NOT_DETECTED_LABEL = 'Not detected — English used'

const LANGUAGE_NOTES: Record<Language, string> = {
  es: 'The bot writes to this Guardian in Spanish.',
  en: 'The bot writes to this Guardian in English.',
}
const NOT_DETECTED_NOTE = 'Not detected yet, so the bot writes in English.'
export const NO_CHAT_NOTE = 'No chat yet. English is used.'

export const languageNote = (value: Language | null): string =>
  value === null ? NOT_DETECTED_NOTE : LANGUAGE_NOTES[value]

// The language lives on a conversation, so a Guardian with no chat has nothing to edit.
export const isLanguageEditable = (languageConversationId: string | null): boolean =>
  languageConversationId !== null

// A <select> value is a string, and "not detected" is the empty one.
export const languageToOption = (value: Language | null): string => value ?? ''

export const languageFromOption = (option: string): Language | null =>
  option === 'en' || option === 'es' ? option : null
