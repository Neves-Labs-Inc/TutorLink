// PROTOTYPE (wayfinder #131) — Variant A "Kind first": one form led by a Regular | Evaluation
// segmented control; fields adapt to the kind. List gets its own Kind column.
import { useState, type FormEvent } from 'react'

import { DataTable, type Column } from '@/components/shared/DataTable'
import { SlideOver } from '@/components/shared/SlideOver'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { formatIsoDate } from '@/lib/dates/dates'
import { cn } from '@/lib/utils'

import {
  checkDraft,
  childById,
  CHILDREN,
  EMPTY_DRAFT,
  evaluableChildren,
  OFFICE,
  slotsFor,
  staffById,
  SUBJECTS,
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

const FORM_ID = 'proto-a-form'
const segClasses =
  'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

type Filters = { kind: '' | BookingKind; staffId: string; subject: string; location: string }

export const BookingsVariantA = ({ bookings, onCreate }: VariantProps) => {
  const [formOpen, setFormOpen] = useState(false)
  const [selected, setSelected] = useState<MockBooking | null>(null)
  const [filters, setFilters] = useState<Filters>({
    kind: '',
    staffId: '',
    subject: '',
    location: '',
  })

  const rows = bookings.filter(
    (b) =>
      (filters.kind === '' || b.kind === filters.kind) &&
      (filters.staffId === '' || b.staffId === filters.staffId) &&
      (filters.subject === '' || b.subject === filters.subject) &&
      (filters.location === '' ||
        (filters.location === OFFICE ? b.locationId === OFFICE : b.locationId !== OFFICE)),
  )

  const columns: Column<MockBooking>[] = [
    { id: 'date', header: 'Date', primary: true, cell: (b) => formatIsoDate(b.date) },
    { id: 'time', header: 'Time', cell: (b) => timeLabel(b) },
    { id: 'kind', header: 'Kind', cell: (b) => <KindBadge kind={b.kind} /> },
    { id: 'child', header: 'Child', cell: (b) => childById(b.childId)?.name },
    { id: 'staff', header: 'Staff', cell: (b) => <StaffCell booking={b} /> },
    { id: 'location', header: 'Location', cell: (b) => <LocationCell booking={b} /> },
    {
      id: 'subject',
      header: 'Subject',
      cell: (b) => b.subject ?? <span className="text-muted-foreground">—</span>,
    },
    { id: 'status', header: 'Status', cell: (b) => <StatusBadge status={b.status} /> },
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
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field id="a-f-kind" label="Kind">
              <Select
                id="a-f-kind"
                value={filters.kind}
                onChange={(e) => setFilters({ ...filters, kind: e.target.value as Filters['kind'] })}
              >
                <option value="">All kinds</option>
                <option value="regular">Regular</option>
                <option value="evaluation">Evaluation</option>
              </Select>
            </Field>
            <Field id="a-f-staff" label="Staff">
              <StaffSelect
                id="a-f-staff"
                value={filters.staffId}
                placeholder="All staff"
                onChange={(staffId) => setFilters({ ...filters, staffId })}
              />
            </Field>
            <Field id="a-f-subject" label="Subject">
              <Select
                id="a-f-subject"
                value={filters.subject}
                onChange={(e) => setFilters({ ...filters, subject: e.target.value })}
              >
                <option value="">All subjects</option>
                {SUBJECTS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </Field>
            <Field id="a-f-location" label="Location">
              <Select
                id="a-f-location"
                value={filters.location}
                onChange={(e) => setFilters({ ...filters, location: e.target.value })}
              >
                <option value="">All locations</option>
                <option value="home">At a home</option>
                <option value={OFFICE}>In office</option>
              </Select>
            </Field>
          </div>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">{rows.length} bookings</p>

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

      <KindFirstForm
        open={formOpen}
        onOpenChange={setFormOpen}
        bookings={bookings}
        onCreate={onCreate}
      />
    </div>
  )
}

const KindFirstForm = ({
  open,
  onOpenChange,
  bookings,
  onCreate,
}: VariantProps & { open: boolean; onOpenChange: (open: boolean) => void }) => {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [submitted, setSubmitted] = useState(false)

  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }))
  const isEval = draft.kind === 'evaluation'
  const child = childById(draft.childId)
  const staff = staffById(draft.staffId)
  const typed = usesTypedTimes(draft.kind, staff)
  const check = checkDraft(draft, bookings)
  const childOptions = isEval ? evaluableChildren(bookings) : CHILDREN

  const close = () => {
    setDraft(EMPTY_DRAFT)
    setSubmitted(false)
    onOpenChange(false)
  }

  const switchKind = (kind: BookingKind) => {
    // Keep what still fits the new kind; drop child/staff that the kind rules out.
    setDraft((current) => {
      const next = { ...current, kind, slotId: '', subject: kind === 'evaluation' ? '' : current.subject }
      const nextChild = childById(current.childId)
      const nextStaff = staffById(current.staffId)
      if (kind === 'evaluation' && nextChild?.evaluated) Object.assign(next, { childId: '', locationId: '' })
      if (kind === 'evaluation' && nextStaff?.role === 'tutor') next.staffId = ''
      return next
    })
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitted(true)
    if (check.errors.length === 0) {
      onCreate(toBooking(draft))
      close()
    }
  }

  return (
    <SlideOver
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={isEval ? 'Create evaluation' : 'Create booking'}
      description={
        isEval
          ? 'A first assessment for a child who has not been Evaluated. Created Confirmed.'
          : 'Booked as an admin, with no guardian on the other end of it.'
      }
      footer={
        <div className="space-y-3">
          <Warnings warnings={check.warnings} />
          <Errors check={check} show={submitted} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" form={FORM_ID}>
              {isEval ? 'Create evaluation' : 'Create booking'}
            </Button>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
          </div>
        </div>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label>Kind</Label>
          <div role="group" aria-label="Kind" className="flex gap-1 rounded-lg border border-border p-1">
            {(['regular', 'evaluation'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={draft.kind === kind}
                onClick={() => switchKind(kind)}
                className={cn(
                  segClasses,
                  draft.kind === kind
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {kind === 'regular' ? 'Regular' : 'Evaluation'}
              </button>
            ))}
          </div>
        </div>

        <Field
          id="a-child"
          label="Child"
          hint={isEval ? 'Only children who are not yet Evaluated and have no live Evaluation.' : null}
        >
          <ChildSelect
            id="a-child"
            value={draft.childId}
            options={childOptions}
            showEvaluated={!isEval}
            onChange={(childId) => set({ childId, locationId: '' })}
          />
        </Field>

        <Field
          id="a-staff"
          label="Staff"
          hint={
            isEval
              ? 'Admins and Managers only.'
              : staff?.role === 'admin'
                ? 'Admins have no availability: type the time. Only overlap is checked.'
                : null
          }
        >
          <StaffSelect
            id="a-staff"
            value={draft.staffId}
            allow={isEval ? ['manager', 'admin'] : undefined}
            onChange={(staffId) => set({ staffId, slotId: '' })}
          />
        </Field>

        <Field id="a-location" label="Location">
          <LocationSelect
            id="a-location"
            child={child}
            value={draft.locationId}
            onChange={(locationId) => set({ locationId })}
          />
        </Field>

        {!isEval && (
          <Field id="a-subject" label="Subject">
            <SubjectSelect
              id="a-subject"
              staff={staff}
              value={draft.subject}
              onChange={(subject) => set({ subject })}
            />
          </Field>
        )}

        <Field id="a-date" label="Date">
          <Input
            id="a-date"
            type="date"
            value={draft.date}
            onChange={(e) => set({ date: e.target.value, slotId: '' })}
          />
        </Field>

        {typed ? (
          <TimeRange
            idPrefix="a"
            start={draft.start}
            end={draft.end}
            onStart={(start) => set({ start })}
            onEnd={(end) => set({ end })}
          />
        ) : (
          <Field
            id="a-slot"
            label="Availability slot"
            hint={
              draft.staffId === '' || draft.date === ''
                ? 'Choose staff and a date first.'
                : 'Gap, time off and grade ceiling are checked on save.'
            }
          >
            <SlotSelect
              id="a-slot"
              slots={slotsFor(staff, draft.date)}
              value={draft.slotId}
              onChange={(slotId) => set({ slotId })}
            />
          </Field>
        )}

        <Field id="a-notes" label="Notes (optional)">
          <Textarea
            id="a-notes"
            rows={3}
            value={draft.notes}
            onChange={(e) => set({ notes: e.target.value })}
          />
        </Field>
      </form>
    </SlideOver>
  )
}
