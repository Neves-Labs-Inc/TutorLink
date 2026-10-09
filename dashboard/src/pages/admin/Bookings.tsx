import { useRef, useState } from 'react'
import { CalendarDays, List, SlidersHorizontal } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import {
  BookingCalendar,
  type BookingCalendarStatus,
} from '@/components/bookings/BookingCalendar'
import { BookingDetailPanel } from '@/components/bookings/BookingDetailPanel'
import { BookingFilterFields } from '@/components/bookings/BookingFilterFields'
import { BookingForm } from '@/components/bookings/BookingForm'
import type { SearchPickerOption } from '@/components/pickers/SearchPicker'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { Pager } from '@/components/shared/Pager'
import { SlideOver } from '@/components/shared/SlideOver'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { errorDetail } from '@/lib/api'
import { locationLabel } from '@/lib/booking-presentation/bookingPresentation'
import SubjectCell from '@/lib/booking-presentation/SubjectCell'
import {
  bookingViewFromSearchParams,
  calendarListParams,
  withBookingView,
  type BookingView,
} from '@/lib/booking-calendar/booking-calendar'
import { childPickerOption } from '@/lib/booking-form/bookingForm'
import {
  activeFilterCount,
  bookingCountLabel,
  bookingFilterSearchParams,
  bookingFiltersFromSearchParams,
  bookingListParams,
  bookingTimeLabel,
  EMPTY_FILTERS,
  type BookingFilterState,
} from '@/lib/bookings/bookings'
import { formatIsoDate, todayLocalIso } from '@/lib/dates/dates'
import { bookingQueries, type Booking } from '@/lib/queries/bookings'
import { childQueries } from '@/lib/queries/children'
import { DEFAULT_PAGE_SIZE } from '@/lib/queries/page'
import { subjectQueries } from '@/lib/queries/subjects'
import { tutorQueries } from '@/lib/queries/tutors'
import { weekStartIso } from '@/lib/tutor-schedule/tutorSchedule'
import { cn } from '@/lib/utils'

const LOAD_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const REFERENCE_PAGE_SIZE = 100

// The incoming view fades in; there is no exit animation.
const viewEnterClasses = 'animate-in fade-in-0 duration-150 ease-out motion-reduce:animate-none'
const toggleClasses =
  'inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px md:min-h-0 md:py-1.5'
const toggleOn = 'bg-primary text-primary-foreground'
const toggleOff = 'text-muted-foreground hover:bg-muted hover:text-foreground'

const queryStatus = (query: { isPending: boolean; isError: boolean }): BookingCalendarStatus =>
  query.isPending ? 'pending' : query.isError ? 'error' : 'ready'

