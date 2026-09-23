import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { TutorLinkMissing } from '@/components/layout/TutorLinkMissing'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { Pager } from '@/components/shared/Pager'
import { SlideOver } from '@/components/shared/SlideOver'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/hooks/useAuth'
import { errorDetail } from '@/lib/api'
import {
  EXCEPTION_REASONS,
  exceptionPreviewLabel,
  exceptionReasonLabel,
  exceptionWindowLabel,
} from '@/lib/availability/availability'
import { todayLocalIso } from '@/lib/dates/dates'
import { DEFAULT_PAGE_SIZE } from '@/lib/queries/page'
import {
  createException,
  deleteException,
  exceptionQueries,
  exceptionQueryKey,
  type ExceptionReason,
  type TutorException,
} from '@/lib/queries/exceptions'
import {
  canWithdraw,
  draftProblem,
  draftToCreate,
  emptyDraft,
  lockedReason,
  timeOffWindow,
  withdrawConfirmBody,
  type ExceptionDraft,
  type TimeOffTab,
} from '@/lib/time-off/timeOff'

const FALLBACK_ERROR = 'Something went wrong. Please try again.'
const FORM_ID = 'time-off-form'

const tabs: { value: TimeOffTab; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
]

export const TimeOff = () => {
  const { tutorId } = useAuth()
  let content: ReactNode

  if (tutorId === null) {
    content = <TutorLinkMissing />
  } else {
    content = <TimeOffView tutorId={tutorId} />
  }

  return content
}

type TimeOffViewProps = { tutorId: string }

