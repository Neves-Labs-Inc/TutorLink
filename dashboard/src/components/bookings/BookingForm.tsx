import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import BookingWarnings from '@/components/bookings/BookingWarnings'
import LocationSelect from '@/components/bookings/LocationSelect'
import StaffSelect from '@/components/bookings/StaffSelect'
import { SearchPicker, type SearchPickerOption } from '@/components/pickers/SearchPicker'
import { SegmentedTabs } from '@/components/shared/SegmentedTabs'
import { SlideOver } from '@/components/shared/SlideOver'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { errorDetail, warningsOf } from '@/lib/api'
import {
  childPickerOptions,
  DRAFT_ERROR,
  draftErrors,
  EMPTY_DRAFT,
  homeOptionsFor,
  onChildChange,
  onChildDetail,
  onDateChange,
  onKindChange,
  onSlotChange,
  onStaffChange,
  slotModeWarning,
  slotsForDate,
  staffOptionsFor,
  submitLabel,
  submitPlan,
  timeSource,
  toCreateBody,
  weekdayName,
  type BookingDraft,
  type ChildPickerOption,
} from '@/lib/booking-form/bookingForm'
import { formatTime } from '@/lib/dates/dates'
import { availabilityQueries } from '@/lib/queries/availability'
import {
  createBooking,
  type BookingCreate,
  type BookingKind,
  type BookingWarning,
  type WarningCode,
} from '@/lib/queries/bookings'
import { childQueries, updateChild, type ChildDetail } from '@/lib/queries/children'
import { staffQueries } from '@/lib/queries/staff'
import { subjectQueries } from '@/lib/queries/subjects'
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
  hintIsError?: boolean
  children: ReactNode
}

type Hint = { text: string | null; isError: boolean }

const FORM_ID = 'create-booking-form'
const KIND_PANEL_ID = 'booking-kind-panel'
const KIND_TABS: { value: BookingKind; label: string }[] = [
  { value: 'regular', label: 'Regular' },
  { value: 'evaluation', label: 'Evaluation' },
]
const REFERENCE_PAGE_SIZE = 100
const CHILD_SEARCH_PAGE_SIZE = 20
const CHILD_WRITE_KEYS = ['children', 'guardians', 'households']
const CREATED_KEYS = ['bookings', 'stats', 'children']
const SUBMIT_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const STAFF_FALLBACK_ERROR = 'Could not load staff.'
const AVAILABILITY_FALLBACK_ERROR = 'Could not load this staff member’s availability.'
const HOMES_FALLBACK_ERROR = 'Could not load this child’s homes.'
const CHILD_FIRST_HINT = 'Choose a child first.'
const EVALUATION_CHILD_HINT = 'Only children who are not yet Evaluated and have no live Evaluation.'
const EVALUATION_STAFF_HINT = 'Admins and Managers only.'
const ADMIN_STAFF_HINT = 'Admins have no availability. Type the time; only overlap is checked.'
const NO_STAFF_HINT = 'No staff can be booked for this kind.'

const NO_HINT: Hint = { text: null, isError: false }
const alertClasses = 'text-sm font-medium text-destructive'

const fieldHint = (text: string | null, isError = false): Hint => ({ text, isError })

const unionCodes = (confirmed: WarningCode[], shown: BookingWarning[]): WarningCode[] => [
  ...new Set([...confirmed, ...shown.map((warning) => warning.code)]),
]

