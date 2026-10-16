import { queryOptions } from '@tanstack/react-query'
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import Toaster from '@/components/shared/Toaster'
import type { User } from '@/lib/queries/users'
import { Users } from '@/pages/admin/Users'
import { renderWithProviders } from '@/test/render-with-providers'
import { useAuthStore } from '@/stores/authStore'

const DESKTOP_WIDTH = 1280
const DESKTOP_HEIGHT = 800
const TABLET_WIDTH = 768
const BODY_FONT = '400 14px "Inter Variable"'
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

const setViewer = (role: 'developer' | 'admin', userId: string) =>
  useAuthStore.setState({ status: 'authenticated', role, userId })

describe('Users password reset link', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // The fixtures are admin rows, so a developer viewer keeps these tests about the reset link.
    setViewer('developer', 'viewer-developer')
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

const VIEWER_ID = 'viewer-admin'
const PEER_REASON = "Only a developer can change another admin's account."
const DEVELOPER_REASON = 'Only a developer can change a developer account.'
const SELF_HELP = "You can't change your own role or deactivate your own account."
const MOBILE_WIDTH = 375

const peerAdmin: User = { ...baseUser, id: 'user-peer', name: 'Paula Peer', email: 'paula@example.com' }
const peerAdminInvitable: User = {
  ...peerAdmin,
  id: 'user-peer-new',
  name: 'Pedro Pending',
  email: 'pedro@example.com',
  has_password: false,
}
const developerRow: User = {
  ...baseUser,
  id: 'user-dev',
  name: 'Dana Dev',
  email: 'dana@example.com',
  role: 'developer',
  has_password: false,
}
const ownRow: User = { ...baseUser, id: VIEWER_ID, name: 'Olga Own', email: 'olga@example.com' }
const tutorRow: User = { ...baseUser, id: 'user-tutor', name: 'Tito Tutor', email: 'tito@example.com', role: 'tutor' }

const button = (name: string, label: string) => userRow(name).getByRole('button', { name: label })

describe('Users locked rows', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    setViewer('admin', VIEWER_ID)
    await page.viewport(DESKTOP_WIDTH, DESKTOP_HEIGHT)
  })

  it("disables reset and deactivate on another admin's row, with the reason, and fires nothing", async () => {
    await renderUsers([peerAdmin])

    for (const label of [RESET_LABEL, 'Deactivate']) {
      const locked = button(peerAdmin.name, label)
      await expect.element(locked).toHaveAttribute('aria-disabled', 'true')
      await expect.element(locked).toHaveAttribute('title', PEER_REASON)
      await expect.element(locked).toHaveAccessibleDescription(PEER_REASON)
      // force: Playwright otherwise waits forever for an aria-disabled button to become enabled.
      await locked.click({ force: true })
    }

    expect(usersApi.sendPasswordReset).not.toHaveBeenCalled()
    expect(page.getByRole('heading', { name: 'Deactivate user' }).elements()).toHaveLength(0)
    expect(page.getByRole('dialog').elements()).toHaveLength(0)
  })

  it("keeps invite working on another admin's row", async () => {
    usersApi.sendInvite.mockResolvedValue({ ...peerAdminInvitable, invite_expires_at: '2026-10-20T00:00:00Z' })
    await renderUsers([peerAdminInvitable])

    const invite = button(peerAdminInvitable.name, 'Send invite')
    await expect.element(invite).not.toHaveAttribute('aria-disabled', 'true')
    await invite.click()

    await expect.poll(() => usersApi.sendInvite.mock.calls.length).toBe(1)
    expect(usersApi.sendInvite.mock.calls[0][0]).toBe(peerAdminInvitable.id)
  })

  it('disables invite, reset and deactivate on a developer row', async () => {
    await renderUsers([{ ...developerRow, has_password: true, id: 'user-dev-pw', name: 'Dora Dev' }, developerRow])

    for (const name of ['Dora Dev', developerRow.name]) {
      for (const button of userRow(name).getByRole('button').elements()) {
        expect(button.getAttribute('aria-disabled')).toBe('true')
        expect(button.getAttribute('title')).toBe(DEVELOPER_REASON)
      }
    }
    await expect.element(button(developerRow.name, 'Send invite')).toHaveAccessibleDescription(DEVELOPER_REASON)
    expect(userRow(developerRow.name).getByRole('button').elements()).toHaveLength(2)
  })

  it('opens a peer admin row read-only with the reason and no Save', async () => {
    await renderUsers([peerAdmin])

    await userRow(peerAdmin.name).click()

    const dialog = page.getByRole('dialog')
    await expect.element(dialog.getByRole('heading', { name: 'View user' })).toBeVisible()
    await expect.element(dialog).toHaveAccessibleDescription(PEER_REASON)
    for (const label of ['Display name', 'Email', 'Role']) {
      await expect.element(dialog.getByLabelText(label)).toBeDisabled()
    }
    await expect.element(dialog.getByRole('checkbox', { name: 'Active' })).toBeDisabled()
    expect(dialog.getByRole('button', { name: 'Save' }).elements()).toHaveLength(0)

    await dialog.getByText('Close', { exact: true }).click()
    await expect.poll(() => page.getByRole('dialog').elements().length).toBe(0)
  })

  it('opens an inactive peer admin row read-only too', async () => {
    await renderUsers([{ ...peerAdmin, is_active: false }])

    await userRow(peerAdmin.name).click()

    await expect.element(page.getByRole('heading', { name: 'View user' })).toBeVisible()
    expect(page.getByRole('button', { name: 'Save' }).elements()).toHaveLength(0)
  })

  it('hides Deactivate on the own row and disables Role and Active in its form', async () => {
    usersApi.updateUser.mockResolvedValue(ownRow)
    await renderUsers([ownRow])

    await expect.element(button(ownRow.name, RESET_LABEL)).not.toHaveAttribute('aria-disabled', 'true')
    expect(userRow(ownRow.name).getByRole('button', { name: 'Deactivate' }).elements()).toHaveLength(0)

    await userRow(ownRow.name).click()

    const dialog = page.getByRole('dialog')
    await expect.element(dialog.getByRole('heading', { name: 'Edit user' })).toBeVisible()
    await expect.element(dialog.getByLabelText('Role')).toBeDisabled()
    await expect.element(dialog.getByLabelText('Role')).toHaveAccessibleDescription(SELF_HELP)
    await expect.element(dialog.getByRole('checkbox', { name: 'Active' })).toBeDisabled()
    await expect.element(dialog.getByRole('checkbox', { name: 'Active' })).toHaveAccessibleDescription(SELF_HELP)
    await expect.element(dialog.getByLabelText('Display name')).toBeEnabled()
    await dialog.getByLabelText('Display name').fill('Olga Renamed')
    await dialog.getByRole('button', { name: 'Save' }).click()

    await expect.poll(() => usersApi.updateUser.mock.calls.length).toBe(1)
    expect(usersApi.updateUser).toHaveBeenCalledWith(ownRow.id, {
      email: ownRow.email,
      name: 'Olga Renamed',
      role: 'admin',
      is_active: true,
    })
  })

  it('leaves tutor rows fully actionable for an admin viewer', async () => {
    await renderUsers([tutorRow])

    for (const label of [RESET_LABEL, 'Deactivate']) {
      await expect.element(button(tutorRow.name, label)).not.toHaveAttribute('aria-disabled', 'true')
    }
    await userRow(tutorRow.name).click()
    await expect.element(page.getByRole('heading', { name: 'Edit user' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Save' })).toBeVisible()
  })

  it('leaves every row fully actionable for a developer viewer', async () => {
    setViewer('developer', 'viewer-developer')
    await renderUsers([peerAdmin, developerRow])

    for (const label of [RESET_LABEL, 'Deactivate']) {
      await expect.element(button(peerAdmin.name, label)).not.toHaveAttribute('aria-disabled', 'true')
    }
    await expect.element(button(developerRow.name, 'Send invite')).not.toHaveAttribute('aria-disabled', 'true')
    await userRow(developerRow.name).click()
    await expect.element(page.getByRole('heading', { name: 'Edit user' })).toBeVisible()
    await expect.element(page.getByLabelText('Role')).toBeEnabled()
  })

  it('shows the reason line under the actions at 375px with no horizontal scroll', async () => {
    await page.viewport(MOBILE_WIDTH, DESKTOP_HEIGHT)
    await renderUsers([peerAdmin])

    await expect.element(page.getByRole('button', { name: 'Deactivate' }).first()).toBeVisible()
    await settleLayout()
    // DataTable renders the card and table layouts side by side and hides one with CSS.
    const visibleReasons = [...document.querySelectorAll(`#user-${peerAdmin.id}-locked-reason`)].filter(
      (line) => line.getBoundingClientRect().width > 0,
    )
    expect(visibleReasons).toHaveLength(1)
    expect(visibleReasons[0].textContent).toBe(PEER_REASON)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth)
  })
})
