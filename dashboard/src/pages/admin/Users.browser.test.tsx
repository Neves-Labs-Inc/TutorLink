import { queryOptions } from '@tanstack/react-query'
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import Toaster from '@/components/shared/Toaster'
import type { User } from '@/lib/queries/users'
import { Users } from '@/pages/admin/Users'
import { renderWithProviders } from '@/test/render-with-providers'

const DESKTOP_WIDTH = 1280
const DESKTOP_HEIGHT = 800
const TABLET_WIDTH = 768
const BODY_FONT = '400 14px "Geist Variable"'
const RESET_LABEL = 'Send reset link'
const RESET_FALLBACK_ERROR = 'Could not send the reset email. Try again.'

const baseUser: User = {
  id: 'user-signed-in',
  email: 'rita@example.com',
  name: 'Rita Souza',
  role: 'admin',
  tutor_id: null,
  is_active: true,
  has_password: true,
  invite_expires_at: null,
}
const SIGNED_IN = baseUser
const NEVER_SIGNED_IN: User = {
  ...baseUser,
  id: 'user-no-password',
  email: 'new@example.com',
  name: 'Nina New',
  has_password: false,
}
const DEACTIVATED: User = {
  ...baseUser,
  id: 'user-deactivated',
  email: 'gone@example.com',
  name: 'Gil Gone',
  is_active: false,
}

const usersApi = vi.hoisted(() => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deactivateUser: vi.fn(),
  sendInvite: vi.fn(),
  sendPasswordReset: vi.fn(),
}))

vi.mock('@/lib/queries/users', () => ({
  userQueries: {
    list: (params: object) =>
      queryOptions({ queryKey: ['users', 'list', params], queryFn: usersApi.listUsers }),
  },
  createUser: usersApi.createUser,
  updateUser: usersApi.updateUser,
  deactivateUser: usersApi.deactivateUser,
  sendInvite: usersApi.sendInvite,
  sendPasswordReset: usersApi.sendPasswordReset,
}))

const LONG_EMAIL: User = {
  ...baseUser,
  id: 'user-long-email',
  email: 'maria.fernanda.lopez.gutierrez@example-tutoring-company.com',
  name: 'Carol Whitaker',
}

const listOf =(users: User[]) => ({ items: users, total: users.length, page: 1, page_size: 25 })

const apiError = (status: number, detail: string): AxiosError => {
  const response: AxiosResponse = {
    data: { detail },
    status,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
  }

  return new AxiosError(detail, String(status), undefined, undefined, response)
}

const renderUsers = (users: User[]) => {
  usersApi.listUsers.mockResolvedValue(listOf(users))

  return renderWithProviders(
    <>
      <Users />
      <Toaster />
    </>,
  )
}

// Widths are only final once the web font has loaded and a frame has laid out with it.
const settleLayout = async () => {
  await document.fonts.load(BODY_FONT)
  await document.fonts.ready
  await new Promise((settle) => requestAnimationFrame(settle))
}

const userRow =(name: string) => page.getByRole('row', { name: new RegExp(name) })
const resetButton = (name: string) => userRow(name).getByRole('button', { name: RESET_LABEL })

