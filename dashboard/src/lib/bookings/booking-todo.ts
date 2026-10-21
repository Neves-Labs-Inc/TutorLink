import type { BookingSummary } from '@/lib/queries/bookings'
import type { ChildSummary } from '@/lib/queries/children'

// One row of To do's Bookings group: a Booking needing a decision, a Child no Tutor is assigned
// to, or a Child whose Evaluation is not booked yet.
export type BookingTodoItem =
  | { kind: 'booking'; booking: BookingSummary }
  | { kind: 'needs-tutor'; child: ChildSummary }
  | { kind: 'evaluation'; child: ChildSummary }

// "Not marked" alone is the lesser job; a clash or an archived Staff member means the Booking
// must change.
const isToChange = (booking: BookingSummary): boolean =>
  booking.sort_out_reasons.some(
    (reason) => reason === 'time_off_clash' || reason === 'archived_staff',
  )

const byStart = (a: BookingSummary, b: BookingSummary): number =>
  `${a.scheduled_date}${a.start_time}`.localeCompare(`${b.scheduled_date}${b.start_time}`)

// Bookings to change (soonest first), Children needing a Tutor (API order), Bookings only not
// marked (oldest first), then Evaluations to book (longest waiting first). Each Booking lands
// in exactly one group.
export const buildBookingTodo = (
  bookings: BookingSummary[],
  needingTutor: ChildSummary[],
  awaitingEvaluation: ChildSummary[],
): BookingTodoItem[] => {
  const byDate = [...bookings].sort(byStart)
  const oldestFirst = [...awaitingEvaluation].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  )

  return [
    ...byDate.filter(isToChange).map((booking): BookingTodoItem => ({ kind: 'booking', booking })),
    ...needingTutor.map((child): BookingTodoItem => ({
      kind: 'needs-tutor',
      child,
    })),
    ...byDate
      .filter((booking) => !isToChange(booking))
      .map((booking): BookingTodoItem => ({ kind: 'booking', booking })),
    ...oldestFirst.map((child): BookingTodoItem => ({
      kind: 'evaluation',
      child,
    })),
  ]
}