const TimeOffView = ({ tutorId }: TimeOffViewProps) => {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<TimeOffTab>('upcoming')
  const [page, setPage] = useState(1)
  const [draft, setDraft] = useState<ExceptionDraft | null>(null)
  const [withdrawing, setWithdrawing] = useState<TutorException | null>(null)

  const today = todayLocalIso(new Date())
  const { data, isPending, isError, error, refetch } = useQuery(
    exceptionQueries.forTutor(tutorId, {
      ...timeOffWindow(tab, today),
      page,
      page_size: DEFAULT_PAGE_SIZE,
    }),
  )

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: exceptionQueryKey(tutorId) })

  const create = useMutation({
    mutationFn: (input: ExceptionDraft) => createException(tutorId, draftToCreate(input)),
    onSuccess: async () => {
      setDraft(null)
      await invalidate()
    },
  })

  const withdraw = useMutation({
    mutationFn: (exception: TutorException) => deleteException(exception.id),
    onSuccess: async () => {
      setWithdrawing(null)
      await invalidate()
    },
    onError: () => refetch(),
  })

  const rows = data?.items ?? []

  const handleTabChange = (nextTab: TimeOffTab) => {
    setTab(nextTab)
    setPage(1)
  }

  const handleAdd = () => {
    create.reset()
    setDraft(emptyDraft())
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (draft !== null && draftProblem(draft) === null) {
      create.mutate(draft)
    }
  }

  const handleWithdraw = (exception: TutorException) => {
    withdraw.reset()
    setWithdrawing(exception)
  }

  const handleConfirmWithdraw = () => {
    if (withdrawing !== null) {
      withdraw.mutate(withdrawing)
    }
  }

  const columns: Column<TutorException>[] = [
    { id: 'window', header: 'Dates', primary: true, cell: (row) => exceptionWindowLabel(row) },
    { id: 'reason', header: 'Reason', cell: (row) => exceptionReasonLabel(row.reason) },
    { id: 'notes', header: 'Notes', hideOnMobile: true, cell: (row) => row.notes ?? '—' },
    { id: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
    {
      id: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (row) =>
        canWithdraw(row) ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={withdraw.isPending}
            onClick={() => handleWithdraw(row)}
          >
            Withdraw
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">{lockedReason(row)}</span>
        ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Time Off</h1>
        <Button type="button" onClick={handleAdd}>
          Request Time Off
        </Button>
      </div>

      <div className="inline-flex gap-1 rounded-lg border border-border p-1" role="tablist">
        {tabs.map((entry) => (
          <button
            key={entry.value}
            type="button"
            role="tab"
            aria-selected={tab === entry.value}
            onClick={() => handleTabChange(entry.value)}
            className={
              tab === entry.value
                ? 'rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground'
                : 'rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground'
            }
          >
            {entry.label}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your requests</CardTitle>
          <CardDescription>
            A request lands pending and blocks nothing until an admin approves it — the status badge
            is what says whether it has taken effect.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <DataTable
            caption="Your time-off requests"
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            status={isPending ? 'pending' : isError ? 'error' : 'ready'}
            errorMessage={errorDetail(error) ?? FALLBACK_ERROR}
            onRetry={() => refetch()}
            emptyMessage={tab === 'upcoming' ? 'No upcoming time off.' : 'No past time off.'}
          />
          {withdraw.isError && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {errorDetail(withdraw.error) ?? FALLBACK_ERROR}
            </p>
          )}
        </CardContent>
      </Card>

      {data && (
        <Pager
          page={page}
          pageSize={data.page_size}
          total={data.total}
          onPageChange={setPage}
          disabled={isPending}
        />
      )}

      {draft !== null && (
        <TimeOffFormPanel
          draft={draft}
          onChange={setDraft}
          onSubmit={handleSubmit}
          onClose={() => setDraft(null)}
          pending={create.isPending}
          errorMessage={create.isError ? (errorDetail(create.error) ?? FALLBACK_ERROR) : null}
        />
      )}

      <ConfirmDialog
        open={withdrawing !== null}
        onOpenChange={() => setWithdrawing(null)}
        title="Withdraw request"
        body={withdrawing === null ? null : withdrawConfirmBody(withdrawing)}
        confirmLabel="Withdraw request"
        onConfirm={handleConfirmWithdraw}
        destructive
        pending={withdraw.isPending}
        errorMessage={withdraw.isError ? (errorDetail(withdraw.error) ?? FALLBACK_ERROR) : null}
      />
    </div>
  )
}

type TimeOffFormPanelProps = {
  draft: ExceptionDraft
  onChange: (draft: ExceptionDraft) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onClose: () => void
  pending: boolean
  errorMessage: string | null
}

const TimeOffFormPanel = ({
  draft,
  onChange,
  onSubmit,
  onClose,
  pending,
  errorMessage,
}: TimeOffFormPanelProps) => {
  const problem = draftProblem(draft)

  return (
    <SlideOver
      open
      onOpenChange={onClose}
      title="Request Time Off"
      description="A request lands pending. An admin reviews it before it blocks any bookings."
      footer={
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} disabled={pending || problem !== null}>
            {pending ? 'Sending…' : 'Send request'}
          </Button>
        </div>
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="time-off-start-date">First day</Label>
            <Input
              id="time-off-start-date"
              type="date"
              required
              value={draft.startDate}
              onChange={(event) => onChange({ ...draft, startDate: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="time-off-end-date">Last day</Label>
            <Input
              id="time-off-end-date"
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
            day in the range.
          </p>
          <div className="grid gap-4 pt-1 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="time-off-start-time">Start time</Label>
              <Input
                id="time-off-start-time"
                type="time"
                value={draft.startTime}
                onChange={(event) => onChange({ ...draft, startTime: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="time-off-end-time">End time</Label>
              <Input
                id="time-off-end-time"
                type="time"
                value={draft.endTime}
                onChange={(event) => onChange({ ...draft, endTime: event.target.value })}
              />
            </div>
          </div>
        </fieldset>
        {draft.startDate !== '' && draft.endDate !== '' && draft.endDate >= draft.startDate && (
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
          <Label htmlFor="time-off-reason">Reason</Label>
          <Select
            id="time-off-reason"
            value={draft.reason}
            onChange={(event) => onChange({ ...draft, reason: event.target.value as ExceptionReason })}
          >
            {EXCEPTION_REASONS.map((reason) => (
              <option key={reason.value} value={reason.value}>
                {reason.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="time-off-notes">Notes</Label>
          <Textarea
            id="time-off-notes"
            value={draft.notes}
            onChange={(event) => onChange({ ...draft, notes: event.target.value })}
          />
        </div>
        {problem !== null && (
          <p className="text-xs text-muted-foreground">{problem}</p>
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
