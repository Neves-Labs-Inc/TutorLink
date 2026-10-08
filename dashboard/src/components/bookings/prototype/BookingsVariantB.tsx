// PROTOTYPE (wayfinder #131) — Variant B "Staff/Child first, kind inferred": an inline panel
// that asks Child, then Staff, then reveals the rest. The kind toggle only appears when an
// Evaluation is actually possible. List: kind lives in the Subject cell; kind filter is a chip.
import { useState, type FormEvent } from 'react'
import { Plus, X } from 'lucide-react'

import { DataTable, type Column } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { formatIsoDate } from '@/lib/dates/dates'
import { cn } from '@/lib/utils'

import {
  canRunEvaluation,
  checkDraft,
  childById,
  CHILDREN,
  EMPTY_DRAFT,
  hasLiveEvaluation,
  OFFICE,
  ROLE_LABEL,
  slotsFor,
  staffById,
  timeLabel,
  toBooking,
  usesTypedTimes,
  type BookingKind,
  type Draft,
  type MockBooking,
} from './mockData'
import {
  ChildSelect,
  Errors,
  Field,
  KindBadge,
  LocationCell,
  LocationSelect,
  MockDetailPanel,
  SlotSelect,
  StaffCell,
  StaffSelect,
  StatePanel,
  SubjectSelect,
  TimeRange,
  Warnings,
  type VariantProps,
} from './shared'

const chip =
  'inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50'
const chipOn = 'border-primary bg-primary text-primary-foreground'
const chipOff = 'border-border text-muted-foreground hover:text-foreground'

