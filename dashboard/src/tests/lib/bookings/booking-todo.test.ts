import { describe, expect, it } from 'vitest'
import type { BookingSummary } from '@/lib/queries/bookings'
import type { ChildSummary } from '@/lib/queries/children'
import { buildBookingTodo } from '@/lib/bookings/booking-todo'

const booking = (
  id: string,
  date: string,
  sortOutReasons: BookingSummary['sort_out_reasons'],
  time = '09:00:00',
): BookingSummary =>
  ({
    id,
    scheduled_date: date,
    start_time: time,
    sort_out_reasons: sortOutReasons,
  }) as BookingSummary

const child = (id: string, createdAt: string): ChildSummary =>
  ({ id, created_at: createdAt }) as ChildSummary

const idsOf = (items: ReturnType<typeof buildBookingTodo>): string[] =>
  items.map((item) => `${item.kind}:${item.kind === 'booking' ? item.booking.id : item.child.id}`)

describe('buildBookingTodo', () => {
  it('orders to-change Bookings, Children needing a Tutor, not-marked Bookings, then Evaluations', () => {
    const todo = buildBookingTodo(
      [
        booking('old-unmarked', '2026-10-01', ['not_completed']),
        booking('later-clash', '2026-10-30', ['time_off_clash']),
        booking('recent-unmarked', '2026-10-15', ['not_completed']),
        booking('sooner-archived', '2026-10-22', ['archived_staff']),
      ],
      [child('n1', '2026-09-01T00:00:00Z'), child('n2', '2026-08-01T00:00:00Z')],
      [child('e-new', '2026-10-10T00:00:00Z'), child('e-old', '2026-09-10T00:00:00Z')],
    )

    expect(idsOf(todo)).toEqual([
      'booking:sooner-archived',
      'booking:later-clash',
      'needs-tutor:n1',
      'needs-tutor:n2',
      'booking:old-unmarked',
      'booking:recent-unmarked',
      'evaluation:e-old',
      'evaluation:e-new',
    ])
  })

  it('counts a Booking with both reasons as one to change, once', () => {
    const both = booking('both', '2026-10-20', ['not_completed', 'time_off_clash'])
    const todo = buildBookingTodo(
      [booking('unmarked', '2026-10-01', ['not_completed']), both],
      [],
      [],
    )

    expect(idsOf(todo)).toEqual(['booking:both', 'booking:unmarked'])
  })

  it('breaks a same-day tie by start time', () => {
    const todo = buildBookingTodo(
      [
        booking('late', '2026-10-20', ['time_off_clash'], '15:00:00'),
        booking('early', '2026-10-20', ['time_off_clash'], '09:00:00'),
      ],
      [],
      [],
    )

    expect(idsOf(todo)).toEqual(['booking:early', 'booking:late'])
  })

  it('does not reorder its inputs', () => {
    const bookings = [
      booking('b', '2026-10-02', ['not_completed']),
      booking('a', '2026-10-01', ['not_completed']),
    ]

    buildBookingTodo(bookings, [], [])

    expect(bookings.map((b) => b.id)).toEqual(['b', 'a'])
  })

  it('is empty with nothing to do', () => {
    expect(buildBookingTodo([], [], [])).toEqual([])
  })
})
