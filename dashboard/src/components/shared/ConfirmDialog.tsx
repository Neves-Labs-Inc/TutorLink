import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Dialog } from 'radix-ui'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  body: ReactNode
  confirmLabel: string
  onConfirm: () => void
  destructive?: boolean
  pending?: boolean
  errorMessage?: string | null
}

const overlayClasses = cn(
  'fixed inset-0 z-50 bg-black/60',
  'data-[state=open]:animate-in data-[state=closed]:animate-out',
  'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
  'motion-reduce:animate-none',
)

const contentClasses = cn(
  'fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2',
  'space-y-4 rounded-lg border border-border bg-card p-5 outline-none',
  'data-[state=open]:animate-in data-[state=closed]:animate-out',
  'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
  'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
  'motion-reduce:animate-none',
)

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
  errorMessage = null,
}: ConfirmDialogProps) => {
  const triggerRef = useRef<HTMLElement | null>(null)

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
        <Dialog.Overlay className={overlayClasses} />
        <Dialog.Content
          className={contentClasses}
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
              <Button type="button" variant="outline" disabled={pending} data-confirm-dialog-cancel>
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              type="button"
              variant={destructive ? 'destructive' : 'default'}
              disabled={pending}
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
