import { describe, expect, it } from 'vitest'
import type { Setting } from './settings'
import {
  EMAIL_TEMPLATE_KEYS,
  TEMPLATE_SECTIONS,
  emailTemplateSettings,
  emailTemplateUpdates,
  findPlaceholders,
  hasAllEmailTemplates,
  hasTemplateErrors,
  previewSampleValues,
  renderPreview,
  validateTemplate,
} from './emailTemplates'
import { generalSettings } from './reminders'

const [invite, reset] = TEMPLATE_SECTIONS

const setting = (key: string, value: string): Setting => ({
  key,
  value,
  value_type: 'string',
  is_developer_only: false,
})

const savedTemplates = (): Setting[] => [
  setting('email_invite_subject', 'Welcome {name}'),
  setting('email_invite_body', 'Hi {name}, go to {link}'),
  setting('email_reset_subject', 'Reset'),
  setting('email_reset_body', 'Go to {link}'),
]

describe('findPlaceholders', () => {
  it('finds lowercase and underscore names', () => {
    expect(findPlaceholders('Hi {name}, {actor_name} sent {link}')).toEqual(['name', 'actor_name', 'link'])
  })

  it.each(['{}', '{ name }', '{Name}', '{na-me}', '{1}', '{{', 'a } b { c'])(
    'treats %s as literal text',
    (text) => {
      expect(findPlaceholders(text)).toEqual([])
    },
  )
})

describe('validateTemplate', () => {
  const body = 'Open {link}'

  it.each([
    ['', body, 'subject', "The subject can't be empty."],
    ['   ', body, 'subject', "The subject can't be empty."],
    ['two\nlines', body, 'subject', 'The subject must be a single line.'],
    ['two\rlines', body, 'subject', 'The subject must be a single line.'],
    ['a'.repeat(201), body, 'subject', 'The subject can be at most 200 characters.'],
    ['Hello', '', 'body', "The body can't be empty."],
    ['Hello', ' \n ', 'body', "The body can't be empty."],
    ['Hello', `${'a'.repeat(5000)}{link}`, 'body', 'The body can be at most 5000 characters.'],
    ['Hello', 'Open {link} {nmae}', 'body', 'Unknown placeholder {nmae}. Use {name}, {actor_name} or {link}.'],
    ['Hi {oops}', body, 'body', 'Unknown placeholder {oops}. Use {name}, {actor_name} or {link}.'],
    ['Hello', 'No link here', 'body', 'The body must include {link}.'],
  ])('invite: subject %j body %j fails with the message', (subject, text, field, message) => {
    expect(validateTemplate(invite, subject, text)).toEqual({ field, message })
  })

  it('lists only name and link for password reset', () => {
    expect(validateTemplate(reset, 'Hello', 'Open {link} {actor_name}')).toEqual({
      field: 'body',
      message: 'Unknown placeholder {actor_name}. Use {name} or {link}.',
    })
  })

  it('reports the first failing rule in order', () => {
    expect(validateTemplate(invite, '', '')?.message).toBe("The subject can't be empty.")
    expect(validateTemplate(invite, 'ok', 'x'.repeat(5001))?.message).toBe(
      'The body can be at most 5000 characters.',
    )
  })

  it('counts characters, not UTF-16 units', () => {
    expect(validateTemplate(invite, '😀'.repeat(200), body)).toBeNull()
  })

  it('allows known placeholders in the subject and literal braces anywhere', () => {
    expect(validateTemplate(invite, '{actor_name} {X} { y }', 'Use {} and {link}')).toBeNull()
  })
})

describe('renderPreview', () => {
  const values = previewSampleValues('https://app.test')

  it('uses the sample values', () => {
    expect(renderPreview(invite, 'Hi {name} from {actor_name}: {link}', values)).toBe(
      'Hi Alex Smith from Your Admin: https://app.test/set-password?token=example',
    )
  })

  it('leaves unknown placeholders and literal braces as typed', () => {
    expect(renderPreview(invite, '{nmae} { x }', values)).toBe('{nmae} { x }')
  })

  it("does not substitute another section's placeholder", () => {
    expect(renderPreview(reset, 'Hi {actor_name}, {name}', values)).toBe('Hi {actor_name}, Alex Smith')
  })

  it('returns an empty string for blank text', () => {
    expect(renderPreview(invite, '  \n ', values)).toBe('')
  })
})

describe('key filtering', () => {
  const all = [setting('some_limit', '5'), setting('reminder_hour', '9'), ...savedTemplates()]

  it('keeps only the four template keys', () => {
    expect(emailTemplateSettings(all).map((item) => item.key)).toEqual([...EMAIL_TEMPLATE_KEYS])
  })

  it('removes them from the general settings', () => {
    expect(generalSettings(all).map((item) => item.key)).toEqual(['some_limit'])
  })

  it('knows when a key is missing', () => {
    expect(hasAllEmailTemplates(all)).toBe(true)
    expect(hasAllEmailTemplates(all.filter((item) => item.key !== 'email_reset_body'))).toBe(false)
  })
})

describe('emailTemplateUpdates', () => {
  it('sends only changed keys, unmodified', () => {
    const draft = { email_invite_body: 'Hi\n{link}\n', email_reset_subject: 'Reset' }

    expect(emailTemplateUpdates(savedTemplates(), draft)).toEqual([
      { key: 'email_invite_body', value: 'Hi\n{link}\n' },
    ])
  })

  it('ignores draft keys that are not template keys', () => {
    expect(emailTemplateUpdates(savedTemplates(), { reminder_hour: '5' })).toEqual([])
  })
})

describe('hasTemplateErrors', () => {
  it('is false for the saved values', () => {
    expect(hasTemplateErrors(savedTemplates(), {})).toBe(false)
  })

  it('is true when any section draft is invalid', () => {
    expect(hasTemplateErrors(savedTemplates(), { email_reset_body: 'no link' })).toBe(true)
  })
})
