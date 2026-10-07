import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { errorDetail, errorStatus } from '@/lib/api'
import { formatIsoDate, todayLocalIso } from '@/lib/dates/dates'
import {
  CONSENT_ACTION_LABELS,
  CONSENT_SOURCE_LABELS,
  NO_REMINDER_YET,
  blockedReason,
  canRecordConsent,
  consentSentence,
  lastReminderView,
  nextConsentAction,
  shouldShowBlockedReason,
  type ConsentAction,
} from '@/lib/guardians/reminders'
import {
  guardianReminderQueries,
  recordConsent,
  type ConsentHistoryEntry,
} from '@/lib/queries/guardianReminders'
import { cn } from '@/lib/utils'

export type GuardianRemindersSectionProps = {
  guardianId: string
  guardianName: string
}

const LOAD_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const CONFLICT_STATUS = 409
const RECORD_COPY: Record<ConsentAction, { label: string; failure: string; body: (name: string) => string }> = {
  opt_in: {
    label: 'Record opt-in',
    failure: 'Could not record the opt-in.',
    body: (name) =>
      `Only record this if ${name} asked for weekly reminders. It is saved with source Staff and your name.`,
  },
  opt_out: {
    label: 'Record opt-out',
    failure: 'Could not record the opt-out.',
    body: (name) =>
      `${name} stops getting weekly reminders. It is saved with source Staff and your name.`,
  },
}
// After the confirm dialog's close animation, which would otherwise take focus back last.
const FOCUS_AFTER_CLOSE_MS = 250
const SKELETON_PAIRS = [0, 1]
const bar = 'animate-pulse rounded-lg bg-muted motion-reduce:animate-none'

const historyColumns: Column<ConsentHistoryEntry>[] = [
  {
    id: 'date',
    header: 'Date',
    primary: true,
    cell: (row) => formatIsoDate(todayLocalIso(new Date(row.created_at))),
  },
  { id: 'action', header: 'Action', cell: (row) => CONSENT_ACTION_LABELS[row.action] },
  { id: 'source', header: 'Source', cell: (row) => CONSENT_SOURCE_LABELS[row.source] },
  { id: 'who', header: 'Who', cell: (row) => <span className="wrap-anywhere">{row.who}</span> },
]

export const GuardianRemindersSkeleton = () => (
  <Card aria-busy="true">
    <span className="sr-only">Loading weekly reminders…</span>
    <CardHeader>
      <div className={cn(bar, 'h-5 w-36')} />
      <CardAction>
        <div className={cn(bar, 'h-11 w-28 md:h-7')} />
      </CardAction>
    </CardHeader>
    <CardContent className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {SKELETON_PAIRS.map((pair) => (
          <div key={pair} className="space-y-1">
            <div className={cn(bar, 'h-3 w-24')} />
            <div className={cn(bar, 'h-4 w-56 max-w-full')} />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <div className={cn(bar, 'h-4 w-32')} />
        <DataTable
          caption="Consent history"
          columns={historyColumns}
          rows={[]}
          rowKey={(row) => row.id}
          status="pending"
          emptyMessage=""
        />
      </div>
    </CardContent>
  </Card>
)

export const GuardianRemindersSection = ({ guardianId, guardianName }: GuardianRemindersSectionProps) => {
  const queryClient = useQueryClient()
  const { data, isPending, isError, error, refetch } = useQuery(guardianReminderQueries.detail(guardianId))
  const [confirmOpen, setConfirmOpen] = useState(false)
  // Kept so the dialog's copy does not flip while it fades out after the data changes.
  const [action, setAction] = useState<ConsentAction>('opt_in')
  const stateRef = useRef<HTMLElement>(null)
  const [shouldFocusState, setShouldFocusState] = useState(false)

  // The Record button is gone once WhatsApp's block shows, so the reason takes focus instead.
  useEffect(() => {
    if (!shouldFocusState) return undefined

    const timer = window.setTimeout(() => {
      // Only rescue focus the dialog dropped; a user who already moved on keeps their place.
      if (document.activeElement === document.body) stateRef.current?.focus()
      setShouldFocusState(false)
    }, FOCUS_AFTER_CLOSE_MS)

    return () => window.clearTimeout(timer)
  }, [shouldFocusState])

  const record = useMutation({
    mutationFn: (next: ConsentAction) => recordConsent(guardianId, next),
    onSuccess: async (updated) => {
      queryClient.setQueryData(guardianReminderQueries.detail(guardianId).queryKey, updated)
      setConfirmOpen(false)
    },
    // A 409 means WhatsApp's block is newer than what is on screen: show it, and close the dialog.
    onError: async (failure) => {
      if (errorStatus(failure) === CONFLICT_STATUS) {
        await queryClient.invalidateQueries({ queryKey: guardianReminderQueries.detail(guardianId).queryKey })
        setConfirmOpen(false)
        setShouldFocusState(true)
      }
    },
  })

  if (isPending) return <GuardianRemindersSkeleton />

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Weekly reminders</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p role="alert" className="text-sm font-medium text-destructive">
            {errorDetail(error) ?? LOAD_FALLBACK_ERROR}
          </p>
          <Button type="button" variant="outline" className="h-11 md:h-8" onClick={() => refetch()}>
            Try again
          </Button>
        </CardContent>
      </Card>
    )
  }

  const nextAction = nextConsentAction(data.consent)
  const canRecord = canRecordConsent(data.consent)
  const last = data.last_reminder === null ? null : lastReminderView(data.last_reminder)
  const copy = RECORD_COPY[action]

  const handleOpen = () => {
    setAction(nextAction)
    record.reset()
    setConfirmOpen(true)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly reminders</CardTitle>
        {canRecord && (
          <CardAction>
            <Button type="button" variant="outline" size="sm" className="h-11 md:h-7" onClick={handleOpen}>
              {RECORD_COPY[nextAction].label}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <dt className="text-xs text-muted-foreground">Current state</dt>
            <dd
              ref={stateRef}
              tabIndex={-1}
              className="text-sm font-medium outline-none focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {consentSentence(data.consent)}
              {shouldShowBlockedReason(data.consent) && (
                <span className="mt-1 block text-xs font-normal text-muted-foreground">{blockedReason(data.consent)}</span>
              )}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-xs text-muted-foreground">Last reminder</dt>
            <dd className="text-sm">
              {last === null ? (
                NO_REMINDER_YET
              ) : (
                <>
                  {last.weekLine}
                  <span className="font-medium">{last.status}</span>
                  {last.detail !== null && (
                    <span
                      className={cn(
                        'block',
                        last.tone === 'error'
                          ? 'text-sm font-medium text-destructive'
                          : 'text-xs text-muted-foreground',
                      )}
                    >
                      {last.detail}
                    </span>
                  )}
                </>
              )}
            </dd>
          </div>
        </dl>
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Consent history</h3>
          <DataTable
            caption="Consent history"
            columns={historyColumns}
            rows={data.history}
            rowKey={(row) => row.id}
            status="ready"
            emptyMessage="No consent recorded yet."
          />
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={copy.label}
        body={copy.body(guardianName)}
        confirmLabel={copy.label}
        onConfirm={() => record.mutate(action)}
        pending={record.isPending}
        errorMessage={record.isError ? (errorDetail(record.error) ?? copy.failure) : null}
      />
    </Card>
  )
}
