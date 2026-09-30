import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { BookingDetailPanel } from '@/components/bookings/BookingDetailPanel'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { Pager } from '@/components/shared/Pager'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorDetail } from '@/lib/api'
import { formatIsoDate, formatTime } from '@/lib/dates/dates'
import type { Booking, BookingListParams } from '@/lib/queries/bookings'
import { guardianQueries } from '@/lib/queries/guardians'
import { DEFAULT_PAGE_SIZE } from '@/lib/queries/page'

type GuardianBookingsSectionProps = { guardianId: string }

type HistoryFilters = {
  status: Booking['status'][]
  from: string
  to: string
}

const EMPTY_FILTERS: HistoryFilters = { status: [], from: '', to: '' }
const STATUS_OPTIONS: Booking['status'][] = ['pending', 'confirmed', 'completed', 'cancelled']

const COLUMNS: Column<Booking>[] = [
  {
    id: 'date',
    header: 'Date',
    primary: true,
    cell: (booking) => formatIsoDate(booking.scheduled_date),
  },
  {
    id: 'time',
    header: 'Time',
    cell: (booking) => `${formatTime(booking.start_time)} – ${formatTime(booking.end_time)}`,
  },
  { id: 'child', header: 'Child', cell: (booking) => booking.child.name },
  { id: 'tutor', header: 'Tutor', cell: (booking) => booking.tutor.name },
  { id: 'subject', header: 'Subject', cell: (booking) => booking.subject.name },
  { id: 'status', header: 'Status', cell: (booking) => <StatusBadge status={booking.status} /> },
]

export const GuardianBookingsSection = ({ guardianId }: GuardianBookingsSectionProps) => {
  const [filters, setFilters] = useState<HistoryFilters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null)

  const params: BookingListParams = {
    status: filters.status,
    from: filters.from === '' ? undefined : filters.from,
    to: filters.to === '' ? undefined : filters.to,
    page,
  }
  const { data, isPending, isError, error, refetch } = useQuery(
    guardianQueries.bookings(guardianId, params),
  )

  const applyFilters = (next: HistoryFilters) => {
    setFilters(next)
    setPage(1)
  }

  const toggleStatus = (status: Booking['status']) =>
    applyFilters({
      ...filters,
      status: filters.status.includes(status)
        ? filters.status.filter((value) => value !== status)
        : [...filters.status, status],
    })

  return (
    <section aria-labelledby="booking-history-heading" className="space-y-3">
      <h2 id="booking-history-heading" className="font-heading text-lg font-semibold tracking-tight">
        Booking history
      </h2>
      <Card>
        <CardContent className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-muted-foreground">Status</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {STATUS_OPTIONS.map((status) => (
                <div key={status} className="flex items-center gap-2">
                  <input
                    id={`booking-status-${status}`}
                    type="checkbox"
                    className="size-4 rounded-sm border-input accent-primary"
                    checked={filters.status.includes(status)}
                    onChange={() => toggleStatus(status)}
                  />
                  <Label htmlFor={`booking-status-${status}`} className="capitalize">
                    {status}
                  </Label>
                </div>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="booking-from">From</Label>
              <Input
                id="booking-from"
                type="date"
                value={filters.from}
                onChange={(event) => applyFilters({ ...filters, from: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="booking-to">To</Label>
              <Input
                id="booking-to"
                type="date"
                value={filters.to}
                onChange={(event) => applyFilters({ ...filters, to: event.target.value })}
              />
            </div>
          </div>
        </CardContent>
      </Card>
      <DataTable
        caption="Bookings across every child linked to this guardian"
        columns={COLUMNS}
        rows={data?.items ?? []}
        rowKey={(booking) => booking.id}
        status={isPending ? 'pending' : isError ? 'error' : 'ready'}
        errorMessage={errorDetail(error)}
        onRetry={() => refetch()}
        emptyMessage="No bookings match these filters."
        onRowSelect={(booking) => setSelectedBookingId(booking.id)}
      />
      <Pager
        page={page}
        pageSize={data?.page_size ?? DEFAULT_PAGE_SIZE}
        total={data?.total ?? 0}
        onPageChange={setPage}
        disabled={isPending}
      />
      <BookingDetailPanel
        bookingId={selectedBookingId}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedBookingId(null)
            refetch()
          }
        }}
      />
    </section>
  )
}
