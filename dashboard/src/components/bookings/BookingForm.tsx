import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { SearchPicker, type SearchPickerOption } from '@/components/pickers/SearchPicker'
import { SlideOver } from '@/components/shared/SlideOver'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { errorDetail } from '@/lib/api'
import {
  childPickerOptions,
  draftErrors,
  EMPTY_DRAFT,
  homeOptionsFor,
  onChildChange,
  onChildDetail,
  onDateChange,
  onSlotChange,
  onTutorChange,
  slotsForDate,
  submitPlan,
  toCreateBody,
  weekdayName,
  type BookingDraft,
} from '@/lib/booking-form/bookingForm'
import { formatTime } from '@/lib/dates/dates'
import { bookingRefQueries } from '@/lib/queries/bookingRefs'
import { createBooking, type BookingCreate } from '@/lib/queries/bookings'
import { childQueries, updateChild, type ChildDetail } from '@/lib/queries/children'
import { subjectQueries } from '@/lib/queries/subjects'
import { tutorQueries } from '@/lib/queries/tutors'
import { cn } from '@/lib/utils'

type BookingFormProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
  initialChild?: { id: string; name: string }
}

type FieldProps = {
  id: string
  label: string
  hint?: string | null
  children: ReactNode
}

const FORM_ID = 'create-booking-form'
const REFERENCE_PAGE_SIZE = 100
const CHILD_SEARCH_PAGE_SIZE = 20
const CHILD_WRITE_KEYS = ['children', 'guardians', 'households']
const SUBMIT_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const AVAILABILITY_FALLBACK_ERROR = 'Could not load this tutor’s availability.'
const HOMES_FALLBACK_ERROR = 'Could not load this child’s homes.'
const CHILD_FIRST_HINT = 'Choose a child first.'

const alertClasses = 'text-sm font-medium text-destructive'

