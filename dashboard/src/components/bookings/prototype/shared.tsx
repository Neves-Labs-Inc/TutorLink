// PROTOTYPE (wayfinder #131) — throwaway. Small field-level pieces the variants share.
// Layouts are NOT shared: each variant composes these its own way.
import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

import { SlideOver } from '@/components/shared/SlideOver'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { formatIsoDate, formatTime } from '@/lib/dates/dates'
import { cn } from '@/lib/utils'

import {
  childById,
  OFFICE,
  RANGE_LABEL,
  ROLE_LABEL,
  STAFF,
  staffById,
  SUBJECTS,
  type Check,
  type Child,
  timeLabel,
  type MockBooking,
  type Slot,
  type Staff,
  type StaffRole,
} from './mockData'

export const Field = ({
  id,
  label,
  hint,
  children,
}: {
  id: string
  label: string
  hint?: ReactNode
  children: ReactNode
}) => (
  <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    {children}
    {hint !== undefined && hint !== null && (
      <p className="text-xs text-muted-foreground">{hint}</p>
    )}
  </div>
)

export const ChildSelect = ({
  id,
  value,
  onChange,
  options,
  showEvaluated = true,
}: {
  id: string
  value: string
  onChange: (id: string) => void
  options: Child[]
  showEvaluated?: boolean
}) => (
  <Select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
    <option value="">Select a child</option>
    {options.map((child) => (
      <option key={child.id} value={child.id}>
        {child.name} · grade {child.grade}
        {showEvaluated ? (child.evaluated ? '' : ' · not Evaluated') : ''}
      </option>
    ))}
  </Select>
)

const ROLE_ORDER: StaffRole[] = ['tutor', 'manager', 'admin']

// Staff grouped by role with <optgroup>. `allow` narrows the roles offered.
export const StaffSelect = ({
  id,
  value,
  onChange,
  allow = ROLE_ORDER,
  placeholder = 'Select staff',
}: {
  id: string
  value: string
  onChange: (id: string) => void
  allow?: StaffRole[]
  placeholder?: string
}) => (
  <Select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
    <option value="">{placeholder}</option>
    {ROLE_ORDER.filter((role) => allow.includes(role)).map((role) => (
      <optgroup key={role} label={`${ROLE_LABEL[role]}s`}>
        {STAFF.filter((staff) => staff.role === role).map((staff) => (
          <option key={staff.id} value={staff.id}>
            {staff.name}
          </option>
        ))}
      </optgroup>
    ))}
  </Select>
)

export const LocationSelect = ({
  id,
  child,
  value,
  onChange,
}: {
  id: string
  child: Child | undefined
  value: string
  onChange: (id: string) => void
}) => (
  <Select
    id={id}
    value={value}
    disabled={child === undefined}
    onChange={(event) => onChange(event.target.value)}
  >
    <option value="">{child === undefined ? 'Choose a child first' : 'Select a location'}</option>
    {child !== undefined && (
      <optgroup label={`${child.name}'s homes`}>
        {child.homes.map((home) => (
          <option key={home.id} value={home.id}>
            {home.label === null ? home.address : `${home.label} — ${home.address}`}
          </option>
        ))}
      </optgroup>
    )}
    {child !== undefined && (
      <optgroup label="Office">
        <option value={OFFICE}>In office</option>
      </optgroup>
    )}
  </Select>
)

export const SubjectSelect = ({
  id,
  value,
  onChange,
  staff,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  staff: Staff | undefined
}) => (
  <Select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
    <option value="">Select a subject</option>
    {SUBJECTS.map((subject) => (
      <option key={subject} value={subject}>
        {subject}
        {staff !== undefined && staff.role !== 'admin' && !staff.subjects.includes(subject)
          ? ' (not taught by this staff member)'
          : ''}
      </option>
    ))}
  </Select>
)

export const SlotSelect = ({
  id,
  slots,
  value,
  onChange,
}: {
  id: string
  slots: Slot[]
  value: string
  onChange: (id: string) => void
}) => (
  <Select
    id={id}
    value={value}
    disabled={slots.length === 0}
    onChange={(event) => onChange(event.target.value)}
  >
    <option value="">{slots.length === 0 ? 'No slots that day' : 'Select a slot'}</option>
    {slots.map((slot) => (
      <option key={slot.id} value={slot.id}>
        {formatTime(slot.start)} – {formatTime(slot.end)} · {RANGE_LABEL[slot.range]}
      </option>
    ))}
  </Select>
)

