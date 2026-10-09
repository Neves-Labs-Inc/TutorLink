import { dayOfWeekFromIso } from '@/lib/availability/availability'
import { gradeLabel } from '@/lib/children/children'
import type { AvailabilitySlot } from '@/lib/queries/availability'
import type {
  BookingCreate,
  BookingDetail,
  BookingKind,
  BookingReplace,
  WarningCode,
} from '@/lib/queries/bookings'
import type { ChildDetail, ChildHome, ChildSummary } from '@/lib/queries/children'
import type { Staff, StaffRole } from '@/lib/queries/staff'

export type BookingDraft = {
  // Edit mode is ticket 10's; the draft carries it so the body builders can branch on it.
  mode: 'create' | 'edit'
  kind: BookingKind
  childId: string
  childInactive: boolean
  // The Staff member's user id.
  staffId: string
  // From the Staff list; drives `timeSource`.
  staffRole: StaffRole | ''
  // The teaching profile id the slot query takes; null for an Admin or a profile-less Manager.
  staffTutorId: string | null
  // A home id, or `IN_OFFICE`.
  location: string
  subjectId: string
  date: string
  availabilityId: string
  startTime: string
  endTime: string
  notes: string
}

export type ChildPickerOption = {
  id: string
  label: string
  description: string
  inactive: boolean
  // Whether the Child may be given an Evaluation; decides if the pick survives a kind switch.
  evaluable: boolean
}

export type ChildChoice = {
  id: string
  inactive?: boolean
}

export type KindContext = { childEvaluable: boolean }

export type SubmitPlan = 'book' | 'reactivate-then-book'

// Where Start/End come from: an Availability slot, or times the Office types.
export type TimeSource = 'slot' | 'typed'

export const IN_OFFICE = 'in_office' as const

// `api/app/models/booking.py` `NOTES_MAX_LENGTH`; the API refuses longer notes with a 400.
export const NOTES_MAX_LENGTH = 255

export const SLOT_HOME_ONLY_WARNING =
  'This slot is for home visits only; the bot would not offer it at the office.'
export const SLOT_OFFICE_ONLY_WARNING =
  'This slot is for the office only; the bot would not offer it at a home.'

const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]

// The `<optgroup>` order of the Staff select.
export const STAFF_ROLE_ORDER: StaffRole[] = ['tutor', 'manager', 'admin']

export const EMPTY_DRAFT: BookingDraft = {
  mode: 'create',
  kind: 'regular',
  childId: '',
  childInactive: false,
  staffId: '',
  staffRole: '',
  staffTutorId: null,
  location: '',
  subjectId: '',
  date: '',
  availabilityId: '',
  startTime: '',
  endTime: '',
  notes: '',
}

// An Evaluation has no slot; an Admin has no availability; with no Staff picked there is
// nothing to pick a slot from.
export const timeSource = (kind: BookingKind, staffRole: StaffRole | ''): TimeSource =>
  kind === 'regular' && (staffRole === 'tutor' || staffRole === 'manager') ? 'slot' : 'typed'

export const onKindChange = (
  draft: BookingDraft,
  kind: BookingKind,
  context: KindContext,
): BookingDraft => {
  // The kind is immutable on an edit (`PUT` refuses a different one with a 422).
  if (draft.mode === 'edit') return draft

  // A Regular slot needs a teaching profile, so a profile-less Manager is not offered there.
  const keepStaff =
    kind === 'regular'
      ? !(draft.staffRole === 'manager' && draft.staffTutorId === null)
      : draft.staffRole !== 'tutor'

  if (kind === 'regular') {
    return keepStaff
      ? { ...draft, kind }
      : { ...draft, kind, staffId: '', staffRole: '', staffTutorId: null }
  }

  const keepChild = context.childEvaluable

  return {
    ...draft,
    kind,
    childId: keepChild ? draft.childId : '',
    childInactive: keepChild ? draft.childInactive : false,
    staffId: keepStaff ? draft.staffId : '',
    staffRole: keepStaff ? draft.staffRole : '',
    staffTutorId: keepStaff ? draft.staffTutorId : null,
    subjectId: '',
    availabilityId: '',
  }
}

export const onChildChange = (draft: BookingDraft, child: ChildChoice | null): BookingDraft => ({
  ...draft,
  childId: child === null ? '' : child.id,
  childInactive: child?.inactive === true,
  location: '',
})

