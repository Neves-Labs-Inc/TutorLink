import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { BookingDetailPanel } from '@/components/bookings/BookingDetailPanel'
import { BookingForm } from '@/components/bookings/BookingForm'
import { SearchPicker, type SearchPickerOption } from '@/components/pickers/SearchPicker'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { Pager } from '@/components/shared/Pager'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { errorDetail } from '@/lib/api'
import { childPickerOption } from '@/lib/booking-form/bookingForm'
import {
  bookingCountLabel,
  bookingFilterSearchParams,
  bookingFiltersFromSearchParams,
  bookingListParams,
  bookingTimeLabel,
  statusLabel,
  STATUS_OPTIONS,
  toggleStatus,
  type BookingFilterState,
} from '@/lib/bookings/bookings'
import { formatIsoDate } from '@/lib/dates/dates'
import { bookingQueries, type Booking } from '@/lib/queries/bookings'
import { childQueries } from '@/lib/queries/children'
import { DEFAULT_PAGE_SIZE } from '@/lib/queries/page'
import { subjectQueries } from '@/lib/queries/subjects'
import { tutorQueries } from '@/lib/queries/tutors'
import { cn } from '@/lib/utils'

const LOAD_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const REFERENCE_PAGE_SIZE = 100
const STATUS_GROUP_LABEL_ID = 'booking-status-filter'

const chipClasses =
  'inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50'
const chipIdleClasses = 'border-border text-muted-foreground hover:text-foreground'
const chipSelectedClasses = 'border-primary bg-primary text-primary-foreground'

export const Bookings = () => {
  const queryClient = useQueryClient()

  const [searchParams, setSearchParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [childOption, setChildOption] = useState<SearchPickerOption | null>(null)

  const filters = bookingFiltersFromSearchParams(searchParams)

  const bookings = useQuery(
    bookingQueries.list({ ...bookingListParams(filters), page, page_size: DEFAULT_PAGE_SIZE }),
  )
  const tutors = useQuery(tutorQueries.list({ page_size: REFERENCE_PAGE_SIZE }))
  const subjects = useQuery(subjectQueries.list({ page_size: REFERENCE_PAGE_SIZE }))
  const filteredChild = useQuery({
    ...childQueries.detail(filters.childId),
    enabled: filters.childId !== '',
  })

  if (filters.childId === '' && childOption !== null) {
    setChildOption(null)
  } else if (filteredChild.data?.id === filters.childId && childOption?.id !== filters.childId) {
    setChildOption(childPickerOption(filteredChild.data, false))
  }

  const applyFilters = (next: BookingFilterState) => {
    setSearchParams(bookingFilterSearchParams(next))
    setPage(1)
  }

  const handleChildChange = (option: SearchPickerOption | null) => {
    setChildOption(option)
    applyFilters({ ...filters, childId: option?.id ?? '' })
  }

  const searchChildren = async (term: string): Promise<SearchPickerOption[]> => {
    const results = await queryClient.fetchQuery(childQueries.list({ q: term, page_size: 20 }))

    return results.items.map((child) => childPickerOption(child, false))
  }

  const columns: Column<Booking>[] = [
    {
      id: 'date',
      header: 'Date',
      primary: true,
      cell: (booking) => formatIsoDate(booking.scheduled_date),
    },
    { id: 'time', header: 'Time', cell: (booking) => bookingTimeLabel(booking) },
    { id: 'child', header: 'Child', cell: (booking) => booking.child.name },
    { id: 'tutor', header: 'Tutor', cell: (booking) => booking.tutor.name },
    { id: 'subject', header: 'Subject', cell: (booking) => booking.subject.name },
    {
      id: 'status',
      header: 'Status',
      cell: (booking) => <StatusBadge status={booking.status} />,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Bookings</h1>
        <Button type="button" onClick={() => setFormOpen(true)}>
          Create Booking
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
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

            <div className="space-y-1.5">
              <Label htmlFor="booking-tutor-filter">Tutor</Label>
              <Select
                id="booking-tutor-filter"
                value={filters.tutorId}
                onChange={(event) => applyFilters({ ...filters, tutorId: event.target.value })}
              >
                <option value="">All tutors</option>
                {(tutors.data?.items ?? []).map((tutor) => (
                  <option key={tutor.id} value={tutor.id}>
                    {tutor.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="booking-subject-filter">Subject</Label>
              <Select
                id="booking-subject-filter"
                value={filters.subjectId}
                onChange={(event) => applyFilters({ ...filters, subjectId: event.target.value })}
              >
                <option value="">All subjects</option>
                {(subjects.data?.items ?? []).map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="booking-child-filter">Child</Label>
              <SearchPicker
                id="booking-child-filter"
                queryKeyPrefix={['children', 'filter']}
                search={searchChildren}
                value={childOption}
                onChange={handleChildChange}
                placeholder="All children"
                emptyMessage="No matching children."
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <span id={STATUS_GROUP_LABEL_ID} className="block text-sm font-medium text-foreground">
              Status
            </span>
            <div
              role="group"
              aria-labelledby={STATUS_GROUP_LABEL_ID}
              className="flex flex-wrap gap-2"
            >
              {STATUS_OPTIONS.map((status) => {
                const selected = filters.statuses.includes(status)

                return (
                  <button
                    key={status}
                    type="button"
                    aria-pressed={selected}
                    onClick={() =>
                      applyFilters({ ...filters, statuses: toggleStatus(filters.statuses, status) })
                    }
                    className={cn(chipClasses, selected ? chipSelectedClasses : chipIdleClasses)}
                  >
                    {statusLabel(status)}
                  </button>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {bookings.data !== undefined && (
        <p className="text-sm text-muted-foreground">{bookingCountLabel(bookings.data.total)}</p>
      )}

      <DataTable
        caption="Bookings"
        columns={columns}
        rows={bookings.data?.items ?? []}
        rowKey={(booking) => booking.id}
        status={bookings.isPending ? 'pending' : bookings.isError ? 'error' : 'ready'}
        errorMessage={errorDetail(bookings.error) ?? LOAD_FALLBACK_ERROR}
        onRetry={() => bookings.refetch()}
        emptyMessage="No bookings match these filters."
        onRowSelect={(booking) => setSelectedBookingId(booking.id)}
      />

      <Pager
        page={page}
        pageSize={DEFAULT_PAGE_SIZE}
        total={bookings.data?.total ?? 0}
        onPageChange={setPage}
        disabled={bookings.isPending}
      />

      <BookingDetailPanel
        bookingId={selectedBookingId}
        onOpenChange={(open) => {
          if (!open) setSelectedBookingId(null)
        }}
      />

      <BookingForm
        open={formOpen}
        onOpenChange={setFormOpen}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ['bookings', 'list'] })}
      />
    </div>
  )
}