export const TimeRange = ({
  idPrefix,
  start,
  end,
  onStart,
  onEnd,
}: {
  idPrefix: string
  start: string
  end: string
  onStart: (value: string) => void
  onEnd: (value: string) => void
}) => (
  <div className="grid grid-cols-2 gap-4">
    <Field id={`${idPrefix}-start`} label="Start time">
      <Input
        id={`${idPrefix}-start`}
        type="time"
        value={start}
        onChange={(event) => onStart(event.target.value)}
      />
    </Field>
    <Field id={`${idPrefix}-end`} label="End time">
      <Input
        id={`${idPrefix}-end`}
        type="time"
        value={end}
        onChange={(event) => onEnd(event.target.value)}
      />
    </Field>
  </div>
)

export const Warnings = ({ warnings }: { warnings: string[] }) =>
  warnings.length === 0 ? null : (
    <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
      <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        {warnings.map((warning) => (
          <p key={warning}>{warning}</p>
        ))}
      </div>
    </div>
  )

export const Errors = ({ check, show }: { check: Check; show: boolean }) =>
  !show || check.errors.length === 0 ? null : (
    <ul role="alert" className="space-y-1 text-sm font-medium text-destructive">
      {check.errors.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  )

export const KindBadge = ({ kind }: { kind: MockBooking['kind'] }) => (
  <span
    className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
      kind === 'evaluation'
        ? 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200'
        : 'bg-muted text-muted-foreground',
    )}
  >
    {kind === 'evaluation' ? 'Evaluation' : 'Regular'}
  </span>
)

export const StaffCell = ({ booking }: { booking: MockBooking }) => {
  const staff = staffById(booking.staffId)
  return staff === undefined ? '—' : (
    <span>
      {staff.name} <span className="text-xs text-muted-foreground">{ROLE_LABEL[staff.role]}</span>
    </span>
  )
}

export const LocationCell = ({ booking }: { booking: MockBooking }) => {
  if (booking.locationId === OFFICE) return <span className="font-medium">In office</span>
  const home = childById(booking.childId)?.homes.find((h) => h.id === booking.locationId)
  return <>{home === undefined ? '—' : (home.label ?? home.address)}</>
}

const DetailRow = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="space-y-0.5">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="text-sm text-foreground">{children}</dd>
  </div>
)

export const MockDetailPanel = ({
  booking,
  onClose,
}: {
  booking: MockBooking | null
  onClose: () => void
}) => {
  const child = booking === null ? undefined : childById(booking.childId)
  const staff = booking === null ? undefined : staffById(booking.staffId)
  const home =
    booking === null ? undefined : child?.homes.find((h) => h.id === booking.locationId)

  return (
    <SlideOver
      open={booking !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={booking?.kind === 'evaluation' ? 'Evaluation detail' : 'Booking detail'}
      description="The session, where it happens, and its status."
    >
      {booking !== null && (
        <dl className="space-y-3">
          <DetailRow label="Kind">
            <KindBadge kind={booking.kind} />
          </DetailRow>
          <DetailRow label="Child">
            {child?.name}
            {child !== undefined && !child.evaluated && (
              <span className="ml-1 text-xs text-muted-foreground">(not Evaluated)</span>
            )}
          </DetailRow>
          <DetailRow label="Staff">
            {staff === undefined ? '—' : `${staff.name} · ${ROLE_LABEL[staff.role]}`}
          </DetailRow>
          <DetailRow label="Subject">
            {booking.subject ?? <span className="text-muted-foreground">—</span>}
          </DetailRow>
          <DetailRow label="Date">{formatIsoDate(booking.date)}</DetailRow>
          <DetailRow label="Time">{timeLabel(booking)}</DetailRow>
          <DetailRow label="Location">
            {booking.locationId === OFFICE ? 'In office' : (home?.label ?? 'Home')}
          </DetailRow>
          {home !== undefined && (
            <>
              <DetailRow label="Address">{home.address}</DetailRow>
              <DetailRow label="Access code">
                <span className="font-mono">{home.accessCode}</span>
              </DetailRow>
            </>
          )}
          <DetailRow label="Status">
            <StatusBadge status={booking.status} />
          </DetailRow>
          <DetailRow label="Notes">
            {booking.notes ?? <span className="text-muted-foreground">No notes.</span>}
          </DetailRow>
        </dl>
      )}
    </SlideOver>
  )
}

// Surfaces the in-memory state so each submit's effect is visible.
export const StatePanel = ({ bookings }: { bookings: MockBooking[] }) => (
  <details className="rounded-lg border border-dashed border-border p-3 text-xs" open>
    <summary className="cursor-pointer font-medium text-muted-foreground">
      Prototype state — {bookings.length} in-memory bookings (newest first)
    </summary>
    <pre className="mt-2 max-h-72 overflow-auto font-mono text-[11px] leading-snug">
      {JSON.stringify([...bookings].reverse(), null, 2)}
    </pre>
  </details>
)

export type VariantProps = {
  bookings: MockBooking[]
  onCreate: (booking: MockBooking) => void
}
