import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, RotateCcw, Trash2 } from 'lucide-react'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { SlideOver } from '@/components/shared/SlideOver'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { errorDetail } from '@/lib/api'
import { byDayOfWeek, isTimeRangeOrdered, slotRangeLabel, timeInputValue } from '@/lib/availability/availability'
import { DAY_LABELS } from '@/lib/dates/dates'
import {
  availabilityQueries,
  createSlot,
  deleteSlot,
  updateSlot,
  type AvailabilitySlot,
} from '@/lib/queries/availability'
import { cn } from '@/lib/utils'

type AvailabilitySectionProps = { tutorId: string }

type SlotDraft = {
  slot: AvailabilitySlot | null
  dayOfWeek: number
  start: string
  end: string
}

type SlotFormPanelProps = {
  draft: SlotDraft
  onChange: (draft: SlotDraft) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onClose: () => void
  pending: boolean
  errorMessage: string | null
}

type DayColumnProps = {
  label: string
  slots: AvailabilitySlot[]
  busy: boolean
  onEdit: (slot: AvailabilitySlot) => void
  onRemove: (slot: AvailabilitySlot) => void
  onRestore: (slot: AvailabilitySlot) => void
}

type SlotChipProps = Omit<DayColumnProps, 'slots'> & { slot: AvailabilitySlot }

const FALLBACK_ERROR = 'Something went wrong. Please try again.'
const LOADING_ROWS = [0, 1, 2, 3]
const FORM_ID = 'availability-slot-form'

const chipClasses = 'rounded-lg border p-2 text-xs'

