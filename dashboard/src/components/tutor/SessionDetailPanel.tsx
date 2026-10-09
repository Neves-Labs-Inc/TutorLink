import { useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { SlideOver } from '@/components/shared/SlideOver'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { errorDetail } from '@/lib/api'
import { locationLabel } from '@/lib/booking-presentation/bookingPresentation'
import SubjectCell from '@/lib/booking-presentation/SubjectCell'
import { bookingTimeLabel } from '@/lib/bookings/bookings'
import { formatIsoDate } from '@/lib/dates/dates'
import { bookingQueries, updateBookingStatus } from '@/lib/queries/bookings'
import { canMarkCompleted } from '@/lib/tutor-sessions/tutorSessions'

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
const COMPLETE_FALLBACK_ERROR = 'Could not mark this session completed.'
// Bar widths of the six detail rows, so the skeleton reserves the loaded layout.
const SKELETON_VALUE_WIDTHS = ['w-40', 'w-24', 'w-28', 'w-32', 'w-20', 'w-36']
const STATUS_ROW_INDEX = 4
const SKELETON_WHERE_ROWS = [
  { label: 'w-16', value: 'w-48' },
  { label: 'w-20', value: 'w-24' },
]
const barClasses = 'animate-pulse rounded-lg bg-muted motion-reduce:animate-none'

// This panel is deliberately not `components/bookings/BookingDetailPanel`: that one offers the
// Office's status select. The only write here is a Tutor completing their own started session
// (the API refuses anything else). The `key` is load-bearing — it remounts the body for each session, so a revealed access
// code cannot survive onto the next one.
export const SessionDetailPanel = ({ bookingId, onClose }: SessionDetailPanelProps) => (
  <SlideOver
    open={bookingId !== null}
    onOpenChange={(open) => {
      if (!open) onClose()
    }}
    title="Session detail"
    description="The session, and where it happens."
  >
    {bookingId !== null && <PanelBody key={bookingId} bookingId={bookingId} />}
  </SlideOver>
)

const PanelBody = ({ bookingId }: PanelBodyProps) => {
  const [codeVisible, setCodeVisible] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const statusRef = useRef<HTMLElement>(null)
  const queryClient = useQueryClient()
  const booking = useQuery(bookingQueries.detail(bookingId))
  const completeSession = useMutation({
    mutationFn: () => updateBookingStatus(bookingId, 'completed'),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['bookings'] })
      setConfirmOpen(false)
    },
  })

  // Focus moves to the Status row before the dialog opens: the dialog hands focus back to
  // whatever held it at open, and the Mark completed button is gone once the session is completed.
  const handleOpenConfirm = () => {
    statusRef.current?.focus()
    setConfirmOpen(true)
  }

  const handleConfirmOpenChange = (open: boolean) => {
    setConfirmOpen(open)
    if (!open) completeSession.reset()
  }

  let content: ReactNode

  if (booking.isPending) {
    content = (
      <div aria-busy="true" className="space-y-6">
        <span className="sr-only">Loading session…</span>
        <dl className="space-y-3">
          {SKELETON_VALUE_WIDTHS.map((width, index) => (
            <div key={width} className="space-y-0.5">
              <dt className={`${barClasses} h-3 w-16`} />
              <dd
                className={`${barClasses} ${index === STATUS_ROW_INDEX ? 'h-5 rounded-full' : 'h-4'} ${width}`}
              />
            </div>
          ))}
        </dl>
        <div className="space-y-3">
          <div className={`${barClasses} h-4 w-14`} />
          <dl className="space-y-3">
            {SKELETON_WHERE_ROWS.map((row) => (
              <div key={row.label} className="space-y-0.5">
                <dt className={`${barClasses} h-3 ${row.label}`} />
                <dd className={`${barClasses} h-4 ${row.value}`} />
              </div>
            ))}
          </dl>
        </div>
        {[0, 1].map((note) => (
          <div key={note} className="space-y-1.5">
            <div className={`${barClasses} h-4 w-20`} />
            <div className={`${barClasses} h-4 w-full`} />
          </div>
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
          <DetailRow label="Subject">
            <SubjectCell booking={detail} emptyAs="dash" />
          </DetailRow>
          <DetailRow label="Date">{formatIsoDate(detail.scheduled_date)}</DetailRow>
          <DetailRow label="Time">{bookingTimeLabel(detail)}</DetailRow>
          <div className="space-y-0.5">
            <dt className="text-xs text-muted-foreground">Status</dt>
            <dd
              ref={statusRef}
              tabIndex={-1}
              className="flex flex-wrap items-center gap-2 rounded-lg text-sm text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <StatusBadge status={detail.status} />
              {canMarkCompleted(detail, new Date()) && (
                <Button type="button" className="h-11 md:h-8" onClick={handleOpenConfirm}>
                  Mark completed
                </Button>
              )}
            </dd>
          </div>
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
            <DetailRow label="Location">{locationLabel(detail)}</DetailRow>
            {detail.home !== null && (
              <>
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
              </>
            )}
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

        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={handleConfirmOpenChange}
          title="Mark as completed?"
          body="You can't undo this yourself."
          confirmLabel="Mark completed"
          onConfirm={() => completeSession.mutate()}
          pending={completeSession.isPending}
          errorMessage={
            completeSession.isError
              ? (errorDetail(completeSession.error) ?? COMPLETE_FALLBACK_ERROR)
              : null
          }
        />
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