export const onChildDetail = (draft: BookingDraft, detail: ChildDetail): BookingDraft =>
  detail.id === draft.childId ? { ...draft, childInactive: !detail.is_active } : draft

export const childPickerOption = (
  child: Pick<ChildSummary, 'id' | 'name' | 'grade_level' | 'evaluated'>,
  inactive: boolean,
): ChildPickerOption => ({
  id: child.id,
  label: child.name,
  description: inactive ? `${gradeLabel(child.grade_level)} · inactive` : gradeLabel(child.grade_level),
  inactive,
  evaluable: child.evaluated === null,
})

export const childPickerOptions = (
  active: ChildSummary[],
  inactive: ChildSummary[],
): ChildPickerOption[] => [
  ...active.map((child) => childPickerOption(child, false)),
  ...inactive.map((child) => childPickerOption(child, true)),
]

export const homeOptionsFor = (detail: ChildDetail | undefined): ChildHome[] =>
  detail === undefined ? [] : detail.homes.filter((home) => home.is_active)

// An edit never touches the Child, so an inactive one is left as it is.
export const submitPlan = (draft: BookingDraft): SubmitPlan =>
  draft.childInactive && draft.mode === 'create' ? 'reactivate-then-book' : 'book'

export const onStaffChange = (draft: BookingDraft, staff: Staff | null): BookingDraft => ({
  ...draft,
  staffId: staff === null ? '' : staff.id,
  staffRole: staff === null ? '' : staff.role,
  staffTutorId: staff === null ? null : staff.tutor_id,
  availabilityId: '',
  startTime: '',
  endTime: '',
})

// Evaluation: Managers and Admins. Regular: Tutors, Managers with a teaching profile (a slot
// needs one), Admins.
export const staffOptionsFor = (staff: Staff[], kind: BookingKind): Staff[] =>
  staff.filter((member) => {
    let offered: boolean

    if (member.role === 'tutor') {
      offered = kind === 'regular'
    } else if (member.role === 'manager') {
      offered = kind === 'evaluation' || member.tutor_id !== null
    } else {
      offered = true
    }

    return offered
  })

export const onDateChange = (draft: BookingDraft, date: string): BookingDraft => ({
  ...draft,
  date,
  availabilityId: '',
  startTime: '',
  endTime: '',
})

export const onSlotChange = (
  draft: BookingDraft,
  slot: AvailabilitySlot | null,
): BookingDraft => {
  if (slot === null) return { ...draft, availabilityId: '', startTime: '', endTime: '' }

  // The detail carries no slot, so an edit re-picks it; the booking's own times survive the pick
  // (a time outside the slot comes back as a confirmable warning). Cleared times take the bounds.
  const keepTimes = draft.mode === 'edit' && draft.startTime !== '' && draft.endTime !== ''

  return {
    ...draft,
    availabilityId: slot.id,
    startTime: keepTimes ? draft.startTime : inputTime(slot.start_time),
    endTime: keepTimes ? draft.endTime : inputTime(slot.end_time),
  }
}

export const slotsForDate = (slots: AvailabilitySlot[], isoDate: string): AvailabilitySlot[] => {
  const weekday = dayOfWeekFromIso(isoDate)

  return slots.filter((slot) => slot.is_active && slot.day_of_week === weekday)
}

export const weekdayName = (isoDate: string): string => WEEKDAY_NAMES[dayOfWeekFromIso(isoDate)]

// Client-only (Franklin): listed with the server warnings, never sent. The bot would not offer
// the slot at that Location; the Office may still book it there.
export const slotModeWarning = (
  slot: AvailabilitySlot | undefined,
  location: string,
): string | null => {
  if (slot === undefined || location === '') return null

  let warning: string | null = null

  if (slot.mode === 'traveler' && location === IN_OFFICE) {
    warning = SLOT_HOME_ONLY_WARNING
  } else if (slot.mode === 'only_office' && location !== IN_OFFICE) {
    warning = SLOT_OFFICE_ONLY_WARNING
  }

  return warning
}

// Exported so the form can mark the control each message is about.
export const DRAFT_ERROR = {
  child: 'Choose a child.',
  staff: 'Choose a staff member.',
  location: 'Choose a location.',
  subject: 'Choose a subject.',
  date: 'Choose a date.',
  slot: 'Choose an availability slot.',
  startTime: 'Enter a start time.',
  endTime: 'Enter an end time.',
  order: 'End time must be after start time.',
  notes: `Notes cannot be longer than ${NOTES_MAX_LENGTH} characters.`,
} as const

