import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'

import { SlideOver } from '@/components/shared/SlideOver'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { errorDetail } from '@/lib/api'
import {
  draftErrors,
  EMPTY_DRAFT,
  onChildChange,
  onClientChange,
  onDateChange,
  onSlotChange,
  onTutorChange,
  slotsForDate,
  toCreateBody,
  weekdayName,
  type BookingDraft,
} from '@/lib/bookingForm'
import { formatTime } from '@/lib/dates'
import { bookingRefQueries } from '@/lib/queries/bookingRefs'
import { createBooking } from '@/lib/queries/bookings'
import { clientQueries } from '@/lib/queries/clients'
import { subjectQueries } from '@/lib/queries/subjects'
import { tutorQueries } from '@/lib/queries/tutors'
import { cn } from '@/lib/utils'

type BookingFormProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

type FieldProps = {
  id: string
  label: string
  hint?: string | null
  children: ReactNode
}

const FORM_ID = 'create-booking-form'
const REFERENCE_PAGE_SIZE = 100
const SUBMIT_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const AVAILABILITY_FALLBACK_ERROR = 'Could not load this tutor’s availability.'
const CLIENT_FIRST_HINT = 'Choose a client first.'

const alertClasses = 'text-sm font-medium text-destructive'

export const BookingForm = ({ open, onOpenChange, onCreated }: BookingFormProps) => {
  const [draft, setDraft] = useState<BookingDraft>(EMPTY_DRAFT)
  const [submitted, setSubmitted] = useState(false)

  const clients = useQuery(clientQueries.list({ is_active: true, page_size: REFERENCE_PAGE_SIZE }))
  const tutors = useQuery(tutorQueries.list({ is_active: true, page_size: REFERENCE_PAGE_SIZE }))
  const subjects = useQuery(subjectQueries.list({ is_active: true, page_size: REFERENCE_PAGE_SIZE }))
  const clientDetail = useQuery({
    ...clientQueries.detail(draft.clientId),
    enabled: draft.clientId !== '',
  })
  const availability = useQuery(bookingRefQueries.tutorAvailability(draft.tutorId))
  const create = useMutation({ mutationFn: createBooking })

  const childOptions = draft.clientId === '' ? [] : (clientDetail.data?.children ?? [])
  const homeOptions = draft.clientId === '' ? [] : (clientDetail.data?.homes ?? [])
  const slotOptions = slotsForDate(availability.data?.items ?? [], draft.date)
  const errors = draftErrors(draft)
  const busy = create.isPending

  const resetAndClose = () => {
    setDraft(EMPTY_DRAFT)
    setSubmitted(false)
    create.reset()
    onOpenChange(false)
  }

  const handleOpenChange = (next: boolean) => {
    if (next) {
      onOpenChange(true)
    } else {
      resetAndClose()
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitted(true)

    if (errors.length === 0) {
      create.mutate(toCreateBody(draft), {
        onSuccess: () => {
          onCreated()
          resetAndClose()
        },
      })
    } else {
      create.reset()
    }
  }

  const handleSlotSelect = (availabilityId: string) => {
    const slot = slotOptions.find((candidate) => candidate.id === availabilityId) ?? null

    setDraft((current) => onSlotChange(current, slot))
  }

  let slotHint: string | null = null

  if (draft.tutorId === '' || draft.date === '') {
    slotHint = 'Choose a tutor and a date first.'
  } else if (availability.isPending) {
    slotHint = 'Loading availability…'
  } else if (availability.isError) {
    slotHint = errorDetail(availability.error) ?? AVAILABILITY_FALLBACK_ERROR
  } else if (slotOptions.length === 0) {
    slotHint = `This tutor has no availability on ${weekdayName(draft.date)}s.`
  }

  return (
    <SlideOver
      open={open}
      onOpenChange={handleOpenChange}
      title="Create booking"
      description="Booked as an admin, with no guardian on the other end of it."
      footer={
        <div className="space-y-3">
          {submitted && errors.length > 0 && (
            <ul role="alert" className={cn(alertClasses, 'space-y-1')}>
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
          {create.isError && (
            <p role="alert" className={alertClasses}>
              {errorDetail(create.error) ?? SUBMIT_FALLBACK_ERROR}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" form={FORM_ID} disabled={busy}>
              {busy ? 'Creating…' : 'Create booking'}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={resetAndClose}>
              Cancel
            </Button>
          </div>
        </div>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        <Field id="booking-client" label="Client">
          <Select
            id="booking-client"
            value={draft.clientId}
            disabled={busy}
            onChange={(event) => setDraft((current) => onClientChange(current, event.target.value))}
          >
            <option value="">Select a client</option>
            {(clients.data?.items ?? []).map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          id="booking-child"
          label="Child"
          hint={draft.clientId === '' ? CLIENT_FIRST_HINT : null}
        >
          <Select
            id="booking-child"
            value={draft.childId}
            disabled={busy || draft.clientId === ''}
            onChange={(event) => setDraft((current) => onChildChange(current, event.target.value))}
          >
            <option value="">Select a child</option>
            {childOptions.map((child) => (
              <option key={child.id} value={child.id}>
                {child.name} — grade {child.grade_level}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          id="booking-home"
          label="Home"
          hint={draft.clientId === '' ? CLIENT_FIRST_HINT : null}
        >
          <Select
            id="booking-home"
            value={draft.homeId}
            disabled={busy || draft.clientId === ''}
            onChange={(event) =>
              setDraft((current) => ({ ...current, homeId: event.target.value }))
            }
          >
            <option value="">Select a home</option>
            {homeOptions.map((home) => (
              <option key={home.id} value={home.id}>
                {home.label === null ? home.address : `${home.label} — ${home.address}`}
              </option>
            ))}
          </Select>
        </Field>

        <Field id="booking-tutor" label="Tutor">
          <Select
            id="booking-tutor"
            value={draft.tutorId}
            disabled={busy}
            onChange={(event) => setDraft((current) => onTutorChange(current, event.target.value))}
          >
            <option value="">Select a tutor</option>
            {(tutors.data?.items ?? []).map((tutor) => (
              <option key={tutor.id} value={tutor.id}>
                {tutor.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field id="booking-subject" label="Subject">
          <Select
            id="booking-subject"
            value={draft.subjectId}
            disabled={busy}
            onChange={(event) =>
              setDraft((current) => ({ ...current, subjectId: event.target.value }))
            }
          >
            <option value="">Select a subject</option>
            {(subjects.data?.items ?? []).map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field id="booking-date" label="Date">
          <Input
            id="booking-date"
            type="date"
            value={draft.date}
            disabled={busy}
            onChange={(event) => setDraft((current) => onDateChange(current, event.target.value))}
          />
        </Field>

        <Field id="booking-slot" label="Availability slot" hint={slotHint}>
          <Select
            id="booking-slot"
            value={draft.availabilityId}
            disabled={busy || slotOptions.length === 0}
            onChange={(event) => handleSlotSelect(event.target.value)}
          >
            <option value="">Select a slot</option>
            {slotOptions.map((slot) => (
              <option key={slot.id} value={slot.id}>
                {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="booking-start" label="Start time">
            <Input
              id="booking-start"
              type="time"
              value={draft.startTime}
              disabled={busy}
              onChange={(event) =>
                setDraft((current) => ({ ...current, startTime: event.target.value }))
              }
            />
          </Field>
          <Field id="booking-end" label="End time">
            <Input
              id="booking-end"
              type="time"
              value={draft.endTime}
              disabled={busy}
              onChange={(event) =>
                setDraft((current) => ({ ...current, endTime: event.target.value }))
              }
            />
          </Field>
        </div>

        <Field id="booking-notes" label="Notes (optional)">
          <Textarea
            id="booking-notes"
            rows={3}
            value={draft.notes}
            disabled={busy}
            onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
          />
        </Field>
      </form>
    </SlideOver>
  )
}

const Field = ({ id, label, hint, children }: FieldProps) => (
  <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    {children}
    {hint !== null && hint !== undefined && (
      <p className="text-xs text-muted-foreground">{hint}</p>
    )}
  </div>
)
