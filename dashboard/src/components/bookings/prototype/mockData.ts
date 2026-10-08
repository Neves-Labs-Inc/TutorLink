// PROTOTYPE (wayfinder #131) — throwaway. In-memory mock data and rules for the booking-form
// variants on /bookings?variant=A|B|C. Nothing here talks to the API.

export type StaffRole = 'tutor' | 'manager' | 'admin'
export type BookingKind = 'regular' | 'evaluation'
export type MockStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed'
// How a slot may be worked: the tutor travels to the home, works in office, or either.
export type SlotRange = 'traveler_only' | 'office_only' | 'either'

export type Slot = { id: string; weekday: number; start: string; end: string; range: SlotRange }
export type Staff = { id: string; name: string; role: StaffRole; slots: Slot[]; subjects: string[] }
export type Home = { id: string; label: string | null; address: string; accessCode: string }
export type Child = { id: string; name: string; grade: number; evaluated: boolean; homes: Home[] }

export type MockBooking = {
  id: string
  kind: BookingKind
  childId: string
  staffId: string
  // A home id, or 'office' for In office.
  locationId: string
  subject: string | null
  date: string
  start: string
  end: string
  status: MockStatus
  notes: string | null
}

export const OFFICE = 'office'
export const ROLE_LABEL: Record<StaffRole, string> = {
  tutor: 'Tutor',
  manager: 'Manager',
  admin: 'Admin',
}
export const SUBJECTS = ['Math', 'Reading', 'Science', 'Writing']

// weekday: 0 = Sunday … 6 = Saturday
export const STAFF: Staff[] = [
  {
    id: 's-ana',
    name: 'Ana Souza',
    role: 'tutor',
    subjects: ['Math', 'Science'],
    slots: [
      { id: 'sl-ana-mon', weekday: 1, start: '15:00', end: '16:00', range: 'either' },
      { id: 'sl-ana-wed', weekday: 3, start: '16:00', end: '17:00', range: 'office_only' },
    ],
  },
  {
    id: 's-ben',
    name: 'Ben Carter',
    role: 'tutor',
    subjects: ['Reading', 'Writing'],
    // Traveler-only: picking In office with one of these slots shows the warning.
    slots: [
      { id: 'sl-ben-tue', weekday: 2, start: '15:30', end: '16:30', range: 'traveler_only' },
      { id: 'sl-ben-thu', weekday: 4, start: '17:00', end: '18:00', range: 'traveler_only' },
    ],
  },
  {
    id: 's-mia',
    name: 'Mia Lopez',
    role: 'manager',
    subjects: ['Math', 'Reading'],
    slots: [
      { id: 'sl-mia-mon', weekday: 1, start: '10:00', end: '11:00', range: 'either' },
      { id: 'sl-mia-fri', weekday: 5, start: '14:00', end: '15:00', range: 'traveler_only' },
    ],
  },
  {
    id: 's-raj',
    name: 'Raj Patel',
    role: 'manager',
    subjects: ['Science', 'Writing'],
    slots: [{ id: 'sl-raj-thu', weekday: 4, start: '09:00', end: '10:00', range: 'either' }],
  },
  { id: 's-eve', name: 'Eve Martin', role: 'admin', subjects: [], slots: [] },
  { id: 's-tom', name: 'Tom Nguyen', role: 'admin', subjects: [], slots: [] },
]

