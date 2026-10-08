// PROTOTYPE (wayfinder #131) — Variant C "Separate entry points": "New booking" and
// "New Evaluation" each open their own focused form. List: kind is a row of tabs above the table.
import { useState, type FormEvent } from 'react'

import { DataTable, type Column } from '@/components/shared/DataTable'
import { SlideOver } from '@/components/shared/SlideOver'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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

type Tab = 'all' | BookingKind
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'regular', label: 'Regular' },
  { id: 'evaluation', label: 'Evaluation' },
]

export const BookingsVariantC = ({ bookings, onCreate }: VariantProps) => {
  const [open, setOpen] = useState<BookingKind | null>(null)
  const [selected, setSelected] = useState<MockBooking | null>(null)
  const [tab, setTab] = useState<Tab>('all')
  const [staffId, setStaffId] = useState('')
  const [location, setLocation] = useState('')

  const base = bookings.filter(
    (b) =>
      (staffId === '' || b.staffId === staffId) &&
      (location === '' || (location === OFFICE ? b.locationId === OFFICE : b.locationId !== OFFICE)),
  )
  const rows = base.filter((b) => tab === 'all' || b.kind === tab)

  const columns: Column<MockBooking>[] = [
    { id: 'date', header: 'Date', primary: true, cell: (b) => formatIsoDate(b.date) },
    { id: 'time', header: 'Time', cell: (b) => timeLabel(b) },
    { id: 'child', header: 'Child', cell: (b) => childById(b.childId)?.name },
    { id: 'staff', header: 'Staff', cell: (b) => <StaffCell booking={b} /> },
    { id: 'location', header: 'Location', cell: (b) => <LocationCell booking={b} /> },
    // The Evaluation tab has no subjects at all, so the column goes.
    ...(tab === 'evaluation'
      ? []
      : [
          {
            id: 'subject',
            header: 'Subject',
            cell: (b: MockBooking) =>
              b.subject ?? <span className="text-muted-foreground italic">Evaluation</span>,
          },
        ]),
    { id: 'status', header: 'Status', cell: (b) => <StatusBadge status={b.status} /> },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Bookings</h1>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen('evaluation')}>
            New Evaluation
          </Button>
          <Button type="button" onClick={() => setOpen('regular')}>
            New booking
          </Button>
        </div>
      </div>

      <Card>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field id="c-f-staff" label="Staff">
              <StaffSelect id="c-f-staff" value={staffId} placeholder="All staff" onChange={setStaffId} />
            </Field>
            <Field id="c-f-location" label="Location">
              <Select id="c-f-location" value={location} onChange={(e) => setLocation(e.target.value)}>
                <option value="">All locations</option>
                <option value="home">At a home</option>
                <option value={OFFICE}>In office</option>
              </Select>
            </Field>
          </div>
        </CardContent>
      </Card>

      <div role="tablist" aria-label="Kind" className="flex gap-4 border-b border-border">
        {TABS.map((t) => {
          const count = base.filter((b) => t.id === 'all' || b.kind === t.id).length
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                '-mb-px border-b-2 px-1 pb-2 text-sm font-medium transition-colors',
                tab === t.id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label} <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
            </button>
          )
        })}
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

      <RegularForm
        open={open === 'regular'}
        onClose={() => setOpen(null)}
        bookings={bookings}
        onCreate={onCreate}
      />
      <EvaluationForm
        open={open === 'evaluation'}
        onClose={() => setOpen(null)}
        bookings={bookings}
        onCreate={onCreate}
      />
    </div>
  )
}

type FormProps = VariantProps & { open: boolean; onClose: () => void }

const useDraft = (kind: BookingKind, bookings: MockBooking[], onCreate: FormProps['onCreate'], onClose: () => void) => {
  const [draft, setDraft] = useState<Draft>({ ...EMPTY_DRAFT, kind })
  const [submitted, setSubmitted] = useState(false)
  const check = checkDraft(draft, bookings)
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }))
  const close = () => {
    setDraft({ ...EMPTY_DRAFT, kind })
    setSubmitted(false)
    onClose()
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitted(true)
    if (check.errors.length === 0) {
      onCreate(toBooking(draft))
      close()
    }
  }
  return { draft, set, check, submitted, close, submit }
}

const Footer = ({
  formId,
  label,
  check,
  submitted,
  onCancel,
}: {
  formId: string
  label: string
  check: ReturnType<typeof checkDraft>
  submitted: boolean
  onCancel: () => void
}) => (
  <div className="space-y-3">
    <Warnings warnings={check.warnings} />
    <Errors check={check} show={submitted} />
    <div className="flex gap-3">
      <Button type="submit" form={formId}>
        {label}
      </Button>
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  </div>
)

