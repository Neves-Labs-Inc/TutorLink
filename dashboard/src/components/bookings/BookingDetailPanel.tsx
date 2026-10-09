import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { SlideOver } from '@/components/shared/SlideOver'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { errorDetail } from '@/lib/api'
import { locationLabel } from '@/lib/booking-presentation/bookingPresentation'
import SubjectCell from '@/lib/booking-presentation/SubjectCell'
import { bookingTimeLabel, statusLabel, STATUS_OPTIONS, type BookingStatus } from '@/lib/bookings/bookings'
import { formatIsoDate } from '@/lib/dates/dates'
import { bookingQueries, updateBookingStatus } from '@/lib/queries/bookings'

type BookingDetailPanelProps = {
  bookingId: string | null
  onOpenChange: (open: boolean) => void
}

type PanelBodyProps = {
  bookingId: string
}

type DetailRowProps = {
  label: string
  children: ReactNode
}

const LOAD_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const STATUS_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const ADMIN_CREATED_LABEL = 'Created by an admin'
const NO_NOTES_LABEL = 'No notes.'
const LOADING_ROWS = [0, 1, 2, 3, 4]

const pillClasses =
  'inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'

export const BookingDetailPanel = ({ bookingId, onOpenChange }: BookingDetailPanelProps) => (
  <SlideOver
    open={bookingId !== null}
    onOpenChange={onOpenChange}
    title="Booking detail"
    description="The session, where it happens, and its status."
  >
    {bookingId !== null && <PanelBody bookingId={bookingId} />}
  </SlideOver>
)

const PanelBody = ({ bookingId }: PanelBodyProps) => {
  const queryClient = useQueryClient()
  const booking = useQuery(bookingQueries.detail(bookingId))

  // The PATCH body carries `status` and nothing else. `BookingStatusUpdate`
  // (`api/app/schemas/booking_status.py:16-17`) drops any other key without complaint, so a
  // `notes` field added here would look saved and never reach the row (amendment A-5).
  const changeStatus = useMutation({
    mutationFn: (status: BookingStatus) => updateBookingStatus(bookingId, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bookings'] }),
  })

  let content: ReactNode

  if (booking.isPending) {
    content = (
      <div aria-busy="true" className="space-y-3">
        <p className="text-sm text-muted-foreground">Loading booking…</p>
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
          <DetailRow label="Booked by">
            {detail.booked_by_guardian === null ? (
              <span className="text-muted-foreground">{ADMIN_CREATED_LABEL}</span>
            ) : (
              detail.booked_by_guardian.name
            )}
          </DetailRow>
          <DetailRow label="Staff">{detail.staff.name}</DetailRow>
          <DetailRow label="Subject">
            <SubjectCell booking={detail} emptyAs="dash" />
          </DetailRow>
          <DetailRow label="Date">{formatIsoDate(detail.scheduled_date)}</DetailRow>
          <DetailRow label="Time">{bookingTimeLabel(detail)}</DetailRow>
          <DetailRow label="Location">{locationLabel(detail)}</DetailRow>
          {detail.home !== null && (
            <>
              <DetailRow label="Address">{detail.home.address}</DetailRow>
              <DetailRow label="Access code">
                <span className="font-mono">{detail.home.access_code}</span>
              </DetailRow>
            </>
          )}
        </dl>

        <div className="space-y-1.5">
          <Label htmlFor="booking-status">Status</Label>
          <Select
            id="booking-status"
            value={detail.status}
            disabled={changeStatus.isPending}
            onChange={(event) => changeStatus.mutate(event.target.value as BookingStatus)}
          >
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {statusLabel(status)}
              </option>
            ))}
          </Select>
          {changeStatus.isError && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {errorDetail(changeStatus.error) ?? STATUS_FALLBACK_ERROR}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">Notes</span>
            <span className={pillClasses}>Read-only</span>
          </div>
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
