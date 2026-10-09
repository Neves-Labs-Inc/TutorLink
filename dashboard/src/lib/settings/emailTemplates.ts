import type { Setting, SettingUpdate } from '@/lib/settings/settings'

export type TemplateSectionId = 'invite' | 'password_reset'
export type TemplateField = 'subject' | 'body'

export type TemplateSectionConfig = {
  id: TemplateSectionId
  title: string
  keys: Record<TemplateField, string>
  placeholders: readonly string[]
}

export type TemplateError = { field: TemplateField; message: string }

export type BrandColorPreset = { name: string; hex: string }

// The body of both the preview and the test-send requests.
export type EmailDraftPayload = {
  template: TemplateSectionId
  subject: string
  body: string
  brand_color: string
}

export const TEMPLATE_SECTIONS: readonly TemplateSectionConfig[] = [
  {
    id: 'invite',
    title: 'Invite',
    keys: { subject: 'email_invite_subject', body: 'email_invite_body' },
    placeholders: ['name', 'actor_name', 'link'],
  },
  {
    id: 'password_reset',
    title: 'Password reset',
    keys: { subject: 'email_reset_subject', body: 'email_reset_body' },
    placeholders: ['name', 'link'],
  },
]

export const EMAIL_TEMPLATE_KEYS: readonly string[] = TEMPLATE_SECTIONS.flatMap((section) => [
  section.keys.subject,
  section.keys.body,
])

export const BRAND_COLOR_KEY = 'email_brand_color'

// Every key the Email templates card owns, so the general Settings card skips them all.
const EMAIL_CARD_KEYS: readonly string[] = [...EMAIL_TEMPLATE_KEYS, BRAND_COLOR_KEY]

// Franklin's brand palette; all four are light, so the API picks the dark button label.
export const BRAND_COLOR_PRESETS: readonly BrandColorPreset[] = [
  { name: 'Turquoise', hex: '#74C8C9' },
  { name: 'Lavender', hex: '#CB9BC3' },
  { name: 'Beige/Gold', hex: '#D6B990' },
  { name: 'Olive', hex: '#C4BD82' },
]

// Same pattern and message as the API's `validate_brand_color`.
const BRAND_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/
const BRAND_COLOR_ERROR = 'Enter a colour like #74C8C9.'
const PREVIEW_BASE_TAG = '<base target="_blank">'
// `<head>` with or without attributes, but never `<header>`.
const HEAD_OPEN_TAG = /<head(\s[^>]*)?>/i
const DOCTYPE = /^\s*<!doctype[^>]*>/i

const MAX_SUBJECT_LENGTH = 200
const MAX_BODY_LENGTH = 5000
const REQUIRED_PLACEHOLDER = 'link'
const PLACEHOLDER_PATTERN = /\{([a-z_]+)\}/g

export const isEmailTemplateKey = (key: string): boolean => EMAIL_CARD_KEYS.includes(key)

export const emailTemplateSettings = (settings: Setting[]): Setting[] =>
  settings.filter((setting) => isEmailTemplateKey(setting.key))

// A partial set would let an Admin save half a template, so the card needs every key.
export const hasAllEmailTemplates = (settings: Setting[]): boolean =>
  EMAIL_CARD_KEYS.every((key) => settings.some((setting) => setting.key === key))

export const validateBrandColor = (value: string): string | null =>
  BRAND_COLOR_PATTERN.test(value) ? null : BRAND_COLOR_ERROR

// The API stores the colour uppercase, so comparisons and payloads use that form.
export const normalizeBrandColor = (value: string): string => value.toUpperCase()

export const isPresetSelected = (preset: BrandColorPreset, draftColor: string): boolean =>
  preset.hex === normalizeBrandColor(draftColor)

// Anything in braces that is not `[a-z_]+` is literal text, so it never matches here.
export const findPlaceholders = (text: string): string[] =>
  Array.from(text.matchAll(PLACEHOLDER_PATTERN), (match) => match[1])

// Counted in code points to match the server's character count.
const lengthOf = (text: string): number => Array.from(text).length

const isBlank = (text: string): boolean => text.trim() === ''

