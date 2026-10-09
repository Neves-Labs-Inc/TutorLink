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
import { useToast } from '@/hooks/useToast'
import { errorDetail, warningsOf } from '@/lib/api'
import {
  childPickerOptions,
  DRAFT_ERROR,
  draftErrors,
  draftFromDetail,
  EMPTY_DRAFT,
  homeOptionsFor,
  NOTES_MAX_LENGTH,
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
  toUpdateBody,
  weekdayName,
  type BookingDraft,
  type ChildPickerOption,
} from '@/lib/booking-form/bookingForm'
import { formatTime } from '@/lib/dates/dates'
import { availabilityQueries } from '@/lib/queries/availability'
import {
  createBooking,
  updateBooking,
  type BookingCreate,
  type BookingDetail,
  type BookingKind,
  type BookingReplace,
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
  onCreated?: () => void
  initialChild?: { id: string; name: string }
  // Edit mode: the live booking to replace in place; the kind and the Child are locked.
  booking?: BookingDetail
  onSaved?: () => void
}

type FieldProps = {
  id: string
  label: string
  hint?: string | null
  hintIsError?: boolean
  children: ReactNode
}

type Hint = { text: string | null; isError: boolean }

type ReplaceInput = { bookingId: string; body: BookingReplace }

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
const SAVED_KEYS = ['bookings', 'stats']
const SUBMIT_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const STAFF_FALLBACK_ERROR = 'Could not load staff.'
const STAFF_PREFILL_ERROR = 'Could not load staff. Please try again.'
const AVAILABILITY_FALLBACK_ERROR = 'Could not load this staff member’s availability.'
const HOMES_FALLBACK_ERROR = 'Could not load this child’s homes.'
const CHILD_FIRST_HINT = 'Choose a child first.'
const EVALUATION_CHILD_HINT = 'Only children who are not yet Evaluated and have no live Evaluation.'
const EVALUATION_STAFF_HINT = 'Admins and Managers only.'
const ADMIN_STAFF_HINT = 'Admins have no availability. Type the time; only overlap is checked.'
const NO_STAFF_HINT = 'No staff can be booked for this kind.'
const LOCKED_KIND_HINT = 'Locked on an edit.'
const EDIT_SLOT_HINT = 'Select the slot again. Start and end keep the booking’s times.'
const SAVED_TOAST = 'Booking updated. Let the Guardian know.'
// A label bar over a control bar per field, in field order; the control bar's shape per field.
const PREFILL_SKELETON_ROWS: { field: string; barClasses: string }[] = [
  { field: 'kind', barClasses: 'h-11 w-48 md:h-9' },
  { field: 'child', barClasses: 'h-11 w-full md:h-8' },
  { field: 'staff', barClasses: 'h-11 w-full md:h-8' },
  { field: 'location', barClasses: 'h-11 w-full md:h-8' },
  { field: 'subject', barClasses: 'h-11 w-full md:h-8' },
  { field: 'date', barClasses: 'h-11 w-full md:h-8' },
  { field: 'slot', barClasses: 'h-11 w-full md:h-8' },
  { field: 'times', barClasses: 'h-11 w-full md:h-8' },
  { field: 'notes', barClasses: 'h-20 w-full' },
]

const NO_HINT: Hint = { text: null, isError: false }
const alertClasses = 'text-sm font-medium text-destructive'
const skeletonBarClasses = 'animate-pulse rounded-lg bg-muted motion-reduce:animate-none'

const fieldHint = (text: string | null, isError = false): Hint => ({ text, isError })

const unionCodes = (confirmed: WarningCode[], shown: BookingWarning[]): WarningCode[] => [
  ...new Set([...confirmed, ...shown.map((warning) => warning.code)]),
]

const lockedChildOption = (booking: BookingDetail): ChildPickerOption => ({
  id: booking.child.id,
  label: booking.child.name,
  description: '',
  inactive: false,
  evaluable: false,
})

