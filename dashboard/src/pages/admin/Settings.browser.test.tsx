/// <reference types="@vitest/browser-playwright" />
import { queryOptions } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { Settings } from '@/pages/admin/Settings'
import type { SettingsPage } from '@/lib/queries/settings'
import type { Setting } from '@/lib/settings/settings'
import { renderWithProviders } from '@/test/render-with-providers'
import { settleLayout } from '@/test/settleLayout'

const VIEWPORT_HEIGHT = 800
const DESKTOP_WIDTH = 1280
const WIDTHS = [375, 768, DESKTOP_WIDTH]
const LONG_KEY = 'a_very_long_setting_key_'.repeat(3).slice(0, 64)
const LONG_VALUE = 'x'.repeat(64)

const api = vi.hoisted(() => ({ getPage: vi.fn(), updateSettings: vi.fn() }))

vi.mock('@/lib/queries/settings', () => ({
  settingQueries: {
    page: () => queryOptions({ queryKey: ['settings', 'list'], queryFn: api.getPage }),
    emailPreview: () =>
      queryOptions({ queryKey: ['settings', 'email-preview'], queryFn: () => new Promise(() => {}) }),
  },
  updateSettings: api.updateSettings,
  sendTestEmail: vi.fn(),
}))

vi.mock('@/lib/queries/me', () => ({
  meQueries: {
    detail: () => queryOptions({ queryKey: ['me'], queryFn: () => new Promise(() => {}) }),
  },
}))

const setting = (key: string, value: string, valueType = 'string'): Setting => ({
  key,
  value,
  value_type: valueType,
  is_developer_only: false,
})

const PAGE: SettingsPage = {
  items: [
    setting(LONG_KEY, LONG_VALUE),
    setting('reminder_weekday', '1', 'integer'),
    setting('reminder_hour', '9', 'integer'),
    setting('business_timezone', LONG_VALUE),
    setting('reminder_template_sid_en', ''),
    setting('reminder_template_sid_es', ''),
    setting('email_invite_brand_color', '#74C8C9'),
    setting('email_reset_brand_color', '#CB9BC3'),
    setting('email_invite_subject', 'Welcome {name}'),
    setting('email_invite_body', 'Open {link}'),
    setting('email_reset_subject', 'Reset'),
    setting('email_reset_body', 'Open {link}'),
  ],
  total: 12,
  page: 1,
  page_size: 50,
  business_timezone_locked: true,
  reminders_paused: false,
}

const renderSettings = async () => {
  await renderWithProviders(
    <div className="px-4">
      <Settings />
    </div>,
  )
  await expect.element(page.getByText('Email templates').first()).toBeVisible()
  await settleLayout()
}

const inviteSection = () => page.getByRole('region', { name: 'Invite' })
const resetSection = () => page.getByRole('region', { name: 'Password reset' })
const hexField = () => inviteSection().getByLabelText('Button colour', { exact: true })
const resetHexField = () => resetSection().getByLabelText('Button colour', { exact: true })

describe('Settings page layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.getPage.mockResolvedValue(PAGE)
  })

  it.each(WIDTHS)('has no horizontal overflow at %ipx with 64-character keys and values', async (width) => {
    await page.viewport(width, VIEWPORT_HEIGHT)
    await renderSettings()

    const root = document.documentElement
    expect(root.scrollWidth).toBe(root.clientWidth)
    for (const card of document.querySelectorAll<HTMLElement>('[data-slot="card"]')) {
      expect(card.scrollWidth).toBe(card.clientWidth)
    }
  })
})

describe('Button colour fields', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await page.viewport(DESKTOP_WIDTH, VIEWPORT_HEIGHT)
    api.getPage.mockResolvedValue(PAGE)
    api.updateSettings.mockResolvedValue(PAGE)
  })

  it('cleans a pasted CSS declaration and sends the clean colour', async () => {
    await renderSettings()
    await hexField().click()
    // `fill` skips the input's maxLength, so that is checked on its own.
    expect((hexField().element() as HTMLInputElement).maxLength).toBeGreaterThanOrEqual('#74c9c9; '.length)
    await userEvent.fill(hexField(), '#74c9c9; ')

    await expect.element(hexField()).toHaveValue('#74c9c9')
    await expect.element(hexField()).toHaveAttribute('aria-invalid', 'false')
    expect(document.body.textContent).not.toContain('Enter a colour like')

    await userEvent.click(page.getByRole('button', { name: 'Save changes' }).last())
    await expect.poll(() => api.updateSettings.mock.calls[0]?.[0]).toEqual([
      { key: 'email_invite_brand_color', value: '#74C9C9' },
    ])
  })

  it('keeps the caret in place when typing lowercase in the middle of the value', async () => {
    await renderSettings()
    await hexField().click()
    const input = hexField().element() as HTMLInputElement
    input.setSelectionRange(3, 5)
    await userEvent.keyboard('ab')

    await userEvent.click(page.getByRole('button', { name: 'Save changes' }).last())
    await expect.poll(() => api.updateSettings.mock.calls[0]?.[0]).toEqual([
      { key: 'email_invite_brand_color', value: '#74ABC9' },
    ])
  })

  it('shows the colour error and blocks save for garbage', async () => {
    await renderSettings()
    await hexField().click()
    await userEvent.fill(hexField(), 'not a colour')

    await expect.element(hexField()).toHaveAttribute('aria-invalid', 'true')
    await expect.element(page.getByText('Enter a colour like #74C8C9.')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Save changes' }).last()).toBeDisabled()
  })

  it('shows one colour field per section and saves only the reset colour when it changes', async () => {
    await renderSettings()
    await expect.element(hexField()).toHaveValue('#74C8C9')
    await expect.element(resetHexField()).toHaveValue('#CB9BC3')

    await resetHexField().click()
    await userEvent.fill(resetHexField(), '#d6b990')
    await userEvent.click(page.getByRole('button', { name: 'Save changes' }).last())
    await expect.poll(() => api.updateSettings.mock.calls[0]?.[0]).toEqual([
      { key: 'email_reset_brand_color', value: '#D6B990' },
    ])
  })

  it('keeps the other section usable when one colour is invalid', async () => {
    await renderSettings()
    await resetHexField().click()
    await userEvent.fill(resetHexField(), '#74C8C')

    await expect.element(resetHexField()).toHaveAttribute('aria-invalid', 'true')
    await expect.element(hexField()).toHaveAttribute('aria-invalid', 'false')
    expect(document.body.textContent?.split('Enter a colour like').length).toBe(2)
    await expect
      .element(resetSection().getByRole('button', { name: 'Send test email to me' }))
      .toBeDisabled()
    await expect
      .element(inviteSection().getByRole('button', { name: 'Send test email to me' }))
      .toBeEnabled()
  })
})

describe('Subject placeholder error', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await page.viewport(DESKTOP_WIDTH, VIEWPORT_HEIGHT)
    api.getPage.mockResolvedValue(PAGE)
  })

  it('reports an unknown placeholder under Subject, not Body', async () => {
    await renderSettings()
    const subject = page.getByLabelText('Subject').first()
    await subject.click()
    await userEvent.fill(subject, 'Hi {oops}')

    await expect.element(subject).toHaveAttribute('aria-invalid', 'true')
    await expect.element(page.getByLabelText('Body').first()).toHaveAttribute('aria-invalid', 'false')
    await expect
      .element(page.getByText('Unknown placeholder {oops}. Use {name}, {actor_name} or {link}.'))
      .toBeVisible()
  })
})