export const Bookings = () => {
  const queryClient = useQueryClient()

  const [searchParams, setSearchParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const [weekStart, setWeekStart] = useState(() => weekStartIso(todayLocalIso(new Date())))
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const showBookingsRef = useRef<HTMLButtonElement>(null)
  const [childOption, setChildOption] = useState<SearchPickerOption | null>(null)

  const filters = bookingFiltersFromSearchParams(searchParams)
  const view = bookingViewFromSearchParams(searchParams)
  const isCalendar = view === 'calendar'
  // From/To are hidden in calendar view, so nothing there counts or clears them.
  const visibleFilters = isCalendar ? { ...filters, from: '', to: '' } : filters

  const bookings = useQuery({
    ...bookingQueries.list({ ...bookingListParams(filters), page, page_size: DEFAULT_PAGE_SIZE }),
    enabled: !isCalendar,
  })
  const week = useQuery({
    ...bookingQueries.week(calendarListParams(filters, weekStart)),
    enabled: isCalendar,
  })
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
    setSearchParams(withBookingView(bookingFilterSearchParams(next), view))
    setPage(1)
  }

  const handleViewChange = (next: BookingView) => {
    setSearchParams(withBookingView(searchParams, next))
  }

  const handleChildChange = (option: SearchPickerOption | null) => {
    setChildOption(option)
    applyFilters({ ...filters, childId: option?.id ?? '' })
  }

  const searchChildren = async (term: string): Promise<SearchPickerOption[]> => {
    const results = await queryClient.fetchQuery(childQueries.list({ q: term, page_size: 20 }))

    return results.items.map((child) => childPickerOption(child, false))
  }

  // Clear all disables itself at 0 filters, so move focus on to keep it inside the panel.
  // In calendar view the hidden From/To survive, so switching back to List restores them.
  const handleClearAll = () => {
    applyFilters(
      isCalendar ? { ...EMPTY_FILTERS, from: filters.from, to: filters.to } : EMPTY_FILTERS,
    )
    setChildOption(null)
    showBookingsRef.current?.focus()
  }

  const filterCount = activeFilterCount(visibleFilters)
  const filtersButtonLabel = filterCount === 0 ? 'Filters' : `Filters, ${filterCount} active`
  const total = isCalendar
    ? week.data?.total
    : bookings.data === undefined || bookings.isPlaceholderData
      ? undefined
      : bookings.data.total
  const showBookingsLabel = total === undefined ? 'Show bookings' : `Show ${bookingCountLabel(total)}`
  const countTotal = isCalendar ? week.data?.total : bookings.data?.total

  const filterFieldProps = {
    filters,
    onChange: applyFilters,
    childOption,
    onChildChange: handleChildChange,
    searchChildren,
    tutors: tutors.data?.items ?? [],
    subjects: subjects.data?.items ?? [],
    showDateRange: !isCalendar,
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
    { id: 'staff', header: 'Staff', cell: (booking) => booking.staff.name },
    { id: 'location', header: 'Location', cell: (booking) => locationLabel(booking) },
    {
      id: 'subject',
      header: 'Subject',
      cell: (booking) => <SubjectCell booking={booking} emptyAs="em" />,
    },
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

      <div className="md:hidden">
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full"
          aria-label={filtersButtonLabel}
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen(true)}
        >
          <SlidersHorizontal data-icon="inline-start" aria-hidden="true" />
          Filters
          {filterCount > 0 && (
            <span
              aria-hidden="true"
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground tabular-nums animate-in fade-in-0 zoom-in-75 duration-150 ease-out motion-reduce:animate-none"
            >
              {filterCount}
            </span>
          )}
        </Button>
      </div>

      <Card className="hidden md:block">
        <CardContent>
          <BookingFilterFields {...filterFieldProps} idPrefix="booking" layout="grid" />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        {countTotal !== undefined && (
          <p className="text-sm text-muted-foreground">{bookingCountLabel(countTotal)}</p>
        )}
        <div
          role="group"
          aria-label="View"
          className="ml-auto inline-flex gap-1 rounded-lg border border-border p-1"
        >
          <button
            type="button"
            aria-pressed={!isCalendar}
            className={cn(toggleClasses, isCalendar ? toggleOff : toggleOn)}
            onClick={() => handleViewChange('list')}
          >
            <List aria-hidden="true" className="size-4" />
            List
          </button>
          <button
            type="button"
            aria-pressed={isCalendar}
            className={cn(toggleClasses, isCalendar ? toggleOn : toggleOff)}
            onClick={() => handleViewChange('calendar')}
          >
            <CalendarDays aria-hidden="true" className="size-4" />
            Calendar
          </button>
        </div>
      </div>

      {isCalendar ? (
        <div key="calendar" className={viewEnterClasses}>
          <BookingCalendar
            weekStart={weekStart}
            onWeekChange={setWeekStart}
            query={{
              status: queryStatus(week),
              bookings: week.data?.items ?? [],
              error: week.error,
              refetch: () => week.refetch(),
            }}
            filtersActive={filterCount > 0}
            onSelect={setSelectedBookingId}
          />
        </div>
      ) : (
        <div key="list" className={cn('space-y-6', viewEnterClasses)}>
          <DataTable
            caption="Bookings"
            columns={columns}
            rows={bookings.data?.items ?? []}
            rowKey={(booking) => booking.id}
            status={queryStatus(bookings)}
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
        </div>
      )}

      <SlideOver
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        title="Filters"
        description="Changes apply right away."
        footer={
          <div className="grid grid-cols-2 gap-3">
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-8"
              disabled={filterCount === 0}
              onClick={handleClearAll}
            >
              Clear all
            </Button>
            <Button
              ref={showBookingsRef}
              type="button"
              className="h-11 md:h-8"
              onClick={() => setFiltersOpen(false)}
            >
              <span aria-live="polite">{showBookingsLabel}</span>
            </Button>
          </div>
        }
      >
        <BookingFilterFields {...filterFieldProps} idPrefix="booking-sheet" layout="stacked" />
      </SlideOver>

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
