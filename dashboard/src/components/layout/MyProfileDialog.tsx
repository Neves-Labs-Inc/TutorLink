import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { Dialog } from 'radix-ui'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useMyProfile } from '@/hooks/useMyProfile'
import { errorDetail } from '@/lib/api'
import { dialogContentClasses, dialogOverlayClasses } from '@/lib/dialog/dialogClasses'
import { displayNameError } from '@/lib/users/users'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'

type MyProfileDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Where focus lands on close when the trigger is hidden by then (the Staff mobile drawer).
  fallbackFocusRef?: RefObject<HTMLElement | null>
}

type ProfileContentProps = {
  onClose: () => void
  onCloseAutoFocus: (event: Event) => void
}

const INPUT_ID = 'profile-display-name'
const ERROR_ID = 'profile-display-name-error'
const STAFF_DESCRIPTION = 'Guardians and other Staff see your Display name in chats.'
// Tutors don't chat with Guardians, so the Staff line would be wrong for them.
const TUTOR_DESCRIPTION = 'The office sees your Display name instead of your email.'
const LOAD_FALLBACK_ERROR = 'Could not load your profile. Please try again.'
const SAVE_FALLBACK_ERROR = 'Could not save your Display name. Please try again.'

const skeletonBarClasses = 'animate-pulse rounded-lg bg-muted motion-reduce:animate-none'
const controlHeightClasses = 'h-11 md:h-8'
const errorTextClasses = 'text-sm font-medium text-destructive'

const isVisible = (element: HTMLElement): boolean =>
  element.isConnected &&
  (!('checkVisibility' in element) || element.checkVisibility({ visibilityProperty: true }))

export const MyProfileDialog = ({ open, onOpenChange, fallbackFocusRef }: MyProfileDialogProps) => {
  const triggerRef = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    if (open) {
      const active = document.activeElement

      triggerRef.current = active instanceof HTMLElement ? active : null
    }
  }, [open])

  const restoreTriggerFocus = (event: Event) => {
    event.preventDefault()
    const trigger = triggerRef.current
    const target = trigger !== null && isVisible(trigger) ? trigger : (fallbackFocusRef?.current ?? null)

    target?.focus()
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClasses} />
        <ProfileContent onClose={() => onOpenChange(false)} onCloseAutoFocus={restoreTriggerFocus} />
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// Mounted only while the dialog is open, so every open starts from the saved name with a fresh
// save state: Cancel and Escape discard the draft simply by unmounting it.
const ProfileContent = ({ onClose, onCloseAutoFocus }: ProfileContentProps) => {
  const role = useAuthStore((state) => state.role)
  const { me, save } = useMyProfile()
  // null until the first edit: the field shows the saved name and validation stays quiet.
  const [draft, setDraft] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Set by "Try again": the button that held focus unmounts once the load succeeds.
  const isRetryingRef = useRef(false)

  useEffect(() => {
    if (me.isSuccess && isRetryingRef.current) {
      isRetryingRef.current = false
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [me.isSuccess])

  const handleRetry = () => {
    isRetryingRef.current = true
    me.refetch()
  }

  const savedName = me.data?.display_name ?? ''
  const value = draft ?? savedName
  const validationError = draft === null ? null : displayNameError(draft)
  const isUnchanged = value.trim() === savedName
  const canSave = me.isSuccess && validationError === null && !isUnchanged && !save.isPending

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!canSave) return

    save.mutate({ display_name: value.trim() }, { onSuccess: onClose })
  }

  const focusField = (event: Event) => {
    event.preventDefault()
    const content = event.currentTarget as HTMLElement
    const input = content.querySelector<HTMLInputElement>(`#${INPUT_ID}`)

    if (input === null) {
      content.querySelector<HTMLButtonElement>('[data-profile-cancel]')?.focus()
    } else {
      input.focus()
      input.select()
    }
  }

  // Escape and an overlay click are ignored mid-save, so the request never outlives its dialog.
  const blockWhileSaving = (event: Event) => {
    if (save.isPending) event.preventDefault()
  }

  let field = (
    <div aria-busy="true" className="space-y-1.5">
      <span className="sr-only">Loading your profile…</span>
      <div className={cn('h-3.5 w-24', skeletonBarClasses)} />
      <div className={cn('w-full', controlHeightClasses, skeletonBarClasses)} />
    </div>
  )

  if (me.isError) {
    field = (
      <div className="space-y-3">
        <p role="alert" className={errorTextClasses}>
          {errorDetail(me.error) ?? LOAD_FALLBACK_ERROR}
        </p>
        <Button type="button" variant="outline" className={controlHeightClasses} onClick={handleRetry}>
          Try again
        </Button>
      </div>
    )
  } else if (me.isSuccess) {
    field = (
      <div className="space-y-1.5">
        <Label htmlFor={INPUT_ID}>Display name</Label>
        <Input
          ref={inputRef}
          id={INPUT_ID}
          autoComplete="name"
          className={controlHeightClasses}
          value={value}
          disabled={save.isPending}
          aria-invalid={validationError !== null}
          aria-describedby={validationError === null ? undefined : ERROR_ID}
          onChange={(event) => setDraft(event.target.value)}
        />
        {validationError !== null && (
          <p id={ERROR_ID} role="alert" className={errorTextClasses}>
            {validationError}
          </p>
        )}
      </div>
    )
  }

  return (
    <Dialog.Content
      className={cn(dialogContentClasses, 'data-[state=closed]:duration-150 data-[state=open]:duration-200')}
      onOpenAutoFocus={focusField}
      onCloseAutoFocus={onCloseAutoFocus}
      onEscapeKeyDown={blockWhileSaving}
      onInteractOutside={blockWhileSaving}
    >
      <div className="space-y-1.5">
        <Dialog.Title className="font-heading text-lg font-semibold tracking-tight">My profile</Dialog.Title>
        <Dialog.Description className="text-sm text-muted-foreground">
          {role === 'tutor' ? TUTOR_DESCRIPTION : STAFF_DESCRIPTION}
        </Dialog.Description>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {field}
        <div className="flex gap-3 sm:justify-end">
          <Dialog.Close asChild>
            <Button
              type="button"
              variant="outline"
              className="h-11 flex-1 sm:flex-none md:h-8"
              disabled={save.isPending}
              data-profile-cancel
            >
              Cancel
            </Button>
          </Dialog.Close>
          <Button type="submit" className="h-11 flex-1 sm:flex-none md:h-8" disabled={!canSave}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
        {save.isError && (
          <p role="alert" className={errorTextClasses}>
            {errorDetail(save.error) ?? SAVE_FALLBACK_ERROR}
          </p>
        )}
      </form>
    </Dialog.Content>
  )
}
