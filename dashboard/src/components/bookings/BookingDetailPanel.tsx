import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'

import { BookingForm } from '@/components/bookings/BookingForm'
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
import { cn } from '@/lib/utils'

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
// One label-over-value pair per `DetailRow` of a home booking.
const LOADING_ROWS = [0, 1, 2, 3, 4, 5, 6, 7]
// Only a live booking can be edited (`PUT` refuses the rest with `BookingNotLive`).
const EDITABLE_STATUSES: BookingStatus[] = ['pending', 'confirmed']

const pillClasses =
  'inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
const skeletonBarClasses = 'animate-pulse rounded-lg bg-muted motion-reduce:animate-none'

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
  const [editing, setEditing] = useState(false)

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
      <div aria-busy="true" className="space-y-6">
        <p className="sr-only">Loading booking…</p>
        <div className="space-y-3">
          {LOADING_ROWS.map((row) => (
            <div key={row} className="space-y-0.5">
              <div className={cn(skeletonBarClasses, 'h-3 w-20')} />
              <div className={cn(skeletonBarClasses, 'h-4 w-40')} />
            </div>
          ))}
        </div>
        <div className={cn(skeletonBarClasses, 'h-11 w-full md:h-8 md:w-24')} />
        <div className="space-y-1.5">
          <div className={cn(skeletonBarClasses, 'h-3 w-12')} />
          <div className={cn(skeletonBarClasses, 'h-8 w-full')} />
        </div>
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

        {EDITABLE_STATUSES.includes(detail.status) && (
          <div>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full md:h-8 md:w-auto"
              onClick={() => setEditing(true)}
            >
              <Pencil data-icon="inline-start" aria-hidden="true" />
              Edit
            </Button>
            <BookingForm open={editing} onOpenChange={setEditing} booking={detail} />
          </div>
        )}

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