export const CHILDREN: Child[] = [
  {
    id: 'c-lily',
    name: 'Lily Chen',
    grade: 3,
    evaluated: true,
    homes: [
      { id: 'h-lily-1', label: 'Mom', address: '12 Oak St', accessCode: '4411' },
      { id: 'h-lily-2', label: 'Dad', address: '80 Pine Ave, Apt 3', accessCode: '9020' },
    ],
  },
  {
    id: 'c-noah',
    name: 'Noah Smith',
    grade: 5,
    evaluated: true,
    homes: [{ id: 'h-noah-1', label: null, address: '5 Birch Rd', accessCode: '1234' }],
  },
  {
    id: 'c-ava',
    name: 'Ava Rossi',
    grade: 2,
    evaluated: false,
    homes: [{ id: 'h-ava-1', label: null, address: '221 Elm St', accessCode: '7788' }],
  },
  {
    id: 'c-leo',
    name: 'Leo Kim',
    grade: 7,
    evaluated: false,
    homes: [
      { id: 'h-leo-1', label: 'Main', address: '9 Cedar Ct', accessCode: '3300' },
      { id: 'h-leo-2', label: 'Grandma', address: '47 Maple Dr', accessCode: '0042' },
    ],
  },
  {
    id: 'c-zoe',
    name: 'Zoe Brown',
    grade: 4,
    evaluated: false,
    homes: [{ id: 'h-zoe-1', label: null, address: '3 Willow Ln', accessCode: '5150' }],
  },
]

export const INITIAL_BOOKINGS: MockBooking[] = [
  {
    id: 'b-1',
    kind: 'regular',
    childId: 'c-lily',
    staffId: 's-ana',
    locationId: 'h-lily-1',
    subject: 'Math',
    date: '2026-10-12',
    start: '15:00',
    end: '16:00',
    status: 'confirmed',
    notes: null,
  },
  {
    id: 'b-2',
    kind: 'regular',
    childId: 'c-noah',
    staffId: 's-ana',
    locationId: OFFICE,
    subject: 'Science',
    date: '2026-10-14',
    start: '16:00',
    end: '17:00',
    status: 'pending',
    notes: null,
  },
  {
    id: 'b-3',
    kind: 'evaluation',
    childId: 'c-ava',
    staffId: 's-mia',
    locationId: OFFICE,
    subject: null,
    date: '2026-10-13',
    start: '11:00',
    end: '12:00',
    status: 'confirmed',
    notes: 'First visit.',
  },
  {
    id: 'b-4',
    kind: 'regular',
    childId: 'c-lily',
    staffId: 's-eve',
    locationId: 'h-lily-2',
    subject: 'Reading',
    date: '2026-10-15',
    start: '18:00',
    end: '19:00',
    status: 'confirmed',
    notes: 'Admin covering.',
  },
  {
    id: 'b-5',
    kind: 'evaluation',
    childId: 'c-leo',
    staffId: 's-tom',
    locationId: 'h-leo-2',
    subject: null,
    date: '2026-09-30',
    start: '10:00',
    end: '11:00',
    status: 'cancelled',
    notes: null,
  },
]

export const staffById = (id: string) => STAFF.find((staff) => staff.id === id)
export const childById = (id: string) => CHILDREN.find((child) => child.id === id)

export const staffLabel = (staff: Staff) => `${staff.name} (${ROLE_LABEL[staff.role]})`

export const locationLabel = (locationId: string, child?: Child): string => {
  if (locationId === OFFICE) return 'In office'
  const home = child?.homes.find((candidate) => candidate.id === locationId)
  if (home === undefined) return '—'
  return home.label === null ? home.address : `${home.label} — ${home.address}`
}

export const canRunEvaluation = (staff: Staff | undefined) =>
  staff !== undefined && (staff.role === 'admin' || staff.role === 'manager')

// Admins have no availability: they (and every Evaluation) use typed times.
export const usesTypedTimes = (kind: BookingKind, staff: Staff | undefined) =>
  kind === 'evaluation' || staff?.role === 'admin'

const isLive = (booking: MockBooking) =>
  booking.status === 'pending' || booking.status === 'confirmed'

export const hasLiveEvaluation = (childId: string, bookings: MockBooking[]) =>
  bookings.some((b) => b.kind === 'evaluation' && b.childId === childId && isLive(b))

// Children an Evaluation may be booked for: not Evaluated and no live Evaluation already.
export const evaluableChildren = (bookings: MockBooking[]) =>
  CHILDREN.filter((child) => !child.evaluated && !hasLiveEvaluation(child.id, bookings))

