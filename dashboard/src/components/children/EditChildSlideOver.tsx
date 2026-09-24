import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { ChildFields } from '@/components/children/ChildFields'
import { SlideOver } from '@/components/shared/SlideOver'
import { Button } from '@/components/ui/button'
import { errorDetail } from '@/lib/api'
import { childDraftErrors, childDraftFrom, childUpdate, type ChildDraft } from '@/lib/children/children'
import { updateChild, type ChildDetail, type ChildRecord, type ChildUpdate } from '@/lib/queries/children'
import { cn } from '@/lib/utils'

type EditChildSlideOverProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  child: ChildDetail
  onSaved: (child: ChildRecord) => void
}

const FORM_ID = 'edit-child-form'
const SAVE_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const alertClasses = 'text-sm font-medium text-destructive'

export const EditChildSlideOver = ({ open, onOpenChange, child, onSaved }: EditChildSlideOverProps) => {
  const queryClient = useQueryClient()
  const [wasOpen, setWasOpen] = useState(open)
  const [draft, setDraft] = useState<ChildDraft>(() => childDraftFrom(child))
  const [submitted, setSubmitted] = useState(false)

  if (open !== wasOpen) {
    setWasOpen(open)

    if (open) {
      setDraft(childDraftFrom(child))
      setSubmitted(false)
    }
  }

  const save = useMutation({
    mutationFn: (update: ChildUpdate) => updateChild(child.id, update),
  })
  const busy = save.isPending
  const errors = childDraftErrors(draft, new Date())

  const close = () => {
    setSubmitted(false)
    save.reset()
    onOpenChange(false)
  }

  const handleOpenChange = (next: boolean) => {
    if (next) {
      onOpenChange(true)
    } else {
      close()
    }
  }

  const handleSubmit = () => {
    setSubmitted(true)

    if (errors.length > 0) {
      save.reset()
    } else {
      const update = childUpdate(draft, child)

      if (Object.keys(update).length === 0) {
        close()
      } else {
        save.mutate(update, {
          onSuccess: (record) => {
            queryClient.invalidateQueries({ queryKey: ['children'] })
            queryClient.invalidateQueries({ queryKey: ['guardians'] })
            queryClient.invalidateQueries({ queryKey: ['households'] })
            onSaved(record)
            close()
          },
        })
      }
    }
  }

  return (
    <SlideOver
      open={open}
      onOpenChange={handleOpenChange}
      title="Edit child"
      footer={
        <div className="space-y-3">
          {submitted && errors.length > 0 && (
            <ul role="alert" className={cn(alertClasses, 'space-y-1')}>
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
          {save.isError && (
            <p role="alert" className={alertClasses}>
              {errorDetail(save.error) ?? SAVE_FALLBACK_ERROR}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" form={FORM_ID} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={close}>
              Cancel
            </Button>
          </div>
        </div>
      }
    >
      <form
        id={FORM_ID}
        onSubmit={(event) => {
          event.preventDefault()
          handleSubmit()
        }}
      >
        <ChildFields
          idPrefix={`edit-child-${child.id}`}
          value={draft}
          onChange={setDraft}
          disabled={busy}
          today={new Date()}
        />
      </form>
    </SlideOver>
  )
}
