import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { Dialog } from 'radix-ui'

import { Button } from '@/components/ui/button'
import { dialogContentClasses, dialogOverlayClasses } from '@/lib/dialog/dialogClasses'

export type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  body: ReactNode
  confirmLabel: string
  onConfirm: () => void
  destructive?: boolean
  pending?: boolean
  // Disables only Confirm, so Cancel stays the way out.
  confirmDisabled?: boolean
  errorMessage?: string | null
}

const focusCancel = (event: Event) => {
  event.preventDefault()
  const content = event.currentTarget as HTMLElement
  content.querySelector<HTMLButtonElement>('[data-confirm-dialog-cancel]')?.focus()
}

export const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  destructive = false,
  pending = false,
  confirmDisabled = false,
  errorMessage = null,
}: ConfirmDialogProps) => {
  const triggerRef = useRef<HTMLElement | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Confirm had focus and stays disabled once pending ends, which leaves focus on <body>.
  useEffect(() => {
    if (open && confirmDisabled && !pending) {
      cancelRef.current?.focus()
    }
  }, [open, confirmDisabled, pending])

  useLayoutEffect(() => {
    if (open) {
      const active = document.activeElement

      triggerRef.current = active instanceof HTMLElement ? active : null
    }
  }, [open])

  const restoreTriggerFocus = (event: Event) => {
    event.preventDefault()
    triggerRef.current?.focus()
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClasses} />
        <Dialog.Content
          className={dialogContentClasses}
          onOpenAutoFocus={focusCancel}
          onCloseAutoFocus={restoreTriggerFocus}
        >
          <div className="space-y-1.5">
            <Dialog.Title className="font-heading text-lg font-semibold tracking-tight">
              {title}
            </Dialog.Title>
            <Dialog.Description asChild>
              <div className="text-sm text-muted-foreground">{body}</div>
            </Dialog.Description>
          </div>
          {errorMessage && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {errorMessage}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <Dialog.Close asChild>
              <Button
                ref={cancelRef}
                type="button"
                variant="outline"
                disabled={pending}
                data-confirm-dialog-cancel
              >
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              type="button"
              variant={destructive ? 'destructive' : 'default'}
              disabled={pending || confirmDisabled}
              onClick={onConfirm}
            >
              {pending ? 'Working…' : confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