const fmtTime = (hm: string) => {
  const [hour, minute] = hm.split(':').map(Number)
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`
}

export const timeLabel = (booking: MockBooking) => `${fmtTime(booking.start)} – ${fmtTime(booking.end)}`

export const weekdayOf = (iso: string) => new Date(`${iso}T00:00:00`).getDay()

export const slotsFor = (staff: Staff | undefined, date: string) =>
  staff === undefined || date === '' ? [] : staff.slots.filter((s) => s.weekday === weekdayOf(date))

export const RANGE_LABEL: Record<SlotRange, string> = {
  traveler_only: 'travels only',
  office_only: 'office only',
  either: 'home or office',
}

export type Draft = {
  kind: BookingKind
  childId: string
  staffId: string
  locationId: string
  subject: string
  date: string
  slotId: string
  start: string
  end: string
  notes: string
}

export const EMPTY_DRAFT: Draft = {
  kind: 'regular',
  childId: '',
  staffId: '',
  locationId: '',
  subject: '',
  date: '',
  slotId: '',
  start: '',
  end: '',
  notes: '',
}

const todayIso = () => {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export type Check = { errors: string[]; warnings: string[] }

// Mirrors the decided rules from #129. Gap / time-off / grade-ceiling are server checks in the
// real flow; here they are only named so the UI can say they apply.
export const checkDraft = (draft: Draft, bookings: MockBooking[]): Check => {
  const errors: string[] = []
  const warnings: string[] = []
  const child = childById(draft.childId)
  const staff = staffById(draft.staffId)
  const slot = staff?.slots.find((s) => s.id === draft.slotId)
  const typed = usesTypedTimes(draft.kind, staff)

  if (child === undefined) errors.push('Choose a child.')
  if (staff === undefined) errors.push('Choose a staff member.')
  if (draft.locationId === '') errors.push('Choose a location.')
  if (draft.date === '') errors.push('Choose a date.')
  else if (draft.date < todayIso()) errors.push('The date must be in the future.')

  if (draft.kind === 'evaluation') {
    if (child?.evaluated) errors.push(`${child.name} is already Evaluated.`)
    else if (child !== undefined && hasLiveEvaluation(child.id, bookings))
      errors.push(`${child.name} already has a live Evaluation.`)
    if (staff !== undefined && !canRunEvaluation(staff))
      errors.push('An Evaluation needs an Admin or a Manager.')
  } else if (draft.subject === '') {
    errors.push('Choose a subject.')
  }

  const start = typed ? draft.start : (slot?.start ?? '')
  const end = typed ? draft.end : (slot?.end ?? '')

  if (typed) {
    if (draft.start === '' || draft.end === '') errors.push('Enter a start and end time.')
    else if (draft.end <= draft.start) errors.push('End time must be after start time.')
  } else if (slot === undefined) {
    errors.push('Choose an availability slot.')
  }

  if (staff !== undefined && draft.date !== '' && start !== '' && end !== '') {
    const clash = bookings.find(
      (b) =>
        b.staffId === staff.id &&
        isLive(b) &&
        b.date === draft.date &&
        b.start < end &&
        start < b.end,
    )
    if (clash !== undefined)
      errors.push(`${staff.name} already has a booking ${clash.start}–${clash.end} that day.`)
  }

  if (draft.locationId === OFFICE && slot?.range === 'traveler_only')
    warnings.push(
      `${staff?.name}'s availability for this slot is traveler-only. In office is allowed from the dashboard, but it is outside their range.`,
    )

  return { errors, warnings }
}

let nextId = 100

export const toBooking = (draft: Draft): MockBooking => {
  const staff = staffById(draft.staffId)
  const slot = staff?.slots.find((s) => s.id === draft.slotId)
  const typed = usesTypedTimes(draft.kind, staff)

  nextId += 1

  return {
    id: `b-${nextId}`,
    kind: draft.kind,
    childId: draft.childId,
    staffId: draft.staffId,
    locationId: draft.locationId,
    subject: draft.kind === 'evaluation' ? null : draft.subject,
    date: draft.date,
    start: typed ? draft.start : (slot?.start ?? ''),
    end: typed ? draft.end : (slot?.end ?? ''),
    // Evaluations are created Confirmed; admin-created Regular bookings too.
    status: 'confirmed',
    notes: draft.notes === '' ? null : draft.notes,
  }
}