describe('Users password reset link', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await page.viewport(DESKTOP_WIDTH, DESKTOP_HEIGHT)
  })

  it('offers the reset link only to active users who have a password', async () => {
    await renderUsers([SIGNED_IN, NEVER_SIGNED_IN, DEACTIVATED])

    await expect.element(resetButton(SIGNED_IN.name)).toBeVisible()
    await expect.element(userRow(NEVER_SIGNED_IN.name).getByRole('button', { name: 'Send invite' })).toBeVisible()
    expect(page.getByRole('button', { name: RESET_LABEL }).elements()).toHaveLength(1)
  })

  it('sends the link and confirms with a toast without opening the edit form', async () => {
    usersApi.sendPasswordReset.mockResolvedValue(undefined)
    await renderUsers([SIGNED_IN])

    await resetButton(SIGNED_IN.name).click()

    await expect.element(page.getByText('Reset link sent to rita@example.com.')).toBeVisible()
    expect(usersApi.sendPasswordReset).toHaveBeenCalledWith(SIGNED_IN.id)
    expect(page.getByRole('heading', { name: 'Edit user' }).elements()).toHaveLength(0)
    expect(page.getByRole('alert').elements()).toHaveLength(0)
  })

  it('does not open the edit form when the button is pressed with Enter', async () => {
    usersApi.sendPasswordReset.mockResolvedValue(undefined)
    await renderUsers([SIGNED_IN])
    await expect.element(resetButton(SIGNED_IN.name)).toBeVisible()

    resetButton(SIGNED_IN.name).element().focus()
    await userEvent.keyboard('{Enter}')

    await expect.poll(() => usersApi.sendPasswordReset.mock.calls.length).toBe(1)
    expect(page.getByRole('heading', { name: 'Edit user' }).elements()).toHaveLength(0)
  })

  it('shows the pending state on the clicked row only', async () => {
    usersApi.sendPasswordReset.mockReturnValue(new Promise(() => {}))
    const other: User = { ...SIGNED_IN, id: 'user-other', name: 'Otto Other', email: 'otto@example.com' }
    await renderUsers([SIGNED_IN, other])

    await resetButton(SIGNED_IN.name).click()

    const pending = userRow(SIGNED_IN.name).getByRole('button', { name: 'Sending…' })
    await expect.element(pending).toHaveAttribute('aria-disabled', 'true')
    await expect.element(pending).toHaveAttribute('aria-busy', 'true')
    await expect.element(resetButton(other.name)).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('keeps keyboard focus on the button and ignores repeat presses while sending', async () => {
    usersApi.sendPasswordReset.mockReturnValue(new Promise(() => {}))
    await renderUsers([SIGNED_IN])
    await expect.element(resetButton(SIGNED_IN.name)).toBeVisible()

    resetButton(SIGNED_IN.name).element().focus()
    await userEvent.keyboard('{Enter}')
    const pending = userRow(SIGNED_IN.name).getByRole('button', { name: 'Sending…' })
    await expect.element(pending).toBeVisible()
    await userEvent.keyboard('{Enter}')

    expect(document.activeElement).toBe(pending.element())
    expect(usersApi.sendPasswordReset).toHaveBeenCalledTimes(1)
  })

  it('fits the table inside its card at 768px beside the sidebar', async () => {
    await page.viewport(TABLET_WIDTH, DESKTOP_HEIGHT)
    // Manager is the widest role label, so this is the tightest the table gets.
    const managers = [SIGNED_IN, NEVER_SIGNED_IN, LONG_EMAIL].map((user) => ({
      ...user,
      role: 'manager' as const,
    }))
    usersApi.listUsers.mockResolvedValue(listOf(managers))
    // Mirrors AppShell at md: the w-64 sidebar plus main's sm:px-6 padding.
    await renderWithProviders(
      <div className="flex">
        <div className="w-64 shrink-0 border-r" />
        <main className="min-w-0 flex-1 px-6">
          <Users />
        </main>
      </div>,
    )
    await expect.element(resetButton(SIGNED_IN.name)).toBeVisible()
    await settleLayout()

    const scroller = page.getByRole('table').element().parentElement as HTMLElement
    expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth)
  })

  it('shows the API detail inline when the send is refused', async () => {
    usersApi.sendPasswordReset.mockRejectedValue(
      apiError(409, 'Deactivated users cannot be sent a reset link'),
    )
    await renderUsers([SIGNED_IN])

    await resetButton(SIGNED_IN.name).click()

    await expect
      .element(userRow(SIGNED_IN.name).getByRole('alert'))
      .toHaveTextContent('Deactivated users cannot be sent a reset link')
    await expect.element(resetButton(SIGNED_IN.name)).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('falls back to a generic message when the failure carries no detail', async () => {
    usersApi.sendPasswordReset.mockRejectedValue(new Error('network down'))
    await renderUsers([SIGNED_IN])

    await resetButton(SIGNED_IN.name).click()

    await expect.element(userRow(SIGNED_IN.name).getByRole('alert')).toHaveTextContent(RESET_FALLBACK_ERROR)
  })
})
