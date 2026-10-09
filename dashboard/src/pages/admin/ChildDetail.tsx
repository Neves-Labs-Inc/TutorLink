import { useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'

import { BookingDetailPanel } from '@/components/bookings/BookingDetailPanel'
import { BookingForm } from '@/components/bookings/BookingForm'
import { ChildDetailSkeleton } from '@/components/children/ChildDetailSkeleton'
import { ChildEvaluationSection } from '@/components/children/ChildEvaluationSection'
import { ChildLinksSection } from '@/components/children/ChildLinksSection'
import { EditChildSlideOver } from '@/components/children/EditChildSlideOver'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { Pager } from '@/components/shared/Pager'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorDetail } from '@/lib/api'
import { locationLabel } from '@/lib/booking-presentation/bookingPresentation'
import SubjectCell from '@/lib/booking-presentation/SubjectCell'
import {
  backToChildrenPath,
  bookingBlockedReason,
  bookButtonLabel,
  childSessionParams,
  EMPTY_CHILD_SESSION_STATE,
  isNotFoundError,
  type ChildSessionState,
} from '@/lib/child-detail/childDetail'
import { OVERALL_GRADE_HINT, OVERALL_GRADE_LABEL } from '@/lib/child-evaluation/childEvaluation'
import { formatDateOfBirth, gradeLabel } from '@/lib/children/children'
import { formatIsoDate, formatTime, todayLocalIso } from '@/lib/dates/dates'
import type { Booking } from '@/lib/queries/bookings'
import { bookingQueries } from '@/lib/queries/bookings'
import { childQueries } from '@/lib/queries/children'
import { DEFAULT_PAGE_SIZE } from '@/lib/queries/page'
import type { SessionTab } from '@/lib/tutor-sessions/tutorSessions'

type DetailFieldProps = { label: string; children: ReactNode }

const FALLBACK_ERROR = 'Something went wrong. Please try again.'
const NOT_FOUND_MESSAGE = 'Child not found'

const SESSION_TABS: { value: SessionTab; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
]

const COLUMNS: Column<Booking>[] = [
  { id: 'date', header: 'Date', primary: true, cell: (booking) => formatIsoDate(booking.scheduled_date) },
  {
    id: 'time',
    header: 'Time',
    cell: (booking) => `${formatTime(booking.start_time)} – ${formatTime(booking.end_time)}`,
  },
  { id: 'staff', header: 'Staff', cell: (booking) => booking.staff.name },
  { id: 'location', header: 'Location', cell: (booking) => locationLabel(booking) },
  {
    id: 'subject',
    header: 'Subject',
    cell: (booking) => <SubjectCell booking={booking} emptyAs="dash" />,
  },
  { id: 'status', header: 'Status', cell: (booking) => <StatusBadge status={booking.status} /> },
]