export const BookingsVariantB = ({ bookings, onCreate }: VariantProps) => {
  const [composing, setComposing] = useState(false)
  const [selected, setSelected] = useState<MockBooking | null>(null)
  const [kind, setKind] = useState<'' | BookingKind>('')
  const [officeOnly, setOfficeOnly] = useState(false)
  const [staffId, setStaffId] = useState('')

  const rows = bookings.filter(
    (b) =>
      (kind === '' || b.kind === kind) &&
      (!officeOnly || b.locationId === OFFICE) &&
      (staffId === '' || b.staffId === staffId),
  )

  const columns: Column<MockBooking>[] = [
    { id: 'date', header: 'Date', primary: true, cell: (b) => formatIsoDate(b.date) },
    { id: 'time', header: 'Time', cell: (b) => timeLabel(b) },
    { id: 'child', header: 'Child', cell: (b) => childById(b.childId)?.name },
    { id: 'staff', header: 'Staff', cell: (b) => <StaffCell booking={b} /> },
    { id: 'location', header: 'Location', cell: (b) => <LocationCell booking={b} /> },
    {
      id: 'subject',
      header: 'Subject',
      cell: (b) => (b.kind === 'evaluation' ? <KindBadge kind="evaluation" /> : b.subject),
    },
    { id: 'status', header: 'Status', cell: (b) => <StatusBadge status={b.status} /> },
  ]

  const toggleKind = (next: BookingKind) => setKind((current) => (current === next ? '' : next))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Bookings</h1>
        {!composing && (
          <Button type="button" onClick={() => setComposing(true)}>
            <Plus data-icon="inline-start" aria-hidden="true" />
            New booking
          </Button>
        )}
      </div>

      {composing && (
        <InlineComposer
          bookings={bookings}
          onCreate={(booking) => {
            onCreate(booking)
            setComposing(false)
          }}
          onCancel={() => setComposing(false)}
        />
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <Field id="b-f-staff" label="Staff">
            <StaffSelect id="b-f-staff" value={staffId} placeholder="All staff" onChange={setStaffId} />
          </Field>
        </div>
        <div role="group" aria-label="Quick filters" className="flex flex-wrap gap-2 pb-1">
          <button
            type="button"
            aria-pressed={kind === 'regular'}
            className={cn(chip, kind === 'regular' ? chipOn : chipOff)}
            onClick={() => toggleKind('regular')}
          >
            Regular
          </button>
          <button
            type="button"
            aria-pressed={kind === 'evaluation'}
            className={cn(chip, kind === 'evaluation' ? chipOn : chipOff)}
            onClick={() => toggleKind('evaluation')}
          >
            Evaluations
          </button>
          <button
            type="button"
            aria-pressed={officeOnly}
            className={cn(chip, officeOnly ? chipOn : chipOff)}
            onClick={() => setOfficeOnly((v) => !v)}
          >
            In office
          </button>
        </div>
        <p className="ml-auto pb-1 text-sm text-muted-foreground">{rows.length} bookings</p>
      </div>

      <DataTable
        caption="Bookings"
        columns={columns}
        rows={rows}
        rowKey={(b) => b.id}
        status="ready"
        emptyMessage="No bookings match these filters."
        onRowSelect={setSelected}
      />

      <StatePanel bookings={bookings} />
      <MockDetailPanel booking={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

const Step = ({ n, title, done }: { n: number; title: string; done: boolean }) => (
  <div className="flex items-center gap-2 text-sm font-medium">
    <span
      className={cn(
        'inline-flex size-5 items-center justify-center rounded-full text-xs',
        done ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
      )}
    >
      {n}
    </span>
    {title}
  </div>
)

const InlineComposer = ({
  bookings,
  onCreate,
  onCancel,
}: {
  bookings: MockBooking[]
  onCreate: (booking: MockBooking) => void
  onCancel: () => void
}) => {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [submitted, setSubmitted] = useState(false)

  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }))
  const child = childById(draft.childId)
  const staff = staffById(draft.staffId)
  const evalPossible =
    child !== undefined &&
    !child.evaluated &&
    !hasLiveEvaluation(child.id, bookings) &&
    canRunEvaluation(staff)
  // Kind falls back to Regular whenever Evaluation stops being valid.
  const kind: BookingKind = evalPossible ? draft.kind : 'regular'
  const effective = { ...draft, kind }
  const typed = usesTypedTimes(kind, staff)
  const check = checkDraft(effective, bookings)
  const revealed = child !== undefined && staff !== undefined

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitted(true)
    if (check.errors.length === 0) onCreate(toBooking(effective))
  }

  return (
    <Card>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-heading text-base font-medium">New booking</h2>
            <button
              type="button"
              aria-label="Close"
              onClick={onCancel}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Step n={1} title="Who is it for?" done={child !== undefined} />
              <ChildSelect
                id="b-child"
                value={draft.childId}
                options={CHILDREN}
                onChange={(childId) => set({ childId, locationId: '' })}
              />
            </div>
            <div className="space-y-2">
              <Step n={2} title="Who runs it?" done={staff !== undefined} />
              <StaffSelect
                id="b-staff"
                value={draft.staffId}
                onChange={(staffId) => set({ staffId, slotId: '' })}
              />
            </div>
          </div>

          {!revealed && (
            <p className="text-sm text-muted-foreground">
              Pick a child and a staff member to see the rest.
            </p>
          )}

          {revealed && (
            <div className="space-y-4 border-t border-border pt-4">
              <Step n={3} title="Details" done={false} />

              {evalPossible ? (
                <div className="flex flex-wrap items-center gap-3 rounded-lg bg-muted/50 p-3 text-sm">
                  <span>
                    {child.name} is not yet Evaluated and {staff.name} is a {ROLE_LABEL[staff.role]}.
                  </span>
                  <div role="group" aria-label="Kind" className="flex gap-2">
                    {(['regular', 'evaluation'] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        aria-pressed={kind === k}
                        className={cn(chip, kind === k ? chipOn : chipOff)}
                        onClick={() => set({ kind: k, slotId: '' })}
                      >
                        {k === 'regular' ? 'Regular session' : 'Evaluation'}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Regular session.{' '}
                  {staff.role === 'admin'
                    ? 'Admins have no availability: type the time.'
                    : 'Times come from the staff member’s availability.'}
                </p>
              )}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Field id="b-location" label="Location">
                  <LocationSelect
                    id="b-location"
                    child={child}
                    value={draft.locationId}
                    onChange={(locationId) => set({ locationId })}
                  />
                </Field>
                {kind === 'regular' && (
                  <Field id="b-subject" label="Subject">
                    <SubjectSelect
                      id="b-subject"
                      staff={staff}
                      value={draft.subject}
                      onChange={(subject) => set({ subject })}
                    />
                  </Field>
                )}
                <Field id="b-date" label="Date">
                  <Input
                    id="b-date"
                    type="date"
                    value={draft.date}
                    onChange={(e) => set({ date: e.target.value, slotId: '' })}
                  />
                </Field>
              </div>

              {typed ? (
                <div className="max-w-sm">
                  <TimeRange
                    idPrefix="b"
                    start={draft.start}
                    end={draft.end}
                    onStart={(start) => set({ start })}
                    onEnd={(end) => set({ end })}
                  />
                </div>
              ) : (
                <div className="max-w-sm">
                  <Field
                    id="b-slot"
                    label="Availability slot"
                    hint={draft.date === '' ? 'Choose a date first.' : null}
                  >
                    <SlotSelect
                      id="b-slot"
                      slots={slotsFor(staff, draft.date)}
                      value={draft.slotId}
                      onChange={(slotId) => set({ slotId })}
                    />
                  </Field>
                </div>
              )}

              <Warnings warnings={check.warnings} />
              <Errors check={check} show={submitted} />

              <div className="flex gap-3">
                <Button type="submit">
                  {kind === 'evaluation' ? 'Book evaluation' : 'Create booking'}
                </Button>
                <Button type="button" variant="outline" onClick={onCancel}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
