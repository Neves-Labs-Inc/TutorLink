import { describe, expect, it } from 'vitest'
import type { Setting } from './settings'
import {
  BRAND_COLOR_PRESETS,
  EMAIL_TEMPLATE_KEYS,
  TEMPLATE_SECTIONS,
  draftEmailPayload,
  emailTemplateSettings,
  emailTemplateUpdates,
  findPlaceholders,
  hasAllEmailTemplates,
  hasTemplateErrors,
  isPresetSelected,
  normalizeBrandColor,
  previewDocument,
  testEmailSentMessage,
  validateBrandColor,
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
  setting('email_brand_color', '#74C8C9'),
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

describe('key filtering', () => {
  const all = [setting('some_limit', '5'), setting('reminder_hour', '9'), ...savedTemplates()]

  it('keeps the four template keys and the brand colour', () => {
    expect(emailTemplateSettings(all).map((item) => item.key)).toEqual([
      ...EMAIL_TEMPLATE_KEYS,
      'email_brand_color',
    ])
  })

  it('removes them from the general settings', () => {
    expect(generalSettings(all).map((item) => item.key)).toEqual(['some_limit'])
  })

  it('knows when a key is missing', () => {
    expect(hasAllEmailTemplates(all)).toBe(true)
    expect(hasAllEmailTemplates(all.filter((item) => item.key !== 'email_reset_body'))).toBe(false)
    expect(hasAllEmailTemplates(all.filter((item) => item.key !== 'email_brand_color'))).toBe(false)
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

  it('sends a changed brand colour uppercase alongside template changes', () => {
    const draft = { email_brand_color: '#cb9bc3', email_reset_subject: 'New' }

    expect(emailTemplateUpdates(savedTemplates(), draft)).toEqual([
      { key: 'email_reset_subject', value: 'New' },
      { key: 'email_brand_color', value: '#CB9BC3' },
    ])
  })

  it('treats a colour that differs only in case as unchanged', () => {
    expect(emailTemplateUpdates(savedTemplates(), { email_brand_color: '#74c8c9' })).toEqual([])
  })
})

describe('hasTemplateErrors', () => {
  it('is false for the saved values', () => {
    expect(hasTemplateErrors(savedTemplates(), {})).toBe(false)
  })

  it('is true when any section draft is invalid', () => {
    expect(hasTemplateErrors(savedTemplates(), { email_reset_body: 'no link' })).toBe(true)
  })

  it('is true when the draft colour is invalid', () => {
    expect(hasTemplateErrors(savedTemplates(), { email_brand_color: '#74C8C' })).toBe(true)
  })
})

describe('testEmailSentMessage', () => {
  it('names the signed-in email when it is known', () => {
    expect(testEmailSentMessage('ana@example.com')).toBe('Test email sent to ana@example.com.')
  })

  it('drops the address when the signed-in user is not loaded', () => {
    expect(testEmailSentMessage(undefined)).toBe('Test email sent.')
  })
})

describe('validateBrandColor', () => {
  it.each(['#74C8C9', '#74c8c9', '#000000', '#aBcDeF'])('accepts %s', (value) => {
    expect(validateBrandColor(value)).toBeNull()
  })

  it.each(['', '74C8C9', '#74C8C', '#74C8C9F', '#GGGGGG', ' #74C8C9', '#74C8C9 ', '#fff', 'red'])(
    'rejects %j with the API message',
    (value) => {
      expect(validateBrandColor(value)).toBe('Enter a colour like #74C8C9.')
    },
  )
})

describe('normalizeBrandColor', () => {
  it('uppercases the hex', () => {
    expect(normalizeBrandColor('#cb9bc3')).toBe('#CB9BC3')
  })
})

describe('BRAND_COLOR_PRESETS', () => {
  it('offers the four palette colours in order', () => {
    expect(BRAND_COLOR_PRESETS).toEqual([
      { name: 'Turquoise', hex: '#74C8C9' },
      { name: 'Lavender', hex: '#CB9BC3' },
      { name: 'Beige/Gold', hex: '#D6B990' },
      { name: 'Olive', hex: '#C4BD82' },
    ])
  })
})

describe('isPresetSelected', () => {
  const [turquoise] = BRAND_COLOR_PRESETS

  it('matches the draft whatever its case', () => {
    expect(isPresetSelected(turquoise, '#74c8c9')).toBe(true)
  })

  it('does not match another colour', () => {
    expect(isPresetSelected(turquoise, '#CB9BC3')).toBe(false)
  })
})

describe('draftEmailPayload', () => {
  it('sends the draft as typed with the colour uppercase', () => {
    expect(draftEmailPayload(reset, 'Reset {name}', 'Go\n{link}\n', '#d6b990')).toEqual({
      template: 'password_reset',
      subject: 'Reset {name}',
      body: 'Go\n{link}\n',
      brand_color: '#D6B990',
    })
  })
})

describe('previewDocument', () => {
  it('makes links open a new context, which the sandbox then blocks', () => {
    expect(previewDocument('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>')).toBe(
      '<!doctype html><html><head><base target="_blank"><meta charset="utf-8"></head><body></body></html>',
    )
  })

  it('keeps head attributes and never inserts before the doctype', () => {
    expect(previewDocument('<!DOCTYPE html><HEAD lang="en"><title>x</title></HEAD>')).toBe(
      '<!DOCTYPE html><HEAD lang="en"><base target="_blank"><title>x</title></HEAD>',
    )
  })

  it('does not mistake a header element for the head', () => {
    expect(previewDocument('<!doctype html><header>x</header>')).toBe(
      '<!doctype html><base target="_blank"><header>x</header>',
    )
  })
})