export const AvailabilitySection = ({ tutorId }: AvailabilitySectionProps) => {
  const queryClient = useQueryClient()
  const { data, isPending, isError, error, refetch } = useQuery(availabilityQueries.forTutor(tutorId))
  const [draft, setDraft] = useState<SlotDraft | null>(null)
  const [removing, setRemoving] = useState<AvailabilitySlot | null>(null)

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: availabilityQueries.forTutor(tutorId).queryKey })

  const save = useMutation({
    mutationFn: (input: SlotDraft) =>
      input.slot === null
        ? createSlot(tutorId, {
            day_of_week: input.dayOfWeek,
            start_time: input.start,
            end_time: input.end,
            mode: 'anywhere',
          })
        : updateSlot(input.slot.id, { start_time: input.start, end_time: input.end }),
    onSuccess: async () => {
      setDraft(null)
      await invalidate()
    },
  })

  const remove = useMutation({
    mutationFn: (slot: AvailabilitySlot) => deleteSlot(slot.id),
    onSuccess: async () => {
      setRemoving(null)
      await invalidate()
    },
  })

  const restore = useMutation({
    mutationFn: (slot: AvailabilitySlot) => updateSlot(slot.id, { is_active: true }),
    onSuccess: invalidate,
  })

  const days = byDayOfWeek(data?.items ?? [])
  const busy = save.isPending || remove.isPending || restore.isPending
  let body: ReactNode

  const handleAdd = () => {
    save.reset()
    setDraft({ slot: null, dayOfWeek: 0, start: '09:00', end: '17:00' })
  }

  const handleEdit = (slot: AvailabilitySlot) => {
    save.reset()
    setDraft({
      slot,
      dayOfWeek: slot.day_of_week,
      start: timeInputValue(slot.start_time),
      end: timeInputValue(slot.end_time),
    })
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (draft !== null) {
      save.mutate(draft)
    }
  }

  const handleRemove = (slot: AvailabilitySlot) => {
    remove.reset()
    setRemoving(slot)
  }

  const handleConfirmRemove = () => {
    if (removing !== null) {
      remove.mutate(removing)
    }
  }

  if (isPending) {
    body = (
      <div aria-busy="true" className="space-y-3">
        <p className="text-sm text-muted-foreground">Loading availability…</p>
        {LOADING_ROWS.map((row) => (
          <div key={row} className="h-8 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    )
  } else if (isError) {
    body = (
      <div className="space-y-4">
        <p role="alert" className="text-sm font-medium text-destructive">
          {errorDetail(error) ?? FALLBACK_ERROR}
        </p>
        <Button type="button" variant="outline" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    )
  } else {
    body = (
      <div className="space-y-3">
        <div className="overflow-x-auto pb-1">
          <ul className="grid min-w-[42rem] grid-cols-7 gap-2">
            {days.map((slots, index) => (
              <DayColumn
                key={DAY_LABELS[index]}
                label={DAY_LABELS[index]}
                slots={slots}
                busy={busy}
                onEdit={handleEdit}
                onRemove={handleRemove}
                onRestore={restore.mutate}
              />
            ))}
          </ul>
        </div>
        {restore.isError && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {errorDetail(restore.error) ?? FALLBACK_ERROR}
          </p>
        )}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Availability</CardTitle>
        <CardDescription>
          The weekly slots this tutor can be booked into, Monday first. Add, edit and remove slots
          through the form — the grid itself is a read-only view.
        </CardDescription>
        <CardAction>
          <Button type="button" variant="outline" onClick={handleAdd}>
            Add slot
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>{body}</CardContent>
      {draft !== null && (
        <SlotFormPanel
          draft={draft}
          onChange={setDraft}
          onSubmit={handleSubmit}
          onClose={() => setDraft(null)}
          pending={save.isPending}
          errorMessage={save.isError ? (errorDetail(save.error) ?? FALLBACK_ERROR) : null}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={() => setRemoving(null)}
        title="Remove availability slot"
        body={
          removing === null
            ? null
            : `${DAY_LABELS[removing.day_of_week]} ${slotRangeLabel(removing)} stops being offered. It stays on the grid as inactive, so it can be restored later.`
        }
        confirmLabel="Remove slot"
        onConfirm={handleConfirmRemove}
        destructive
        pending={remove.isPending}
        errorMessage={remove.isError ? (errorDetail(remove.error) ?? FALLBACK_ERROR) : null}
      />
    </Card>
  )
}

const DayColumn = ({ label, slots, busy, onEdit, onRemove, onRestore }: DayColumnProps) => (
  <li className="space-y-2">
    <h3 className="text-xs font-medium text-muted-foreground">{label}</h3>
    {slots.length === 0 ? (
      <p className="text-xs text-muted-foreground">None</p>
    ) : (
      slots.map((slot) => (
        <SlotChip
          key={slot.id}
          slot={slot}
          label={label}
          busy={busy}
          onEdit={onEdit}
          onRemove={onRemove}
          onRestore={onRestore}
        />
      ))
    )}
  </li>
)

const SlotChip = ({ slot, label, busy, onEdit, onRemove, onRestore }: SlotChipProps) => {
  const range = slotRangeLabel(slot)

  return (
    <div
      className={cn(
        chipClasses,
        slot.is_active ? 'border-border' : 'border-dashed border-border bg-muted/40',
      )}
    >
      <p className={slot.is_active ? 'font-medium text-foreground' : 'text-muted-foreground'}>
        {range}
      </p>
      {!slot.is_active && <p className="text-muted-foreground">Inactive</p>}
      <div className="flex flex-wrap gap-1 pt-1">
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          disabled={busy}
          aria-label={`Edit ${label} ${range}`}
          onClick={() => onEdit(slot)}
        >
          <Pencil aria-hidden="true" />
        </Button>
        {slot.is_active ? (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            disabled={busy}
            aria-label={`Remove ${label} ${range}`}
            onClick={() => onRemove(slot)}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            disabled={busy}
            aria-label={`Restore ${label} ${range}`}
            onClick={() => onRestore(slot)}
          >
            <RotateCcw aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  )
}

const SlotFormPanel = ({
  draft,
  onChange,
  onSubmit,
  onClose,
  pending,
  errorMessage,
}: SlotFormPanelProps) => {
  const editing = draft.slot !== null

  return (
    <SlideOver
      open
      onOpenChange={onClose}
      title={editing ? 'Edit availability slot' : 'Add availability slot'}
      description="Times are local to the tutor and repeat every week."
      footer={
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={FORM_ID}
            disabled={pending || !isTimeRangeOrdered(draft.start, draft.end)}
          >
            {pending ? 'Saving…' : 'Save slot'}
          </Button>
        </div>
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="availability-day">Day</Label>
          <Select
            id="availability-day"
            value={String(draft.dayOfWeek)}
            disabled={editing}
            onChange={(event) => onChange({ ...draft, dayOfWeek: Number(event.target.value) })}
          >
            {DAY_LABELS.map((label, index) => (
              <option key={label} value={index}>
                {label}
              </option>
            ))}
          </Select>
          {editing && (
            <p className="text-xs text-muted-foreground">
              A slot cannot move to another day. Remove this one and add a slot on the day you want.
            </p>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="availability-start">Start time</Label>
            <Input
              id="availability-start"
              type="time"
              required
              value={draft.start}
              onChange={(event) => onChange({ ...draft, start: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="availability-end">End time</Label>
            <Input
              id="availability-end"
              type="time"
              required
              value={draft.end}
              onChange={(event) => onChange({ ...draft, end: event.target.value })}
            />
          </div>
        </div>
        {!isTimeRangeOrdered(draft.start, draft.end) && (
          <p className="text-xs text-muted-foreground">The end time must be after the start time.</p>
        )}
        {errorMessage && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {errorMessage}
          </p>
        )}
      </form>
    </SlideOver>
  )
}
