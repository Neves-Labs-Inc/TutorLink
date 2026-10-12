import { useState, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'

const DESKTOP_WIDTH = 1280
const DESKTOP_HEIGHT = 800
// A point on the overlay, well outside the centred max-w-sm dialog.
const OVERLAY_POINT = { x: 20, y: 20 }

type HarnessProps = {
  pending: boolean
  onConfirm?: () => void
  onOpenChange?: (open: boolean) => void
}

function Harness({ pending, onConfirm = () => {}, onOpenChange = () => {} }: HarnessProps): ReactNode {
  const [open, setOpen] = useState(true)

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen)
    setOpen(nextOpen)
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Deactivate subject"
      body="It will no longer be available."
      confirmLabel="Deactivate"
      onConfirm={onConfirm}
      destructive
      pending={pending}
    />
  )
}

const dialog = () => page.getByRole('dialog', { name: 'Deactivate subject' })
const workingButton = () => page.getByRole('button', { name: 'Working…' })

async function clickOverlay(): Promise<void> {
  const overlay = document.elementFromPoint(OVERLAY_POINT.x, OVERLAY_POINT.y)

  if (!(overlay instanceof HTMLElement)) throw new Error('No overlay at the click point')
  await userEvent.click(overlay, { position: OVERLAY_POINT })
}

describe('ConfirmDialog while pending', () => {
  beforeEach(async () => {
    await page.viewport(DESKTOP_WIDTH, DESKTOP_HEIGHT)
  })

  it('stays open on Esc and an overlay click, then closes on Esc once settled', async () => {
    const onOpenChange = vi.fn()
    const screen = await render(<Harness pending onOpenChange={onOpenChange} />)
    await expect.element(dialog()).toBeVisible()

    await userEvent.keyboard('{Escape}')
    expect(onOpenChange).not.toHaveBeenCalled()
    await clickOverlay()
    expect(onOpenChange).not.toHaveBeenCalled()
    await expect.element(dialog()).toHaveAttribute('data-state', 'open')

    await screen.rerender(<Harness pending={false} onOpenChange={onOpenChange} />)
    await userEvent.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
    await expect.element(dialog()).not.toBeInTheDocument()
  })

  it('keeps focus on an aria-disabled Confirm that ignores presses', async () => {
    const onConfirm = vi.fn()
    const screen = await render(<Harness pending={false} onConfirm={onConfirm} />)
    await userEvent.click(page.getByRole('button', { name: 'Deactivate' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)

    await screen.rerender(<Harness pending onConfirm={onConfirm} />)
    await expect.element(workingButton()).toHaveAttribute('aria-disabled', 'true')
    await expect.element(workingButton()).not.toHaveAttribute('disabled')
    await expect.element(workingButton()).toHaveFocus()
    await expect.element(page.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    await userEvent.keyboard('{Enter}')
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('keeps focus on Confirm when the overlay is clicked mid-request', async () => {
    const screen = await render(<Harness pending={false} />)
    await userEvent.click(page.getByRole('button', { name: 'Deactivate' }))
    await screen.rerender(<Harness pending />)
    await expect.element(workingButton()).toHaveFocus()

    await clickOverlay()

    await expect.element(dialog()).toHaveAttribute('data-state', 'open')
    expect(document.activeElement).toBe(workingButton().element())
  })
})
