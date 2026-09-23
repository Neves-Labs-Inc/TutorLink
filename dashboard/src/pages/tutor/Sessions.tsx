import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { TutorLinkMissing } from '@/components/layout/TutorLinkMissing'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { Pager } from '@/components/shared/Pager'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { SessionDetailPanel } from '@/components/tutor/SessionDetailPanel'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'
import { errorDetail } from '@/lib/api'
import { bookingTimeLabel } from '@/lib/bookings/bookings'
import { formatIsoDate, todayLocalIso } from '@/lib/dates/dates'
import { bookingQueries, type Booking } from '@/lib/queries/bookings'
import { DEFAULT_PAGE_SIZE } from '@/lib/queries/page'
import {
  filterByChildName,
  searchHintLabel,
  sessionFilterSearchParams,
  sessionFiltersFromSearchParams,
  sessionListParams,
  windowLabel,
  type SessionFilterState,
  type SessionTab,
} from '@/lib/tutor-sessions/tutorSessions'
import { cn } from '@/lib/utils'

const LOAD_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const TAB_GROUP_LABEL_ID = 'session-tab-filter'
const SEARCH_HINT = 'Filters the sessions on this page, not the whole history.'

const TABS: { value: SessionTab; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
]

const chipClasses =
  'inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50'
const chipIdleClasses = 'border-border text-muted-foreground hover:text-foreground'
const chipSelectedClasses = 'border-primary bg-primary text-primary-foreground'

// The status column is on both tabs, not just Past (divergence D-P6-1): Past is bounded at
// yesterday, so a cancelled *future* session would otherwise appear on neither, and the badge is
// the only notice of a cancellation a tutor gets.
const columns: Column<Booking>[] = [
  {
    id: 'date',
    header: 'Date',
    primary: true,
    cell: (booking) => formatIsoDate(booking.scheduled_date),
  },
  { id: 'time', header: 'Time', cell: (booking) => bookingTimeLabel(booking) },
  { id: 'child', header: 'Child', cell: (booking) => booking.child.name },
  { id: 'subject', header: 'Subject', cell: (booking) => booking.subject.name },
  {
    id: 'status',
    header: 'Status',
    cell: (booking) => <StatusBadge status={booking.status} />,
  },
]

export const Sessions = () => {
  const { tutorId } = useAuth()
  // A tutor account with no linked tutor row is a 403 data error server-side
  // (`dependencies.py:196-226`). It renders as an explained empty state and the list never mounts,
  // so no request is issued at all (OQ-21).
  const content: ReactNode = tutorId === null ? <TutorLinkMissing /> : <SessionList />

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">My Sessions</h1>
      {content}
    </div>
  )
}

const SessionList = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null)

  const filters = sessionFiltersFromSearchParams(searchParams)
  // No `tutor_id` is sent: `GET /api/bookings` takes `TutorScope` and scopes a tutor to themself
  // (decision P6-H). Sending an id the server derives anyway only creates somewhere for the wrong
  // id to come from.
  const params = sessionListParams(filters, todayLocalIso(new Date()))
  const sessions = useQuery(bookingQueries.list({ ...params, page, page_size: DEFAULT_PAGE_SIZE }))

  const held = sessions.data?.items ?? []
  const rows = filterByChildName(held, filters.q)
  const searching = filters.q.trim() !== ''

  const applyFilters = (next: SessionFilterState) => {
    setSearchParams(sessionFilterSearchParams(next))
    setPage(1)
  }

  // The term is replaced rather than pushed: a keystroke is not a navigation step, and pushing one
  // per character buries the entry the tutor arrived on.
  const applySearch = (q: string) => {
    setSearchParams(sessionFilterSearchParams({ ...filters, q }), { replace: true })
    setPage(1)
  }

  const emptyMessage = searching
    ? 'No sessions on this page match that name.'
    : 'No sessions in this window.'

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <span id={TAB_GROUP_LABEL_ID} className="block text-sm font-medium text-foreground">
          Show
        </span>
        <div role="group" aria-labelledby={TAB_GROUP_LABEL_ID} className="flex flex-wrap gap-2">
          {TABS.map((tab) => {
            const selected = filters.tab === tab.value

            return (
              <button
                key={tab.value}
                type="button"
                aria-pressed={selected}
                // Switching tabs drops the dates so the new tab opens on its own default window,
                // rather than inheriting a range that was widened for the other one.
                onClick={() => applyFilters({ ...filters, tab: tab.value, from: '', to: '' })}
                className={cn(chipClasses, selected ? chipSelectedClasses : chipIdleClasses)}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      <Card>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="session-from">From</Label>
              <Input
                id="session-from"
                type="date"
                value={filters.from}
                onChange={(event) => applyFilters({ ...filters, from: event.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="session-to">To</Label>
              <Input
                id="session-to"
                type="date"
                value={filters.to}
                onChange={(event) => applyFilters({ ...filters, to: event.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="session-search">Search this page by child name</Label>
              <Input
                id="session-search"
                type="search"
                value={filters.q}
                placeholder="Child name"
                aria-describedby="session-search-hint"
                onChange={(event) => applySearch(event.target.value)}
              />
              <p id="session-search-hint" className="text-xs text-muted-foreground">
                {SEARCH_HINT}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">{windowLabel(params)}</p>
        {searching && sessions.data !== undefined && (
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {searchHintLabel(rows.length, held.length)}
          </p>
        )}
      </div>

      <DataTable
        caption="My sessions"
        columns={columns}
        rows={rows}
        rowKey={(booking) => booking.id}
        status={sessions.isPending ? 'pending' : sessions.isError ? 'error' : 'ready'}
        errorMessage={errorDetail(sessions.error) ?? LOAD_FALLBACK_ERROR}
        onRetry={() => sessions.refetch()}
        emptyMessage={emptyMessage}
        onRowSelect={(booking) => setSelectedBookingId(booking.id)}
      />

      {/* The total is the server's count of the windowed query; the name search narrows the rows
          on screen and leaves it alone, which is what `searchHintLabel` says out loud. */}
      <Pager
        page={page}
        pageSize={DEFAULT_PAGE_SIZE}
        total={sessions.data?.total ?? 0}
        onPageChange={setPage}
        disabled={sessions.isPending}
      />

      <SessionDetailPanel
        bookingId={selectedBookingId}
        onClose={() => setSelectedBookingId(null)}
      />
    </div>
  )
}