export const draftErrors = (draft: BookingDraft): string[] => {
  const errors: string[] = []

  if (draft.childId === '') {
    errors.push(DRAFT_ERROR.child)
  }
  if (draft.staffId === '') {
    errors.push(DRAFT_ERROR.staff)
  }
  if (draft.location === '') {
    errors.push(DRAFT_ERROR.location)
  }
  if (draft.kind === 'regular' && draft.subjectId === '') {
    errors.push(DRAFT_ERROR.subject)
  }
  if (draft.date === '') {
    errors.push(DRAFT_ERROR.date)
  }
  if (timeSource(draft.kind, draft.staffRole) === 'slot' && draft.availabilityId === '') {
    errors.push(DRAFT_ERROR.slot)
  }
  if (draft.startTime === '') {
    errors.push(DRAFT_ERROR.startTime)
  }
  if (draft.endTime === '') {
    errors.push(DRAFT_ERROR.endTime)
  }
  if (draft.startTime !== '' && draft.endTime !== '' && draft.endTime <= draft.startTime) {
    errors.push(DRAFT_ERROR.order)
  }
  if (draft.notes.trim().length > NOTES_MAX_LENGTH) {
    errors.push(DRAFT_ERROR.notes)
  }

  return errors
}

// `staffTutorId` comes from the Staff list, which the detail does not carry; `availabilityId` is
// left empty for the slot select to re-pick. The booking's own times are kept as the prefill.
export const draftFromDetail = (detail: BookingDetail, staff: Staff[]): BookingDraft => ({
  mode: 'edit',
  kind: detail.kind,
  childId: detail.child.id,
  childInactive: false,
  staffId: detail.staff.id,
  staffRole: detail.staff.role,
  staffTutorId: staff.find((member) => member.id === detail.staff.id)?.tutor_id ?? null,
  location: detail.home === null ? IN_OFFICE : detail.home.id,
  subjectId: detail.subject === null ? '' : detail.subject.id,
  date: detail.scheduled_date,
  availabilityId: '',
  startTime: inputTime(detail.start_time),
  endTime: inputTime(detail.end_time),
  notes: detail.notes ?? '',
})

// The fields a create and an edit both send, notes aside (the two carry them differently).
const toWriteBody = (
  draft: BookingDraft,
  confirmed: WarningCode[],
): Omit<BookingReplace, 'notes'> => {
  const inOffice = draft.location === IN_OFFICE

  return {
    kind: draft.kind,
    user_id: draft.staffId,
    location: inOffice ? 'in_office' : 'home',
    home_id: inOffice ? null : draft.location,
    subject_id: draft.kind === 'regular' ? draft.subjectId : null,
    availability_id:
      timeSource(draft.kind, draft.staffRole) === 'slot' ? draft.availabilityId : null,
    scheduled_date: draft.date,
    start_time: draft.startTime,
    end_time: draft.endTime,
    confirm_warnings: confirmed,
  }
}

export const toCreateBody = (draft: BookingDraft, confirmed: WarningCode[]): BookingCreate => {
  const notes = draft.notes.trim()
  const body: BookingCreate = { child_id: draft.childId, ...toWriteBody(draft, confirmed) }

  if (notes !== '') {
    body.notes = notes
  }

  return body
}

// `PUT` refuses `child_id` and `booked_by_guardian_id` (`extra="forbid"`). Notes are always
// named: blank ones go as `null`, which clears them; an omitted key would keep the old notes.
export const toUpdateBody = (draft: BookingDraft, confirmed: WarningCode[]): BookingReplace => {
  const notes = draft.notes.trim()

  return { ...toWriteBody(draft, confirmed), notes: notes === '' ? null : notes }
}

export const submitLabel = (draft: BookingDraft, hasWarnings: boolean, busy: boolean): string => {
  const reactivating = submitPlan(draft) === 'reactivate-then-book'
  let label: string

  if (draft.mode === 'edit' && busy) {
    label = 'Saving…'
  } else if (draft.mode === 'edit') {
    label = hasWarnings ? 'Save anyway' : 'Save changes'
  } else if (busy) {
    label = reactivating ? 'Reactivating…' : 'Creating…'
  } else if (hasWarnings) {
    label = 'Book anyway'
  } else if (reactivating) {
    label = 'Reactivate and book'
  } else {
    label = 'Create booking'
  }

  return label
}

export const inputTime = (hms: string): string => hms.slice(0, 5)
