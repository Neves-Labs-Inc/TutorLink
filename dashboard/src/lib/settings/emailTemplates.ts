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

const MAX_SUBJECT_LENGTH = 200
const MAX_BODY_LENGTH = 5000
const REQUIRED_PLACEHOLDER = 'link'
const PLACEHOLDER_PATTERN = /\{([a-z_]+)\}/g

export const isEmailTemplateKey = (key: string): boolean => EMAIL_TEMPLATE_KEYS.includes(key)

export const emailTemplateSettings = (settings: Setting[]): Setting[] =>
  settings.filter((setting) => isEmailTemplateKey(setting.key))

// A partial set would let an Admin save half a template, so the card needs all four.
export const hasAllEmailTemplates = (settings: Setting[]): boolean =>
  EMAIL_TEMPLATE_KEYS.every((key) => settings.some((setting) => setting.key === key))

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

export const previewSampleValues = (origin: string): Record<string, string> => ({
  name: 'Alex Smith',
  actor_name: 'Your Admin',
  link: `${origin}/set-password?token=example`,
})

// Unknown placeholders stay literal so a typo is visible. A blank result is '' (the card shows a dash).
// Only the section's own placeholders are replaced, like the server.
export const renderPreview = (
  section: TemplateSectionConfig,
  text: string,
  values: Record<string, string>,
): string => {
  const rendered = text.replace(PLACEHOLDER_PATTERN, (whole, name: string) =>
    section.placeholders.includes(name) ? (values[name] ?? whole) : whole,
  )

  return isBlank(rendered) ? '' : rendered
}

export const savedTemplateValue = (settings: Setting[], key: string): string =>
  settings.find((setting) => setting.key === key)?.value ?? ''

// Only changed template keys; values go as typed, since line breaks in a body matter.
export const emailTemplateUpdates = (
  settings: Setting[],
  draft: Record<string, string>,
): SettingUpdate[] =>
  emailTemplateSettings(settings).flatMap((setting) => {
    const draftValue = draft[setting.key]

    return draftValue === undefined || draftValue === setting.value
      ? []
      : [{ key: setting.key, value: draftValue }]
  })

export const hasTemplateErrors = (settings: Setting[], draft: Record<string, string>): boolean =>
  TEMPLATE_SECTIONS.some(
    (section) =>
      validateTemplate(
        section,
        draft[section.keys.subject] ?? savedTemplateValue(settings, section.keys.subject),
        draft[section.keys.body] ?? savedTemplateValue(settings, section.keys.body),
      ) !== null,
  )