export const BookingForm = ({ open, onOpenChange, onCreated, initialChild }: BookingFormProps) => {
  const queryClient = useQueryClient()

  const [draft, setDraft] = useState<BookingDraft>(EMPTY_DRAFT)
  const [childOption, setChildOption] = useState<SearchPickerOption | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [reactivatedName, setReactivatedName] = useState<string | null>(null)
  const [seenOpen, setSeenOpen] = useState(false)
  const [syncedDetail, setSyncedDetail] = useState<ChildDetail | undefined>(undefined)

  if (open !== seenOpen) {
    setSeenOpen(open)

    if (open && initialChild !== undefined) {
      setChildOption({ id: initialChild.id, label: initialChild.name })
      setDraft(onChildChange(EMPTY_DRAFT, initialChild))
    }
  }

  const tutors = useQuery(tutorQueries.list({ is_active: true, page_size: REFERENCE_PAGE_SIZE }))
  const subjects = useQuery(subjectQueries.list({ is_active: true, page_size: REFERENCE_PAGE_SIZE }))
  const childDetail = useQuery({
    ...childQueries.detail(draft.childId),
    enabled: draft.childId !== '',
  })
  const availability = useQuery(bookingRefQueries.tutorAvailability(draft.tutorId))
  const reactivate = useMutation({
    mutationFn: (childId: string) => updateChild(childId, { is_active: true }),
    onSuccess: () => {
      for (const key of CHILD_WRITE_KEYS) {
        queryClient.invalidateQueries({ queryKey: [key] })
      }
    },
  })
  const create = useMutation({
    mutationFn: createBooking,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['children'] })
    },
  })

  if (childDetail.data !== syncedDetail) {
    const loaded = childDetail.data

    setSyncedDetail(loaded)

    if (loaded !== undefined) {
      setDraft((current) => onChildDetail(current, loaded))
    }
  }

  const homeOptions = homeOptionsFor(childDetail.data)
  const slotOptions = slotsForDate(availability.data?.items ?? [], draft.date)
  const errors = draftErrors(draft)
  const plan = submitPlan(draft)
  const noActiveHome = childDetail.data !== undefined && homeOptions.length === 0
  const busy = create.isPending || reactivate.isPending

  const resetAndClose = () => {
    setDraft(EMPTY_DRAFT)
    setChildOption(null)
    setSubmitted(false)
    setReactivatedName(null)
    reactivate.reset()
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

  const book = (body: BookingCreate) => {
    create.mutate(body, {
      onSuccess: () => {
        onCreated()
        resetAndClose()
      },
    })
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitted(true)
    setReactivatedName(null)
    reactivate.reset()
    create.reset()

    if (errors.length === 0 && !noActiveHome) {
      const body = toCreateBody(draft)
      const childName = childOption?.label ?? ''

      if (plan === 'reactivate-then-book') {
        reactivate.mutate(draft.childId, {
          onSuccess: () => {
            setDraft((current) => ({ ...current, childInactive: false }))
            setReactivatedName(childName)
            book(body)
          },
        })
      } else {
        book(body)
      }
    }
  }

  const handleChildChange = (option: SearchPickerOption | null) => {
    setChildOption(option)
    setDraft((current) => onChildChange(current, option))
  }

  const searchChildren = async (term: string): Promise<SearchPickerOption[]> => {
    const [active, inactive] = await Promise.all([
      queryClient.fetchQuery(
        childQueries.list({ q: term, is_active: true, page_size: CHILD_SEARCH_PAGE_SIZE }),
      ),
      queryClient.fetchQuery(
        childQueries.list({ q: term, is_active: false, page_size: CHILD_SEARCH_PAGE_SIZE }),
      ),
    ])

    return childPickerOptions(active.items, inactive.items)
  }

  const handleSlotSelect = (availabilityId: string) => {
    const slot = slotOptions.find((candidate) => candidate.id === availabilityId) ?? null

    setDraft((current) => onSlotChange(current, slot))
  }

  let submitError: string | null = null

  if (reactivate.isError) {
    submitError = errorDetail(reactivate.error) ?? SUBMIT_FALLBACK_ERROR
  } else if (create.isError) {
    const detail = errorDetail(create.error) ?? SUBMIT_FALLBACK_ERROR

    submitError =
      reactivatedName === null
        ? detail
        : `${reactivatedName} was reactivated, but the session could not be booked: ${detail}`
  }

  let submitLabel = plan === 'reactivate-then-book' ? 'Reactivate and book' : 'Create booking'

  if (reactivate.isPending) {
    submitLabel = 'Reactivating…'
  } else if (create.isPending) {
    submitLabel = 'Creating…'
  }

  const childHint =
    draft.childInactive && childOption !== null
      ? `${childOption.label} is inactive. Booking will reactivate them first.`
      : null

  let homeHint: string | null = null

  if (draft.childId === '') {
    homeHint = CHILD_FIRST_HINT
  } else if (childDetail.isPending) {
    homeHint = 'Loading homes…'
  } else if (childDetail.isError) {
    homeHint = errorDetail(childDetail.error) ?? HOMES_FALLBACK_ERROR
  } else if (noActiveHome) {
    homeHint = `${childDetail.data.name} has no active home. Add one on the child's page.`
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
          {submitError !== null && (
            <p role="alert" className={alertClasses}>
              {submitError}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" form={FORM_ID} disabled={busy || noActiveHome}>
              {submitLabel}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={resetAndClose}>
              Cancel
            </Button>
          </div>
        </div>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        <Field id="booking-child" label="Child" hint={childHint}>
          <SearchPicker
            id="booking-child"
            queryKeyPrefix={['children', 'picker']}
            search={searchChildren}
            value={childOption}
            onChange={handleChildChange}
            placeholder="Search by child or guardian name"
            disabled={busy}
            emptyMessage="No matching children."
          />
        </Field>

        <Field id="booking-home" label="Home" hint={homeHint}>
          <Select
            id="booking-home"
            value={draft.homeId}
            disabled={busy || homeOptions.length === 0}
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
