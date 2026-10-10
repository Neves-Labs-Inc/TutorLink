import { useEffect, useRef } from 'react'
import type { MutationStatus } from '@tanstack/react-query'

import { focusTarget, type FocusOutcome } from '@/lib/settings/focusTarget'

type Options = {
  status: MutationStatus
  isSaveEnabled: boolean
  // Null when the card has no editable field to land on.
  firstFieldId: string | null
}

// Keeps keyboard focus inside a Settings card after Save and Discard instead of dropping it to the body.
export const useSettingsFocus = ({ status, isSaveEnabled, firstFieldId }: Options) => {
  const saveRef = useRef<HTMLButtonElement>(null)
  const savedRef = useRef<HTMLSpanElement>(null)
  const previousStatus = useRef(status)
  const pendingOutcome = useRef<FocusOutcome | null>(null)

  // Runs after every render: "Saved." and the re-enabled fields only exist once the state update has rendered.
  useEffect(() => {
    if (previousStatus.current === 'pending' && status === 'success') pendingOutcome.current = 'saved'
    if (previousStatus.current === 'pending' && status === 'error') pendingOutcome.current = 'save-failed'
    if (status === 'pending') pendingOutcome.current = null
    previousStatus.current = status

    if (pendingOutcome.current === null) return
    const kind = focusTarget(pendingOutcome.current, isSaveEnabled)
    const target =
      kind === 'saved-message'
        ? savedRef.current
        : kind === 'save-button'
          ? saveRef.current
          : firstFieldId === null
            ? null
            : document.getElementById(firstFieldId)
    if (target === null) return

    target.focus()
    pendingOutcome.current = null
  })

  return {
    saveRef,
    savedRef,
    // Enter in a field disables the fields while saving, which would blur it; Save keeps focus instead.
    focusSave: () => saveRef.current?.focus(),
    markDiscarded: () => {
      pendingOutcome.current = 'discarded'
    },
  }
}
