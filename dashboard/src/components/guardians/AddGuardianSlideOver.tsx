import { useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { SlideOver } from '@/components/shared/SlideOver'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorDetail } from '@/lib/api'
import {
  guardianFormErrors,
  createGuardianPayload,
  type GuardianDraft,
} from '@/lib/guardians/guardians'
import { createGuardian, type GuardianDetail } from '@/lib/queries/guardians'

type AddGuardianSlideOverProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (guardian: GuardianDetail) => void
}

const EMPTY_HOME = { label: '', address: '', accessCode: '' }
const EMPTY_DRAFT: GuardianDraft = { name: '', phoneNumber: '', home: EMPTY_HOME }
const SAVE_FALLBACK_ERROR = 'Something went wrong. Please try again.'

export const AddGuardianSlideOver = ({
  open,
  onOpenChange,
  onCreated,
}: AddGuardianSlideOverProps) => {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<GuardianDraft>(EMPTY_DRAFT)
  const [validationErrors, setValidationErrors] = useState<string[]>([])

  const createMutation = useMutation({
    mutationFn: createGuardian,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guardians'] })
      queryClient.invalidateQueries({ queryKey: ['households'] })
    },
  })

  const close = () => {
    onOpenChange(false)
    setDraft(EMPTY_DRAFT)
    setValidationErrors([])
    createMutation.reset()
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !createMutation.isPending) close()
  }

  const handleSubmit = () => {
    const errors = guardianFormErrors(draft)

    if (errors.length > 0) {
      setValidationErrors(errors)
    } else {
      setValidationErrors([])
      createMutation.mutate(createGuardianPayload(draft), {
        onSuccess: (guardian) => {
          close()
          onCreated(guardian)
        },
      })
    }
  }

  const saveErrorMessage = createMutation.isError
    ? (errorDetail(createMutation.error) ?? SAVE_FALLBACK_ERROR)
    : null

  return (
    <SlideOver
      open={open}
      onOpenChange={handleOpenChange}
      title="Add guardian"
      footer={
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={close}
            disabled={createMutation.isPending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Saving…' : 'Create guardian'}
          </Button>
        </div>
      }
    >
      <GuardianForm
        draft={draft}
        onChange={setDraft}
        validationErrors={validationErrors}
        saveErrorMessage={saveErrorMessage}
      />
    </SlideOver>
  )
}

type GuardianFormProps = {
  draft: GuardianDraft
  onChange: (draft: GuardianDraft) => void
  validationErrors: string[]
  saveErrorMessage: string | null
}

const GuardianForm = ({
  draft,
  onChange,
  validationErrors,
  saveErrorMessage,
}: GuardianFormProps) => {
  let content: ReactNode = null

  if (validationErrors.length > 0 || saveErrorMessage !== null) {
    content = (
      <ul role="alert" className="space-y-1 text-sm font-medium text-destructive">
        {validationErrors.map((message) => (
          <li key={message}>{message}</li>
        ))}
        {saveErrorMessage !== null && <li>{saveErrorMessage}</li>}
      </ul>
    )
  }

  return (
    <div className="space-y-4">
      {content}

      <div className="space-y-1.5">
        <Label htmlFor="guardian-name">Name</Label>
        <Input
          id="guardian-name"
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="guardian-phone">Phone number</Label>
        <Input
          id="guardian-phone"
          value={draft.phoneNumber}
          onChange={(event) => onChange({ ...draft, phoneNumber: event.target.value })}
        />
      </div>

      <div className="space-y-4">
        <Label>Home (optional)</Label>

        <div className="space-y-1.5">
          <Label htmlFor="guardian-home-label">Label</Label>
          <Input
            id="guardian-home-label"
            value={draft.home.label}
            onChange={(event) =>
              onChange({ ...draft, home: { ...draft.home, label: event.target.value } })
            }
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="guardian-home-address">Address</Label>
          <Input
            id="guardian-home-address"
            value={draft.home.address}
            onChange={(event) =>
              onChange({ ...draft, home: { ...draft.home, address: event.target.value } })
            }
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="guardian-home-access-code">Access code</Label>
          <Input
            id="guardian-home-access-code"
            value={draft.home.accessCode}
            onChange={(event) =>
              onChange({ ...draft, home: { ...draft.home, accessCode: event.target.value } })
            }
          />
        </div>
      </div>
    </div>
  )
}