const RegularForm = ({ open, onClose, bookings, onCreate }: FormProps) => {
  const { draft, set, check, submitted, close, submit } = useDraft('regular', bookings, onCreate, onClose)
  const child = childById(draft.childId)
  const staff = staffById(draft.staffId)
  const typed = usesTypedTimes('regular', staff)

  return (
    <SlideOver
      open={open}
      onOpenChange={(next) => !next && close()}
      title="New booking"
      description="A regular session. For a first assessment use New Evaluation."
      footer={
        <Footer formId="c-reg" label="Create booking" check={check} submitted={submitted} onCancel={close} />
      }
    >
      <form id="c-reg" onSubmit={submit} className="space-y-4">
        <Field id="c-r-child" label="Child">
          <ChildSelect
            id="c-r-child"
            value={draft.childId}
            options={CHILDREN}
            onChange={(childId) => set({ childId, locationId: '' })}
          />
        </Field>
        <Field id="c-r-location" label="Location">
          <LocationSelect
            id="c-r-location"
            child={child}
            value={draft.locationId}
            onChange={(locationId) => set({ locationId })}
          />
        </Field>
        <Field
          id="c-r-staff"
          label="Staff"
          hint={staff?.role === 'admin' ? 'Admins have no availability: type the time.' : null}
        >
          <StaffSelect id="c-r-staff" value={draft.staffId} onChange={(staffId) => set({ staffId, slotId: '' })} />
        </Field>
        <Field id="c-r-subject" label="Subject">
          <SubjectSelect id="c-r-subject" staff={staff} value={draft.subject} onChange={(subject) => set({ subject })} />
        </Field>
        <Field id="c-r-date" label="Date">
          <Input id="c-r-date" type="date" value={draft.date} onChange={(e) => set({ date: e.target.value, slotId: '' })} />
        </Field>
        {typed ? (
          <TimeRange idPrefix="c-r" start={draft.start} end={draft.end} onStart={(start) => set({ start })} onEnd={(end) => set({ end })} />
        ) : (
          <Field
            id="c-r-slot"
            label="Availability slot"
            hint={draft.staffId === '' || draft.date === '' ? 'Choose staff and a date first.' : null}
          >
            <SlotSelect id="c-r-slot" slots={slotsFor(staff, draft.date)} value={draft.slotId} onChange={(slotId) => set({ slotId })} />
          </Field>
        )}
        <Field id="c-r-notes" label="Notes (optional)">
          <Textarea id="c-r-notes" rows={3} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
      </form>
    </SlideOver>
  )
}

const EvaluationForm = ({ open, onClose, bookings, onCreate }: FormProps) => {
  const { draft, set, check, submitted, close, submit } = useDraft('evaluation', bookings, onCreate, onClose)
  const child = childById(draft.childId)
  const options = evaluableChildren(bookings)

  return (
    <SlideOver
      open={open}
      onOpenChange={(next) => !next && close()}
      title="New Evaluation"
      description="A first assessment, run by an Admin or Manager. Created Confirmed."
      footer={
        <Footer formId="c-eval" label="Book evaluation" check={check} submitted={submitted} onCancel={close} />
      }
    >
      <form id="c-eval" onSubmit={submit} className="space-y-4">
        <Field
          id="c-e-child"
          label="Child"
          hint={options.length === 0 ? 'Every child is Evaluated or has a live Evaluation.' : null}
        >
          <ChildSelect
            id="c-e-child"
            value={draft.childId}
            options={options}
            showEvaluated={false}
            onChange={(childId) => set({ childId, locationId: '' })}
          />
        </Field>
        <Field id="c-e-staff" label="Staff">
          <StaffSelect
            id="c-e-staff"
            value={draft.staffId}
            allow={['manager', 'admin']}
            onChange={(staffId) => set({ staffId })}
          />
        </Field>
        <Field id="c-e-location" label="Location">
          <LocationSelect
            id="c-e-location"
            child={child}
            value={draft.locationId}
            onChange={(locationId) => set({ locationId })}
          />
        </Field>
        <Field id="c-e-date" label="Date">
          <Input id="c-e-date" type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} />
        </Field>
        <TimeRange idPrefix="c-e" start={draft.start} end={draft.end} onStart={(start) => set({ start })} onEnd={(end) => set({ end })} />
      </form>
    </SlideOver>
  )
}