const unknownPlaceholderMessage = (section: TemplateSectionConfig, name: string): string => {
  const known = section.placeholders.map((placeholder) => `{${placeholder}}`)
  const list = `${known.slice(0, -1).join(', ')} or ${known[known.length - 1]}`

  return `Unknown placeholder {${name}}. Use ${list}.`
}

// Same rules, order and messages as the API; the first failure wins.
export const validateTemplate = (
  section: TemplateSectionConfig,
  subject: string,
  body: string,
): TemplateError | null => {
  if (isBlank(subject)) return { field: 'subject', message: "The subject can't be empty." }
  if (/[\r\n]/.test(subject)) return { field: 'subject', message: 'The subject must be a single line.' }
  if (lengthOf(subject) > MAX_SUBJECT_LENGTH) {
    return { field: 'subject', message: `The subject can be at most ${MAX_SUBJECT_LENGTH} characters.` }
  }
  if (isBlank(body)) return { field: 'body', message: "The body can't be empty." }
  if (lengthOf(body) > MAX_BODY_LENGTH) {
    return { field: 'body', message: `The body can be at most ${MAX_BODY_LENGTH} characters.` }
  }

  const unknown = [...findPlaceholders(subject), ...findPlaceholders(body)].find(
    (name) => !section.placeholders.includes(name),
  )
  if (unknown !== undefined) {
    return { field: 'body', message: unknownPlaceholderMessage(section, unknown) }
  }
  if (!findPlaceholders(body).includes(REQUIRED_PLACEHOLDER)) {
    return { field: 'body', message: `The body must include {${REQUIRED_PLACEHOLDER}}.` }
  }

  return null
}

export const savedTemplateValue = (settings: Setting[], key: string): string =>
  settings.find((setting) => setting.key === key)?.value ?? ''

// Templates go as typed, since line breaks in a body matter; the colour goes uppercase.
const outgoingValue = (key: string, value: string): string =>
  key === BRAND_COLOR_KEY ? normalizeBrandColor(value) : value

// Only changed keys, so a colour that differs only in case is not a change.
export const emailTemplateUpdates = (
  settings: Setting[],
  draft: Record<string, string>,
): SettingUpdate[] =>
  emailTemplateSettings(settings).flatMap((setting) => {
    const draftValue = draft[setting.key]
    if (draftValue === undefined) return []

    const value = outgoingValue(setting.key, draftValue)

    return value === setting.value ? [] : [{ key: setting.key, value }]
  })

// Any invalid section draft or an invalid draft colour blocks Save.
export const hasTemplateErrors = (settings: Setting[], draft: Record<string, string>): boolean => {
  const colour = draft[BRAND_COLOR_KEY] ?? savedTemplateValue(settings, BRAND_COLOR_KEY)
  const hasTemplateError = TEMPLATE_SECTIONS.some(
    (section) =>
      validateTemplate(
        section,
        draft[section.keys.subject] ?? savedTemplateValue(settings, section.keys.subject),
        draft[section.keys.body] ?? savedTemplateValue(settings, section.keys.body),
      ) !== null,
  )

  return hasTemplateError || validateBrandColor(colour) !== null
}

export const draftEmailPayload = (
  section: TemplateSectionConfig,
  subject: string,
  body: string,
  brandColor: string,
): EmailDraftPayload => ({
  template: section.id,
  subject,
  body,
  brand_color: normalizeBrandColor(brandColor),
})

// With `sandbox=""` and no `allow-popups`, a `_blank` link is blocked, so clicks in the preview
// go nowhere instead of loading the sample URL inside the frame. The tag goes inside `<head>`,
// or after the doctype, because anything before the doctype switches the page to quirks mode.
export const previewDocument = (html: string): string => {
  const doctype = html.match(DOCTYPE)?.[0] ?? ''

  return HEAD_OPEN_TAG.test(html)
    ? html.replace(HEAD_OPEN_TAG, (tag) => `${tag}${PREVIEW_BASE_TAG}`)
    : `${doctype}${PREVIEW_BASE_TAG}${html.slice(doctype.length)}`
}

// Falls back to a bare confirmation when `GET /api/me` has not loaded.
export const testEmailSentMessage = (email: string | undefined): string =>
  email === undefined ? 'Test email sent.' : `Test email sent to ${email}.`
