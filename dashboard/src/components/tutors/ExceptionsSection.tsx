import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { SlideOver } from '@/components/shared/SlideOver'
import { StatusBadge } from '@/components/shared/StatusBadge'
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
import { Textarea } from '@/components/ui/textarea'
import { errorDetail } from '@/lib/api'
import {
  EXCEPTION_REASONS,
  exceptionPreviewLabel,
  exceptionReasonLabel,
  exceptionTimesAcceptable,
  exceptionWindowLabel,
  isDecidable,
  weekdaysInRange,
} from '@/lib/availability'
import {
  createException,
  decideException,
  deleteException,
  exceptionQueries,
  type ExceptionDecision,
  type ExceptionReason,
  type TutorException,
} from '@/lib/queries/exceptions'

type ExceptionsSectionProps = { tutorId: string }

type ExceptionDraft = {
  startDate: string
  endDate: string
  startTime: string
  endTime: string
  reason: ExceptionReason
  notes: string
}

type ExceptionFormPanelProps = {
  draft: ExceptionDraft
  onChange: (draft: ExceptionDraft) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onClose: () => void
  pending: boolean
  errorMessage: string | null
}

const FALLBACK_ERROR = 'Something went wrong. Please try again.'
const FORM_ID = 'tutor-exception-form'

const emptyDraft = (): ExceptionDraft => ({
  startDate: '',
  endDate: '',
  startTime: '',
  endTime: '',
  reason: 'vacation',
  notes: '',
})

export const ExceptionsSection = ({ tutorId }: ExceptionsSectionProps) => {
  const queryClient = useQueryClient()
  const { data, isPending, isError, error, refetch } = useQuery(exceptionQueries.forTutor(tutorId))
  const [draft, setDraft] = useState<ExceptionDraft | null>(null)
  const [deleting, setDeleting] = useState<TutorException | null>(null)

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: exceptionQueries.forTutor(tutorId).queryKey })

  const create = useMutation({
    mutationFn: (input: ExceptionDraft) =>
      createException(tutorId, {
        start_date: input.startDate,
        end_date: input.endDate,
        start_time: input.startTime === '' ? null : input.startTime,
        end_time: input.endTime === '' ? null : input.endTime,
        reason: input.reason,
        notes: input.notes.trim() === '' ? null : input.notes.trim(),
      }),
    onSuccess: async () => {
      setDraft(null)
      await invalidate()
    },
  })

  const decide = useMutation({
    mutationFn: (input: { exception: TutorException; status: ExceptionDecision }) =>
      decideException(input.exception.id, input.status),
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: (exception: TutorException) => deleteException(exception.id),
    onSuccess: async () => {
      setDeleting(null)
      await invalidate()
    },
  })

  const rows = data?.items ?? []
  const busy = decide.isPending || remove.isPending

  const handleAdd = () => {
    create.reset()
    setDraft(emptyDraft())
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (draft !== null) {
      create.mutate(draft)
    }
  }

  const handleDelete = (exception: TutorException) => {
    remove.reset()
    setDeleting(exception)
  }

  const handleConfirmDelete = () => {
    if (deleting !== null) {
      remove.mutate(deleting)
    }
  }

  const columns: Column<TutorException>[] = [
    {
      id: 'window',
      header: 'When',
      primary: true,
      cell: (row) => exceptionWindowLabel(row),
    },
    { id: 'reason', header: 'Reason', cell: (row) => exceptionReasonLabel(row.reason) },
    {
      id: 'notes',
      header: 'Notes',
      hideOnMobile: true,
      cell: (row) => row.notes ?? '—',
    },
    { id: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
    {
      id: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (row) => (
        <div className="flex flex-wrap justify-end gap-2">
          {isDecidable(row) && (
            <>
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => decide.mutate({ exception: row, status: 'approved' })}
              >
                Approve
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => decide.mutate({ exception: row, status: 'rejected' })}
              >
                Reject
              </Button>
            </>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => handleDelete(row)}
          >
            Delete
          </Button>
        </div>
      ),
    },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Exceptions</CardTitle>
        <CardDescription>
          Time off that overrides the weekly availability. An exception blocks bookings only once it
          is approved.
        </CardDescription>
        <CardAction>
          <Button type="button" variant="outline" onClick={handleAdd}>
            Add exception
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <DataTable
          caption="Availability exceptions for this tutor"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          status={isPending ? 'pending' : isError ? 'error' : 'ready'}
          errorMessage={errorDetail(error) ?? FALLBACK_ERROR}
          onRetry={() => refetch()}
          emptyMessage="This tutor has no exceptions."
        />
        {decide.isError && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {errorDetail(decide.error) ?? FALLBACK_ERROR}
          </p>
        )}
      </CardContent>
      {draft !== null && (
        <ExceptionFormPanel
          draft={draft}
          onChange={setDraft}
          onSubmit={handleSubmit}
          onClose={() => setDraft(null)}
          pending={create.isPending}
          errorMessage={create.isError ? (errorDetail(create.error) ?? FALLBACK_ERROR) : null}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={() => setDeleting(null)}
        title="Delete exception"
        body={
          deleting === null
            ? null
            : `${exceptionWindowLabel(deleting)} will be deleted for good. Deleting is the only way back from a mistaken approval: a decided exception cannot be re-decided.`
        }
        confirmLabel="Delete exception"
        onConfirm={handleConfirmDelete}
        destructive
        pending={remove.isPending}
        errorMessage={remove.isError ? (errorDetail(remove.error) ?? FALLBACK_ERROR) : null}
      />
    </Card>
  )
}

