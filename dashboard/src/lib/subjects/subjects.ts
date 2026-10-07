export const SPANISH_NAME_FALLBACK = '— (English name used)'

export const spanishNameDisplay = (nameEs: string | null): string => nameEs ?? SPANISH_NAME_FALLBACK

// Blank means "use the English name", which the API stores as null.
export const spanishNameValue = (draft: string): string | null => {
  const trimmed = draft.trim()

  return trimmed === '' ? null : trimmed
}

const NAME_ES_PREFIX = /^name_es:\s*/
const NAME_ES_LABEL = 'Spanish name: '

// The API's detail starts with the raw field key; Staff see the field's label instead.
export const subjectErrorMessage = (detail: string | null): string | null =>
  detail === null ? null : detail.replace(NAME_ES_PREFIX, NAME_ES_LABEL)
