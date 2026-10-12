import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Dialog } from 'radix-ui'
import { X } from 'lucide-react'

import { isOpenCombobox } from '@/lib/dialog/openCombobox'
import { cn } from '@/lib/utils'

export type SlideOverProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
}

const overlayClasses = cn(
  'fixed inset-0 z-40 bg-black/60',
  'data-[state=open]:animate-in data-[state=closed]:animate-out',
  'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
  'motion-reduce:animate-none',
)

const contentClasses = cn(
  'fixed inset-0 z-50 flex w-full max-w-none flex-col overflow-hidden bg-card outline-none',
  'sm:inset-y-0 sm:right-0 sm:left-auto sm:h-full sm:w-full sm:max-w-md sm:border-l sm:border-border',
  'data-[state=open]:animate-in data-[state=closed]:animate-out',
  'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
  'data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
  'motion-reduce:animate-none',
)

// 44px touch target on phones; the negative margins keep the glyph where the old 32px
// button had it, level with a one-line title.
const closeButtonClasses = cn(
  'inline-flex size-11 -mt-1.5 -mr-1.5 shrink-0 items-center justify-center rounded-lg text-muted-foreground',
  'transition-colors duration-150 ease-out motion-reduce:transition-none',
  'hover:bg-muted hover:text-foreground active:translate-y-px',
  'focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
  'md:mt-0 md:mr-0 md:size-8',
)

export const SlideOver = ({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: SlideOverProps) => {
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

  // Radix hears Escape on the document before the focused control does, so an open
  // combobox list would otherwise take the whole dialog down with it.
  const keepOpenWhileListOpen = (event: KeyboardEvent) => {
    const target = event.target instanceof Element ? event.target : null

    if (isOpenCombobox(target)) event.preventDefault()
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlayClasses} />
        <Dialog.Content
          className={contentClasses}
          onCloseAutoFocus={restoreTriggerFocus}
          onEscapeKeyDown={keepOpenWhileListOpen}
        >
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div className="space-y-1">
              <Dialog.Title className="font-heading text-lg font-semibold tracking-tight">
                {title}
              </Dialog.Title>
              {description && (
                <Dialog.Description className="text-sm text-muted-foreground">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close type="button" aria-label="Close" className={closeButtonClasses}>
              <X aria-hidden="true" className="size-4" />
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
          {footer && <div className="border-t border-border px-4 py-3">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
