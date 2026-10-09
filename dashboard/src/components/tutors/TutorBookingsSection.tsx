import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { DataTable, type Column } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { errorDetail } from '@/lib/api'
import { locationLabel } from '@/lib/booking-presentation/bookingPresentation'
import SubjectCell from '@/lib/booking-presentation/SubjectCell'
import { bookingFilterSearchParams, EMPTY_FILTERS } from '@/lib/bookings/bookings'
import { formatIsoDate, formatTime, todayLocalIso } from '@/lib/dates/dates'
import { bookingQueries, type Booking } from '@/lib/queries/bookings'

// `tutorId` is the teaching profile the bookings query takes; `userId` is the account behind it,
// which the Bookings page's Staff filter (`user_id`) takes.
type TutorBookingsSectionProps = { tutorId: string; userId: string }

const RECENT_PAGE_SIZE = 10
const FALLBACK_ERROR = 'Something went wrong. Please try again.'

const COLUMNS: Column<Booking>[] = [
  {
    id: 'date',
    header: 'Date',
    primary: true,
    cell: (row) => formatIsoDate(row.scheduled_date),
  },
  {
    id: 'time',
    header: 'Time',
    cell: (row) => `${formatTime(row.start_time)} – ${formatTime(row.end_time)}`,
  },
  { id: 'child', header: 'Child', cell: (row) => row.child.name },
  { id: 'location', header: 'Location', cell: (row) => locationLabel(row) },
  { id: 'subject', header: 'Subject', cell: (row) => <SubjectCell booking={row} emptyAs="dash" /> },
  { id: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
]

export const TutorBookingsSection = ({ tutorId, userId }: TutorBookingsSectionProps) => {
  // `GET /api/bookings` orders by `scheduled_date` ascending with no way to reverse it
  // (`booking_service.list_bookings`), so an unfiltered first page would be the tutor's oldest
  // bookings ever. Anchoring at today makes the first page the sessions that are still ahead.
  const { data, isPending, isError, error, refetch } = useQuery(
    bookingQueries.list({
      tutor_id: tutorId,
      from: todayLocalIso(new Date()),
      page_size: RECENT_PAGE_SIZE,
    }),
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming bookings</CardTitle>
        <CardDescription>
          The next {RECENT_PAGE_SIZE} sessions for this tutor, soonest first. Editing happens on the
          bookings page.
        </CardDescription>
        <CardAction>
          <Link
            to={`/bookings?${bookingFilterSearchParams({ ...EMPTY_FILTERS, staffId: userId })}`}
            className="rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            View all
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        <DataTable
          caption="Recent bookings for this tutor"
          columns={COLUMNS}
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          status={isPending ? 'pending' : isError ? 'error' : 'ready'}
          errorMessage={errorDetail(error) ?? FALLBACK_ERROR}
          onRetry={() => refetch()}
          emptyMessage="This tutor has no bookings yet."
        />
      </CardContent>
    </Card>
  )
}