export const ChildDetail = () => {
  const { id = '' } = useParams()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { data, isPending, isError, error, refetch } = useQuery(childQueries.detail(id))

  const [editOpen, setEditOpen] = useState(false)
  const [bookOpen, setBookOpen] = useState(false)
  const [sessionState, setSessionState] = useState<ChildSessionState>(EMPTY_CHILD_SESSION_STATE)
  const [page, setPage] = useState(1)
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null)

  const today = todayLocalIso(new Date())
  const bookings = useQuery({
    ...bookingQueries.list(childSessionParams(id, sessionState, page, today)),
    enabled: data !== undefined,
  })

  const initialChild = useMemo(
    () => (data ? { id: data.id, name: data.name } : undefined),
    [data],
  )

  const changeTab = (tab: SessionTab) => {
    setSessionState({ tab, from: '', to: '' })
    setPage(1)
  }

  const changeFrom = (from: string) => {
    setSessionState((current) => ({ ...current, from }))
    setPage(1)
  }

  const changeTo = (to: string) => {
    setSessionState((current) => ({ ...current, to }))
    setPage(1)
  }

  const invalidateAfterBooking = () => {
    queryClient.invalidateQueries({ queryKey: ['bookings'] })
    queryClient.invalidateQueries({ queryKey: ['children'] })
  }

  let content: ReactNode

  if (isPending) {
    content = <ChildDetailSkeleton />
  } else if (isError) {
    content = (
      <Card>
        <CardContent className="space-y-4">
          <p role="alert" className="text-sm font-medium text-destructive">
            {isNotFoundError(error) ? NOT_FOUND_MESSAGE : errorDetail(error) ?? FALLBACK_ERROR}
          </p>
          {!isNotFoundError(error) && (
            <Button type="button" variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          )}
        </CardContent>
      </Card>
    )
  } else {
    const child = data
    const blockedReason = bookingBlockedReason(child)

    content = (
      <>
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardAction>
              <Button type="button" size="sm" onClick={() => setEditOpen(true)}>
                Edit
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <DetailField label="Date of birth">
                {formatDateOfBirth(child.date_of_birth, new Date())}
              </DetailField>
              <DetailField label={OVERALL_GRADE_LABEL}>
                {gradeLabel(child.grade_level)}
                <span className="block text-xs text-muted-foreground">{OVERALL_GRADE_HINT}</span>
              </DetailField>
              <DetailField label="School">{child.school_name}</DetailField>
              <DetailField label="Notes">{child.notes ?? '—'}</DetailField>
            </dl>
          </CardContent>
        </Card>

        <ChildEvaluationSection child={child} />

        <ChildLinksSection childId={id} />

        <section aria-labelledby="sessions-heading" className="space-y-3">
          <h2 id="sessions-heading" className="font-heading text-lg font-semibold tracking-tight">
            Sessions
          </h2>
          <div className="inline-flex gap-1 rounded-lg border border-border p-1" role="tablist">
            {SESSION_TABS.map((entry) => (
              <button
                key={entry.value}
                type="button"
                role="tab"
                aria-selected={sessionState.tab === entry.value}
                onClick={() => changeTab(entry.value)}
                className={
                  sessionState.tab === entry.value
                    ? 'rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground'
                    : 'rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground'
                }
              >
                {entry.label}
              </button>
            ))}
          </div>
          <Card>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="session-from">From</Label>
                <Input
                  id="session-from"
                  type="date"
                  value={sessionState.from}
                  onChange={(event) => changeFrom(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="session-to">To</Label>
                <Input
                  id="session-to"
                  type="date"
                  value={sessionState.to}
                  onChange={(event) => changeTo(event.target.value)}
                />
              </div>
            </CardContent>
          </Card>
          <DataTable
            caption={`${sessionState.tab === 'upcoming' ? 'Upcoming' : 'Past'} sessions for this child`}
            columns={COLUMNS}
            rows={bookings.data?.items ?? []}
            rowKey={(booking) => booking.id}
            status={bookings.isPending ? 'pending' : bookings.isError ? 'error' : 'ready'}
            errorMessage={errorDetail(bookings.error)}
            onRetry={() => bookings.refetch()}
            emptyMessage={
              sessionState.tab === 'upcoming' ? 'No upcoming sessions.' : 'No past sessions in this window.'
            }
            onRowSelect={(booking) => setSelectedBookingId(booking.id)}
          />
          <Pager
            page={page}
            pageSize={bookings.data?.page_size ?? DEFAULT_PAGE_SIZE}
            total={bookings.data?.total ?? 0}
            onPageChange={setPage}
            disabled={bookings.isPending}
          />
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={blockedReason !== null} onClick={() => setBookOpen(true)}>
            {bookButtonLabel(child)}
          </Button>
          {blockedReason !== null && (
            <span className="text-sm text-muted-foreground">{blockedReason}</span>
          )}
        </div>

        <EditChildSlideOver
          open={editOpen}
          onOpenChange={setEditOpen}
          child={child}
          onSaved={() => setEditOpen(false)}
        />
        <BookingForm
          open={bookOpen}
          onOpenChange={setBookOpen}
          initialChild={initialChild}
          onCreated={invalidateAfterBooking}
        />
        <BookingDetailPanel
          bookingId={selectedBookingId}
          onOpenChange={(open) => {
            if (!open) {
              setSelectedBookingId(null)
              bookings.refetch()
            }
          }}
        />
      </>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          to={backToChildrenPath(location.state)}
          className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          Back to children
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {data?.name ?? 'Child'}
          </h1>
          {data && !data.is_active && <StatusBadge status="inactive" />}
        </div>
      </div>
      {content}
    </div>
  )
}

const DetailField = ({ label, children }: DetailFieldProps) => (
  <div className="space-y-1">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="text-sm text-foreground">{children}</dd>
  </div>
)
