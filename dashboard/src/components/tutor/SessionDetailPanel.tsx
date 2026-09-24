import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'

import { SlideOver } from '@/components/shared/SlideOver'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { errorDetail } from '@/lib/api'
import { bookingTimeLabel } from '@/lib/bookings/bookings'
import { formatIsoDate } from '@/lib/dates/dates'
import { bookingQueries } from '@/lib/queries/bookings'

type SessionDetailPanelProps = {
  bookingId: string | null
  onClose: () => void
}

type PanelBodyProps = {
  bookingId: string
}

type DetailRowProps = {
  label: string
  children: ReactNode
}

const LOAD_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const ADMIN_CREATED_LABEL = 'Created by an admin'
const NO_NOTES_LABEL = 'No notes.'
const NO_CHILD_NOTES_LABEL = 'No notes for this child.'
const HIDDEN_CODE_LABEL = 'Hidden'
const LOADING_ROWS = [0, 1, 2, 3, 4]

// This panel is deliberately not `components/bookings/BookingDetailPanel`: that one offers status
// transitions, and `PATCH /api/bookings` is ✗ for tutors (`api-design.md:277`). Nothing here
// writes. The `key` is load-bearing — it remounts the body for each session, so a revealed access
// code cannot survive onto the next one.
export const SessionDetailPanel = ({ bookingId, onClose }: SessionDetailPanelProps) => (
  <SlideOver
    open={bookingId !== null}
    onOpenChange={(open) => {
      if (!open) onClose()
    }}
    title="Session detail"
    description="The session, and the home it is at."
  >
    {bookingId !== null && <PanelBody key={bookingId} bookingId={bookingId} />}
  </SlideOver>
)

const PanelBody = ({ bookingId }: PanelBodyProps) => {
  const [codeVisible, setCodeVisible] = useState(false)
  const booking = useQuery(bookingQueries.detail(bookingId))

  let content: ReactNode

  if (booking.isPending) {
    content = (
      <div aria-busy="true" className="space-y-3">
        <p className="text-sm text-muted-foreground">Loading session…</p>
        {LOADING_ROWS.map((row) => (
          <div key={row} className="h-8 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    )
  } else if (booking.isError) {
    content = (
      <div className="space-y-4">
        <p role="alert" className="text-sm font-medium text-destructive">
          {errorDetail(booking.error) ?? LOAD_FALLBACK_ERROR}
        </p>
        <Button type="button" variant="outline" onClick={() => booking.refetch()}>
          Try again
        </Button>
      </div>
    )
  } else {
    const detail = booking.data

    content = (
      <div className="space-y-6">
        <dl className="space-y-3">
          <DetailRow label="Child">{detail.child.name}</DetailRow>
          <DetailRow label="Subject">{detail.subject.name}</DetailRow>
          <DetailRow label="Date">{formatIsoDate(detail.scheduled_date)}</DetailRow>
          <DetailRow label="Time">{bookingTimeLabel(detail)}</DetailRow>
          <DetailRow label="Status">
            <StatusBadge status={detail.status} />
          </DetailRow>
          <DetailRow label="Booked by">
            {detail.booked_by_guardian === null ? (
              <span className="text-muted-foreground">{ADMIN_CREATED_LABEL}</span>
            ) : (
              detail.booked_by_guardian.name
            )}
          </DetailRow>
        </dl>

        <div className="space-y-3">
          <h3 className="text-sm font-medium text-foreground">Where</h3>
          {/* The home on the booking, never the guardian's: a child with separated guardians has
              two, and the session is at one of them (`admin-dashboard-design.md:287-288`). */}
          <dl className="space-y-3">
            {detail.home.label !== null && <DetailRow label="Home">{detail.home.label}</DetailRow>}
            <DetailRow label="Address">{detail.home.address}</DetailRow>
            <DetailRow label="Access code">
              <div className="flex flex-wrap items-center gap-2">
                {codeVisible ? (
                  <span className="font-mono">{detail.home.access_code}</span>
                ) : (
                  <span className="text-muted-foreground">{HIDDEN_CODE_LABEL}</span>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-expanded={codeVisible}
                  onClick={() => setCodeVisible(!codeVisible)}
                >
                  {codeVisible ? 'Hide access code' : 'Show access code'}
                </Button>
              </div>
            </DetailRow>
          </dl>
        </div>

        <div className="space-y-1.5">
          <h3 className="text-sm font-medium text-foreground">Child notes</h3>
          <p className="text-sm whitespace-pre-wrap text-foreground">
            {detail.child.notes ?? (
              <span className="text-muted-foreground">{NO_CHILD_NOTES_LABEL}</span>
            )}
          </p>
        </div>

        <div className="space-y-1.5">
          <h3 className="text-sm font-medium text-foreground">Session notes</h3>
          <p className="text-sm whitespace-pre-wrap text-foreground">
            {detail.notes ?? <span className="text-muted-foreground">{NO_NOTES_LABEL}</span>}
          </p>
        </div>
      </div>
    )
  }

  return content
}

const DetailRow = ({ label, children }: DetailRowProps) => (
  <div className="space-y-0.5">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="text-sm text-foreground">{children}</dd>
  </div>
)
