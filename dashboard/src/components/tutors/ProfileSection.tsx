import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { SlideOver } from '@/components/shared/SlideOver'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { errorDetail } from '@/lib/api'
import {
  deactivateTutor,
  tutorQueries,
  updateTutor,
  type Tutor,
  type TutorUpdate,
} from '@/lib/queries/tutors'
import { tutorBioPayload } from '@/lib/tutors/tutors'
import { cn } from '@/lib/utils'

type ProfileSectionProps = { tutorId: string }

type ProfileCardProps = { tutor: Tutor }

type ProfileDraft = {
  name: string
  email: string
  phone_number: string
  bio: string
}

type FieldProps = {
  label: string
  children: ReactNode
  className?: string
}

const SAVE_FALLBACK_ERROR = 'Something went wrong. Please try again.'

export const ProfileSection = ({ tutorId }: ProfileSectionProps) => {
  const { data: tutor } = useQuery(tutorQueries.detail(tutorId))

  return tutor === undefined ? null : <ProfileCard tutor={tutor} />
}

const ProfileCard = ({ tutor }: ProfileCardProps) => {
  const queryClient = useQueryClient()
  const formId = useId()
  const [editOpen, setEditOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFrom(tutor))

  const save = useMutation({
    mutationFn: (body: TutorUpdate) => updateTutor(tutor.id, body),
    onSuccess: () => {
      setEditOpen(false)

      return queryClient.invalidateQueries({ queryKey: ['tutors'] })
    },
  })

  const toggleActive = useMutation({
    mutationFn: () =>
      tutor.is_active ? deactivateTutor(tutor.id) : updateTutor(tutor.id, { is_active: true }),
    onSuccess: () => {
      setConfirmOpen(false)

      return queryClient.invalidateQueries({ queryKey: ['tutors'] })
    },
  })

  const handleEditOpenChange = (open: boolean) => {
    if (open) {
      setDraft(draftFrom(tutor))
      save.reset()
    }
    setEditOpen(open)
  }

  const handleConfirmOpenChange = (open: boolean) => {
    if (open) {
      toggleActive.reset()
    }
    setConfirmOpen(open)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    save.mutate({
      name: draft.name.trim(),
      email: draft.email.trim(),
      phone_number: draft.phone_number.trim(),
      bio: tutorBioPayload(draft.bio),
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardAction className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => handleEditOpenChange(true)}>
            Edit
          </Button>
          <Button
            type="button"
            variant={tutor.is_active ? 'destructive' : 'outline'}
            onClick={() => handleConfirmOpenChange(true)}
          >
            {tutor.is_active ? 'Deactivate' : 'Reactivate'}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">{tutor.name}</Field>
          <Field label="Email">{tutor.email}</Field>
          <Field label="Phone">{tutor.phone_number}</Field>
          <Field label="Status">{tutor.is_active ? 'Active' : 'Inactive'}</Field>
          <Field label="Bio" className="sm:col-span-2">
            {tutor.bio === null || tutor.bio.trim() === '' ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <span className="whitespace-pre-wrap">{tutor.bio}</span>
            )}
          </Field>
        </dl>
      </CardContent>

      <SlideOver
        open={editOpen}
        onOpenChange={handleEditOpenChange}
        title="Edit tutor"
        description="Changes take effect immediately."
        footer={
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={() => handleEditOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" form={formId} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        }
      >
        <form id={formId} onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-name`}>Name</Label>
            <Input
              id={`${formId}-name`}
              name="name"
              required
              autoComplete="off"
              value={draft.name}
              disabled={save.isPending}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-email`}>Email</Label>
            <Input
              id={`${formId}-email`}
              name="email"
              type="email"
              required
              autoComplete="off"
              value={draft.email}
              disabled={save.isPending}
              onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-phone`}>Phone</Label>
            <Input
              id={`${formId}-phone`}
              name="phone_number"
              type="tel"
              required
              autoComplete="off"
              value={draft.phone_number}
              disabled={save.isPending}
              onChange={(event) => setDraft({ ...draft, phone_number: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${formId}-bio`}>Bio</Label>
            <Textarea
              id={`${formId}-bio`}
              name="bio"
              rows={5}
              value={draft.bio}
              disabled={save.isPending}
              onChange={(event) => setDraft({ ...draft, bio: event.target.value })}
            />
          </div>
          {save.isError && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {errorDetail(save.error) ?? SAVE_FALLBACK_ERROR}
            </p>
          )}
        </form>
      </SlideOver>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={handleConfirmOpenChange}
        title={tutor.is_active ? 'Deactivate tutor' : 'Reactivate tutor'}
        body={
          tutor.is_active
            ? `${tutor.name} will stop appearing in tutor lists and cannot be booked. Existing bookings are untouched.`
            : `${tutor.name} will appear in tutor lists again and can be booked.`
        }
        confirmLabel={tutor.is_active ? 'Deactivate' : 'Reactivate'}
        destructive={tutor.is_active}
        pending={toggleActive.isPending}
        errorMessage={
          toggleActive.isError ? (errorDetail(toggleActive.error) ?? SAVE_FALLBACK_ERROR) : null
        }
        onConfirm={() => toggleActive.mutate()}
      />
    </Card>
  )
}

const Field = ({ label, children, className }: FieldProps) => (
  <div className={cn('space-y-1', className)}>
    <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
    <dd className="text-sm text-foreground">{children}</dd>
  </div>
)

const draftFrom = (tutor: Tutor): ProfileDraft => ({
  name: tutor.name,
  email: tutor.email,
  phone_number: tutor.phone_number,
  bio: tutor.bio ?? '',
})