export const BookingForm = ({
  open,
  onOpenChange,
  onCreated,
  initialChild,
  booking,
  onSaved,
}: BookingFormProps) => {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const isEdit = booking !== undefined

  const [draft, setDraft] = useState<BookingDraft>(EMPTY_DRAFT)
  const [childOption, setChildOption] = useState<ChildPickerOption | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [reactivatedName, setReactivatedName] = useState<string | null>(null)
  const [seenOpen, setSeenOpen] = useState(false)
  const [syncedDetail, setSyncedDetail] = useState<ChildDetail | undefined>(undefined)
  // The booking whose prefill waits for the Staff list (`draftFromDetail` needs the tutor ids).
  const [prefill, setPrefill] = useState<BookingDetail | null>(null)
  // The server returns only the still-unconfirmed codes, so the ones already sent accumulate
  // here and every "Book anyway" resubmits `confirmed ∪ shown`.
  const [shownWarnings, setShownWarnings] = useState<BookingWarning[]>([])
  const [confirmed, setConfirmed] = useState<WarningCode[]>([])
  const submitButton = useRef<HTMLButtonElement>(null)

  if (open !== seenOpen) {
    setSeenOpen(open)

    if (open && booking !== undefined) {
      setPrefill(booking)
      setChildOption(lockedChildOption(booking))
      // The Child is known now, so its homes start loading under the skeleton.
      setDraft({ ...EMPTY_DRAFT, mode: 'edit', kind: booking.kind, childId: booking.child.id })
    } else if (open && initialChild !== undefined) {
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
  const replace = useMutation({
    mutationFn: ({ bookingId, body }: ReplaceInput) => updateBooking(bookingId, body),
    onSuccess: () => {
      for (const key of SAVED_KEYS) {
        queryClient.invalidateQueries({ queryKey: [key] })
      }
    },
  })

  if (prefill !== null && staff.data !== undefined) {
    setDraft(draftFromDetail(prefill, staff.data.items))
    setPrefill(null)
  }

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
  const busy = create.isPending || reactivate.isPending || replace.isPending
  const prefilling = prefill !== null
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
    setPrefill(null)
    clearWarnings()
    reactivate.reset()
    create.reset()
    replace.reset()
    onOpenChange(false)
  }

  const handleOpenChange = (next: boolean) => {
    if (next) {
      onOpenChange(true)
    } else {
      resetAndClose()
    }
  }

  // A 409 with `warnings[]` is confirmable; anything else is a block and renders as an error.
  const handleWriteError = (error: unknown, sent: WarningCode[]) => {
    const warnings = warningsOf(error)

    setConfirmed(warnings === null ? [] : sent)
    setShownWarnings(warnings ?? [])
    refocusSubmit()
  }

  const book = (body: BookingCreate) => {
    create.mutate(body, {
      onSuccess: () => {
        onCreated?.()
        resetAndClose()
      },
      onError: (error) => handleWriteError(error, body.confirm_warnings),
    })
  }

  const save = (bookingId: string, body: BookingReplace) => {
    replace.mutate(
      { bookingId, body },
      {
        onSuccess: () => {
          onSaved?.()
          // Close first so the toast never sits behind the form.
          resetAndClose()
          toast(SAVED_TOAST, { tone: 'success' })
        },
        onError: (error) => handleWriteError(error, body.confirm_warnings),
      },
    )
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitted(true)
    setReactivatedName(null)
    reactivate.reset()
    create.reset()
    replace.reset()

    if (errors.length === 0) {
      const confirming = unionCodes(confirmed, shownWarnings)
      const childName = childOption?.label ?? ''

      if (booking !== undefined) {
        save(booking.id, toUpdateBody(draft, confirming))
      } else if (plan === 'reactivate-then-book') {
        reactivate.mutate(draft.childId, {
          onSuccess: () => {
            setDraft((current) => ({ ...current, childInactive: false }))
            setReactivatedName(childName)
            book(toCreateBody(draft, confirming))
          },
          onError: refocusSubmit,
        })
      } else {
        book(toCreateBody(draft, confirming))
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
  } else if (replace.isError && warningsOf(replace.error) === null) {
    submitError = errorDetail(replace.error) ?? SUBMIT_FALLBACK_ERROR
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
  } else if (isEdit && draft.availabilityId === '') {
    slotHint = fieldHint(EDIT_SLOT_HINT)
  }

  const subjectOptions = subjects.data?.items ?? []
  // The subjects list is the active ones; a booking's Subject retired since stays shown, locked,
  // so the select reads what the save will send.
  const retiredSubject =
    booking !== undefined &&
    booking.subject !== null &&
    draft.subjectId === booking.subject.id &&
    !subjectOptions.some((subject) => subject.id === draft.subjectId)
      ? booking.subject
      : null
  const staffDisabled = busy || staff.isPending || staffOptions.length === 0
  // Kept disabled while the homes load so the list never pops in under an open menu.
  const locationDisabled = busy || childDetail.isPending
  const slotDisabled = busy || slotOptions.length === 0
  // An edit has nothing to submit until the Staff list has filled the draft in. A later
  // background refetch failing keeps the data, so it does not lock the form.
  const submitDisabled = busy || (isEdit && prefilling)

  let body: ReactNode

  if (isEdit && prefilling && staff.isError) {
    body = (
      <div className="space-y-4">
        <p role="alert" className={alertClasses}>
          {STAFF_PREFILL_ERROR}
        </p>
        <Button type="button" variant="outline" onClick={() => staff.refetch()}>
          Try again
        </Button>
      </div>
    )
  } else if (isEdit && prefilling) {
    body = <PrefillSkeleton />
  } else {
    body = (
      <form
        id={FORM_ID}
        onSubmit={handleSubmit}
        className="space-y-4"
        aria-busy={staff.isPending || subjects.isPending}
      >
        <div className="space-y-1.5">
          <SegmentedTabs
            tabs={KIND_TABS}
            value={draft.kind}
            onChange={handleKindChange}
            ariaLabel="Kind"
            panelId={KIND_PANEL_ID}
            disabled={isEdit}
          />
          {isEdit && <p className="text-xs text-muted-foreground">{LOCKED_KIND_HINT}</p>}
        </div>

        <div id={KIND_PANEL_ID} role="tabpanel" className="space-y-4">
          {isEdit ? (
            <LockedField label="Child">{childOption?.label}</LockedField>
          ) : (
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
          )}

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
                {retiredSubject !== null && (
                  <option value={retiredSubject.id} disabled>
                    {retiredSubject.name} (inactive)
                  </option>
                )}
                {subjectOptions.map((subject) => (
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
              maxLength={NOTES_MAX_LENGTH}
              value={draft.notes}
              disabled={busy}
              aria-invalid={isInvalid(DRAFT_ERROR.notes) || undefined}
              onChange={(event) =>
                updateDraft((current) => ({ ...current, notes: event.target.value }))
              }
            />
          </Field>
        </div>
      </form>
    )
  }

  return (
    <SlideOver
      open={open}
      onOpenChange={handleOpenChange}
      title={isEdit ? 'Edit booking' : 'New booking'}
      description={
        isEdit
          ? 'Changes are saved in place; no WhatsApp message is sent.'
          : 'Booked by the Office; no WhatsApp message is sent.'
      }
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
            <Button ref={submitButton} type="submit" form={FORM_ID} disabled={submitDisabled}>
              {submitLabel(draft, warningMessages.length > 0, busy)}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={resetAndClose}>
              Cancel
            </Button>
          </div>
        </div>
      }
    >
      {body}
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

// A value the edit cannot change, read like a `DetailRow`: no input chrome, nothing focusable.
const LockedField = ({ label, children }: { label: string; children: ReactNode }) => (
  <dl>
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  </dl>
)

// Same count and heights as the real fields, so the swap does not shift the footer.
const PrefillSkeleton = () => (
  <div aria-busy="true" className="space-y-4">
    <p className="sr-only">Loading booking…</p>
    {PREFILL_SKELETON_ROWS.map((row) => (
      <div key={row.field} className="space-y-1.5">
        <div className={cn(skeletonBarClasses, 'h-3 w-16')} />
        <div className={cn(skeletonBarClasses, row.barClasses)} />
      </div>
    ))}
  </div>
)