const ExceptionFormPanel = ({
  draft,
  onChange,
  onSubmit,
  onClose,
  pending,
  errorMessage,
}: ExceptionFormPanelProps) => {
  const datesReady = draft.startDate !== '' && draft.endDate !== '' && draft.endDate >= draft.startDate
  const timesReady = exceptionTimesAcceptable(draft.startTime, draft.endTime)
  const weekdays = datesReady ? weekdaysInRange(draft.startDate, draft.endDate) : []

  return (
    <SlideOver
      open
      onOpenChange={onClose}
      title="Add exception"
      description="Added here, an exception is approved immediately — an admin's own entry needs no review, unlike a tutor's request from their time-off page."
      footer={
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} disabled={pending || !datesReady || !timesReady}>
            {pending ? 'Saving…' : 'Add exception'}
          </Button>
        </div>
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="exception-start-date">First day</Label>
            <Input
              id="exception-start-date"
              type="date"
              required
              value={draft.startDate}
              onChange={(event) => onChange({ ...draft, startDate: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exception-end-date">Last day</Label>
            <Input
              id="exception-end-date"
              type="date"
              required
              min={draft.startDate}
              value={draft.endDate}
              onChange={(event) => onChange({ ...draft, endDate: event.target.value })}
            />
          </div>
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Hours blocked on each of those days</legend>
          <p className="text-xs text-muted-foreground">
            Leave both empty to block every day in full. Set both to block only those hours on each
            day in the range — the nights in between stay bookable.
          </p>
          <div className="grid gap-4 pt-1 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="exception-start-time">Start time</Label>
              <Input
                id="exception-start-time"
                type="time"
                value={draft.startTime}
                onChange={(event) => onChange({ ...draft, startTime: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exception-end-time">End time</Label>
              <Input
                id="exception-end-time"
                type="time"
                value={draft.endTime}
                onChange={(event) => onChange({ ...draft, endTime: event.target.value })}
              />
            </div>
          </div>
          {!timesReady && (
            <p className="text-xs text-muted-foreground">
              Set both times, or neither, and end the range after it starts.
            </p>
          )}
        </fieldset>
        {weekdays.length > 0 && timesReady && (
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            {exceptionPreviewLabel({
              start_date: draft.startDate,
              end_date: draft.endDate,
              start_time: draft.startTime === '' ? null : draft.startTime,
              end_time: draft.endTime === '' ? null : draft.endTime,
            })}
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="exception-reason">Reason</Label>
          <Select
            id="exception-reason"
            value={draft.reason}
            onChange={(event) =>
              onChange({ ...draft, reason: event.target.value as ExceptionReason })
            }
          >
            {EXCEPTION_REASONS.map((reason) => (
              <option key={reason.value} value={reason.value}>
                {reason.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="exception-notes">Notes</Label>
          <Textarea
            id="exception-notes"
            value={draft.notes}
            onChange={(event) => onChange({ ...draft, notes: event.target.value })}
          />
        </div>
        {errorMessage && (
          <p role="alert" className="text-sm font-medium text-destructive">
            {errorMessage}
          </p>
        )}
      </form>
    </SlideOver>
  )
}