export const BookingForm = ({ open, onOpenChange, onCreated, initialChild }: BookingFormProps) => {
  const queryClient = useQueryClient()

  const [draft, setDraft] = useState<BookingDraft>(EMPTY_DRAFT)
  const [childOption, setChildOption] = useState<ChildPickerOption | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [reactivatedName, setReactivatedName] = useState<string | null>(null)
  const [seenOpen, setSeenOpen] = useState(false)
  const [syncedDetail, setSyncedDetail] = useState<ChildDetail | undefined>(undefined)
  // The server returns only the still-unconfirmed codes, so the ones already sent accumulate
  // here and every "Book anyway" resubmits `confirmed ∪ shown`.
  const [shownWarnings, setShownWarnings] = useState<BookingWarning[]>([])
  const [confirmed, setConfirmed] = useState<WarningCode[]>([])
  const submitButton = useRef<HTMLButtonElement>(null)

  if (open !== seenOpen) {
    setSeenOpen(open)

    if (open && initialChild !== undefined) {
      setChildOption({
        id: initialChild.id,
        label: initialChild.name,
        description: '',
        inactive: false,
        // The page knows the Child by name only; a switch to Evaluation re-checks via the picker.
        evaluable: false,
      })
      setDraft(onChildChange(EMPTY_DRAFT, initialChild))
    }
  }

  const source = timeSource(draft.kind, draft.staffRole)
  const slotTutorId = draft.staffTutorId ?? ''

  const staff = useQuery(staffQueries.list())
  const subjects = useQuery(subjectQueries.list({ is_active: true, page_size: REFERENCE_PAGE_SIZE }))
  const childDetail = useQuery({
    ...childQueries.detail(draft.childId),
    enabled: draft.childId !== '',
  })
  const availability = useQuery({
    ...availabilityQueries.forTutor(slotTutorId),
    enabled: source === 'slot' && slotTutorId !== '',
  })
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
      for (const key of CREATED_KEYS) {
        queryClient.invalidateQueries({ queryKey: [key] })
      }
    },
  })

  if (childDetail.data !== syncedDetail) {
    const loaded = childDetail.data

    setSyncedDetail(loaded)

    if (loaded !== undefined) {
      setDraft((current) => onChildDetail(current, loaded))
    }
  }

  const staffOptions = staffOptionsFor(staff.data?.items ?? [], draft.kind)
  const homeOptions = homeOptionsFor(childDetail.data)
  const slotOptions = slotsForDate(availability.data?.items ?? [], draft.date)
  const chosenSlot = slotOptions.find((slot) => slot.id === draft.availabilityId)
  const errors = draftErrors(draft)
  const plan = submitPlan(draft)
  const noActiveHome = childDetail.data !== undefined && homeOptions.length === 0
  const busy = create.isPending || reactivate.isPending
  const slotWarning = source === 'slot' ? slotModeWarning(chosenSlot, draft.location) : null
  const warningMessages = [
    ...shownWarnings.map((warning) => warning.message),
    ...(slotWarning === null ? [] : [slotWarning]),
  ]
  // The detail, once loaded, knows better than the search option (an `initialChild` has none).
  const childEvaluable =
    childDetail.data !== undefined && childDetail.data.id === draft.childId
      ? childDetail.data.evaluated === null
      : (childOption?.evaluable ?? false)
  const isInvalid = (message: string) => submitted && errors.includes(message)

  const clearWarnings = () => {
    setShownWarnings([])
    setConfirmed([])
  }

  // Every field change goes through here: a warning answers the draft that was sent.
  const updateDraft = (next: (current: BookingDraft) => BookingDraft) => {
    clearWarnings()
    setDraft(next)
  }

  // The submit button is `disabled` while busy, which drops focus to the body; put it back once
  // the write settles so Enter reaches "Book anyway" and the error sits next in reading order.
  const refocusSubmit = () => {
    requestAnimationFrame(() => submitButton.current?.focus({ preventScroll: true }))
  }

  const resetAndClose = () => {
    setDraft(EMPTY_DRAFT)
    setChildOption(null)
    setSubmitted(false)
    setReactivatedName(null)
    clearWarnings()
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
      onError: (error) => {
        const warnings = warningsOf(error)

        // A 409 with `warnings[]` is confirmable; anything else is a block and renders as an error.
        setConfirmed(warnings === null ? [] : body.confirm_warnings)
        setShownWarnings(warnings ?? [])
        refocusSubmit()
      },
    })
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitted(true)
    setReactivatedName(null)
    reactivate.reset()
    create.reset()

    if (errors.length === 0) {
      const body = toCreateBody(draft, unionCodes(confirmed, shownWarnings))
      const childName = childOption?.label ?? ''

      if (plan === 'reactivate-then-book') {
        reactivate.mutate(draft.childId, {
          onSuccess: () => {
            setDraft((current) => ({ ...current, childInactive: false }))
            setReactivatedName(childName)
            book(body)
          },
          onError: refocusSubmit,
        })
      } else {
        book(body)
      }
    }
  }

  const handleKindChange = (kind: BookingKind) => {
    const next = onKindChange(draft, kind, { childEvaluable })

    if (next.childId === '') {
      setChildOption(null)
    }
    updateDraft(() => next)
  }

  const handleChildChange = (option: SearchPickerOption | null) => {
    // The picker hands back the very object `searchChildren` built, so the extra fields are there.
    const picked = option as ChildPickerOption | null

    setChildOption(picked)
    updateDraft((current) => onChildChange(current, picked))
  }

  const searchChildren = async (term: string): Promise<SearchPickerOption[]> => {
    let options: ChildPickerOption[]

    if (draft.kind === 'evaluation') {
      const evaluable = await queryClient.fetchQuery(
        childQueries.list({
          q: term,
          is_active: true,
          evaluable: true,
          page_size: CHILD_SEARCH_PAGE_SIZE,
        }),
      )

      options = childPickerOptions(evaluable.items, [])
    } else {
      const [active, inactive] = await Promise.all([
        queryClient.fetchQuery(
          childQueries.list({ q: term, is_active: true, page_size: CHILD_SEARCH_PAGE_SIZE }),
        ),
        queryClient.fetchQuery(
          childQueries.list({ q: term, is_active: false, page_size: CHILD_SEARCH_PAGE_SIZE }),
        ),
      ])

      options = childPickerOptions(active.items, inactive.items)
    }

    return options
  }

  const handleSlotSelect = (availabilityId: string) => {
    const slot = slotOptions.find((candidate) => candidate.id === availabilityId) ?? null

    updateDraft((current) => onSlotChange(current, slot))
  }

  let submitError: string | null = null

  if (reactivate.isError) {
    submitError = errorDetail(reactivate.error) ?? SUBMIT_FALLBACK_ERROR
  } else if (create.isError && warningsOf(create.error) === null) {
    const detail = errorDetail(create.error) ?? SUBMIT_FALLBACK_ERROR

    submitError =
      reactivatedName === null
        ? detail
        : `${reactivatedName} was reactivated, but the session could not be booked: ${detail}`
  }

  let childHint: string | null = null

  if (draft.kind === 'evaluation') {
    childHint = EVALUATION_CHILD_HINT
  } else if (draft.childInactive && childOption !== null) {
    childHint = `${childOption.label} is inactive. Booking will reactivate them first.`
  }

  let staffHint = NO_HINT

  if (staff.isPending) {
    staffHint = fieldHint('Loading staff…')
  } else if (staff.isError) {
    staffHint = fieldHint(errorDetail(staff.error) ?? STAFF_FALLBACK_ERROR, true)
  } else if (staffOptions.length === 0) {
    staffHint = fieldHint(NO_STAFF_HINT)
  } else if (draft.kind === 'evaluation') {
    staffHint = fieldHint(EVALUATION_STAFF_HINT)
  } else if (draft.staffRole === 'admin') {
    staffHint = fieldHint(ADMIN_STAFF_HINT)
  }

  let locationHint = NO_HINT

  if (draft.childId === '') {
    locationHint = fieldHint(CHILD_FIRST_HINT)
  } else if (childDetail.isPending) {
    locationHint = fieldHint('Loading homes…')
  } else if (childDetail.isError) {
    locationHint = fieldHint(errorDetail(childDetail.error) ?? HOMES_FALLBACK_ERROR, true)
  } else if (noActiveHome) {
    locationHint = fieldHint(`${childDetail.data.name} has no active home. You can still book In office.`)
  }

  let slotHint = NO_HINT

  if (slotTutorId === '' || draft.date === '') {
    slotHint = fieldHint('Choose a staff member and a date first.')
  } else if (availability.isPending) {
    slotHint = fieldHint('Loading availability…')
  } else if (availability.isError) {
    slotHint = fieldHint(errorDetail(availability.error) ?? AVAILABILITY_FALLBACK_ERROR, true)
  } else if (slotOptions.length === 0) {
    slotHint = fieldHint(`This staff member has no availability on ${weekdayName(draft.date)}s.`)
  }

  const staffDisabled = busy || staff.isPending || staffOptions.length === 0
  // Kept disabled while the homes load so the list never pops in under an open menu.
  const locationDisabled = busy || childDetail.isPending
  const slotDisabled = busy || slotOptions.length === 0

  return (
    <SlideOver
      open={open}
      onOpenChange={handleOpenChange}
      title="New booking"
      description="Booked by the Office; no WhatsApp message is sent."
      footer={
        <div className="space-y-3">
          <BookingWarnings messages={warningMessages} />
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
            <Button ref={submitButton} type="submit" form={FORM_ID} disabled={busy}>
              {submitLabel(draft, warningMessages.length > 0, busy)}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={resetAndClose}>
              Cancel
            </Button>
          </div>
        </div>
      }
    >
      <form
        id={FORM_ID}
        onSubmit={handleSubmit}
        className="space-y-4"
        aria-busy={staff.isPending || subjects.isPending}
      >
        <SegmentedTabs
          tabs={KIND_TABS}
          value={draft.kind}
          onChange={handleKindChange}
          ariaLabel="Kind"
          panelId={KIND_PANEL_ID}
        />

        <div id={KIND_PANEL_ID} role="tabpanel" className="space-y-4">
          <Field id="booking-child" label="Child" hint={childHint}>
            <SearchPicker
              id="booking-child"
              queryKeyPrefix={['children', 'picker', draft.kind]}
              search={searchChildren}
              value={childOption}
              onChange={handleChildChange}
              placeholder="Search by child or guardian name"
              disabled={busy}
              emptyMessage="No matching children."
            />
          </Field>

          <Field
            id="booking-staff"
            label="Staff"
            hint={staffHint.text}
            hintIsError={staffHint.isError}
          >
            <StaffSelect
              id="booking-staff"
              value={draft.staffId}
              options={staffOptions}
              disabled={staffDisabled}
              invalid={isInvalid(DRAFT_ERROR.staff)}
              onChange={(member) => updateDraft((current) => onStaffChange(current, member))}
            />
          </Field>

          <Field
            id="booking-location"
            label="Location"
            hint={locationHint.text}
            hintIsError={locationHint.isError}
          >
            <LocationSelect
              id="booking-location"
              value={draft.location}
              childName={childOption?.label ?? null}
              homes={homeOptions}
              disabled={locationDisabled}
              invalid={isInvalid(DRAFT_ERROR.location)}
              onChange={(location) => updateDraft((current) => ({ ...current, location }))}
            />
          </Field>

          {draft.kind === 'regular' && (
            <Field id="booking-subject" label="Subject">
              <Select
                id="booking-subject"
                value={draft.subjectId}
                disabled={busy}
                aria-invalid={isInvalid(DRAFT_ERROR.subject) || undefined}
                onChange={(event) =>
                  updateDraft((current) => ({ ...current, subjectId: event.target.value }))
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
          )}

          <Field id="booking-date" label="Date">
            <Input
              id="booking-date"
              type="date"
              value={draft.date}
              disabled={busy}
              aria-invalid={isInvalid(DRAFT_ERROR.date) || undefined}
              onChange={(event) =>
                updateDraft((current) => onDateChange(current, event.target.value))
              }
            />
          </Field>

          {source === 'slot' && (
            <Field
              id="booking-slot"
              label="Availability slot"
              hint={slotHint.text}
              hintIsError={slotHint.isError}
            >
              <Select
                id="booking-slot"
                value={draft.availabilityId}
                disabled={slotDisabled}
                aria-invalid={isInvalid(DRAFT_ERROR.slot) || undefined}
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
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="booking-start" label="Start time">
              <Input
                id="booking-start"
                type="time"
                value={draft.startTime}
                disabled={busy}
                aria-invalid={
                  isInvalid(DRAFT_ERROR.startTime) || isInvalid(DRAFT_ERROR.order) || undefined
                }
                onChange={(event) =>
                  updateDraft((current) => ({ ...current, startTime: event.target.value }))
                }
              />
            </Field>
            <Field id="booking-end" label="End time">
              <Input
                id="booking-end"
                type="time"
                value={draft.endTime}
                disabled={busy}
                aria-invalid={
                  isInvalid(DRAFT_ERROR.endTime) || isInvalid(DRAFT_ERROR.order) || undefined
                }
                onChange={(event) =>
                  updateDraft((current) => ({ ...current, endTime: event.target.value }))
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
              onChange={(event) =>
                updateDraft((current) => ({ ...current, notes: event.target.value }))
              }
            />
          </Field>
        </div>
      </form>
    </SlideOver>
  )
}

const Field = ({ id, label, hint, hintIsError = false, children }: FieldProps) => (
  <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    {children}
    {hint !== null && hint !== undefined && (
      <p className={cn('text-xs', hintIsError ? 'text-destructive' : 'text-muted-foreground')}>
        {hint}
      </p>
    )}
  </div>
)
