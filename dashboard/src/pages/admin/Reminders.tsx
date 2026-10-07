import { useRef, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { DataTable, type Column } from '@/components/shared/DataTable'
import { SegmentedTabs } from '@/components/shared/SegmentedTabs'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { errorDetail } from '@/lib/api'
import { ADMIN_ROLES } from '@/lib/auth/auth'
import { segmentedTabId } from '@/lib/segmented-tabs/segmentedTabs'
import { reminderQueries } from '@/lib/queries/reminders'
import { settingQueries } from '@/lib/queries/settings'
import {
  ATTENTION_STATUSES,
  NO_VALUE,
  attentionCount,
  isCurrentWeek,
  isPaused,
  parseWeekParam,
  previewOutcome,
  scheduleLine,
  sentAtLabel,
  sentDetail,
  stepWeek,
  weekLabel,
  type Language,
  type ReminderPreviewItem,
  type ReminderRow,
} from '@/lib/reminders/reminders'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/authStore'

const WEEK_PARAM = 'week'
const VIEW_PARAM = 'view'
const ATTENTION_VIEW = 'attention'
const PANEL_ID = 'reminder-rows'
const LOAD_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const LANGUAGE_LABELS: Record<Language, string> = { en: 'English', es: 'Spanish' }
const BAR = 'rounded-lg bg-muted animate-pulse motion-reduce:animate-none'
const weekButtonClasses = 'size-11 md:size-8'
const UNAVAILABLE_CLASSES = 'pointer-events-none opacity-50'
const guardianLinkClasses =
  'inline-flex min-h-11 items-center rounded-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-0'

type View = 'all' | typeof ATTENTION_VIEW
type GuardianRow = { guardian_id: string; guardian_name: string; child_names: string[]; language: Language }

const guardianColumns = <T extends GuardianRow>(): Column<T>[] => [
  {
    id: 'guardian',
    header: 'Guardian',
    primary: true,
    cell: (row) => (
      <Link
        to={`/guardians/${row.guardian_id}`}
        // The row navigates on click too; the link must not trigger it a second time.
        onClick={(event) => event.stopPropagation()}
        className={guardianLinkClasses}
      >
        {row.guardian_name}
      </Link>
    ),
  },
  { id: 'children', header: 'Children', cell: (row) => row.child_names.join(', ') },
  { id: 'language', header: 'Language', cell: (row) => LANGUAGE_LABELS[row.language] },
]

const mutedText = (text: string | null): ReactNode => (
  <span className="text-muted-foreground">{text ?? NO_VALUE}</span>
)

const previewColumns: Column<ReminderPreviewItem>[] = [
  ...guardianColumns<ReminderPreviewItem>(),
  {
    id: 'outcome',
    header: 'Outcome',
    cell: (row) => <StatusBadge status={previewOutcome(row).key} />,
  },
  { id: 'reason', header: 'Reason', cell: (row) => mutedText(previewOutcome(row).reason) },
]

const sentColumns: Column<ReminderRow>[] = [
  ...guardianColumns<ReminderRow>(),
  { id: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
  {
    id: 'detail',
    header: 'Detail',
    cell: (row) => {
      const { text, tone } = sentDetail(row)

      if (tone === 'error') return <span className="text-destructive">{text}</span>
      // Uncertain, not failed: the message may well have arrived.
      if (tone === 'warning') return <span className="text-status-pending">{text}</span>

      return mutedText(text)
    },
  },
  {
    id: 'sent_at',
    header: 'Sent at',
    cell: (row) => <span className="whitespace-nowrap">{sentAtLabel(row.sent_at)}</span>,
  },
]

const viewFrom = (raw: string | null): View => (raw === ATTENTION_VIEW ? ATTENTION_VIEW : 'all')

const rowKey = (row: GuardianRow): string => row.guardian_id

export const Reminders = () => {
  const navigate = useNavigate()
  const role = useAuthStore((state) => state.role)
  const previousRef = useRef<HTMLButtonElement>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const week = parseWeekParam(searchParams.get(WEEK_PARAM))
  const view = viewFrom(searchParams.get(VIEW_PARAM))

  const canReadSettings = role !== null && ADMIN_ROLES.includes(role)
  const weekQuery = useQuery(reminderQueries.week({ weekStart: week }))
  // A chosen week hides the default week's date, which the Next button needs.
  const defaultQuery = useQuery({ ...reminderQueries.week({ weekStart: null }), enabled: week !== null })
  const defaultWeek = week === null ? weekQuery.data?.week_start : defaultQuery.data?.week_start
  const hasRun = weekQuery.data !== undefined && (weekQuery.data.has_run || weekQuery.data.preview === null)
  const isAttention = hasRun && view === ATTENTION_VIEW
  const attentionQuery = useQuery({
    ...reminderQueries.week({ weekStart: week, statuses: ATTENTION_STATUSES }),
    enabled: isAttention,
  })
  const settingsQuery = useQuery({
    ...settingQueries.list(),
    enabled: canReadSettings,
  })

  const shownQuery = isAttention ? attentionQuery : weekQuery
  // A chosen week needs the default week's date to know where Next stops, so its failure is shown too.
  const defaultFailed = week !== null && defaultQuery.isError
  const isFailed = weekQuery.isError || defaultFailed
  const status = shownQuery.isError || defaultFailed ? 'error' : shownQuery.isPending ? 'pending' : 'ready'
  const failedError = shownQuery.isError ? shownQuery.error : defaultQuery.error
  const errorMessage = errorDetail(failedError) ?? LOAD_FALLBACK_ERROR
  const isFirstLoad = weekQuery.isPending
  const preview = weekQuery.data?.preview ?? null
  // Only the default week can show a preview, so a chosen week loads with the Sent columns.
  const showsPreview = !hasRun && (preview !== null || (isFirstLoad && week === null))
  const rows = shownQuery.data?.rows ?? []
  const schedule = scheduleLine(role, settingsQuery.data)
  // A hand-edited ?week= at or past the default week is the current week too.
  const isNextUnavailable = isCurrentWeek(week, defaultWeek) || weekQuery.isPending || defaultWeek === undefined
  const isPreviousUnavailable = weekQuery.isPending || (week === null && defaultWeek === undefined)
  const showsTabs = !isFailed && (hasRun || (week !== null && !showsPreview))

  const setParams = (update: (next: URLSearchParams) => void) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)

        update(next)

        return next
      },
      { replace: true },
    )
  }

  const handleStep = (direction: 1 | -1) => {
    const shown = week ?? defaultWeek

    if (shown === undefined) return

    const target = stepWeek(shown, direction, defaultWeek)

    // Next becomes unavailable on the default week; keep keyboard focus on a live button.
    if (target === null) previousRef.current?.focus()

    // A week change starts on All: the other week's attention list means nothing here.
    setSearchParams(target === null ? {} : { [WEEK_PARAM]: target })
  }

  const handleRetry = () => {
    if (shownQuery.isError) shownQuery.refetch()
    if (defaultFailed) defaultQuery.refetch()
  }

  const handleViewChange = (next: View) => {
    setParams((params) => {
      if (next === ATTENTION_VIEW) {
        params.set(VIEW_PARAM, next)
      } else {
        params.delete(VIEW_PARAM)
      }
    })
  }

  let weekText: ReactNode = <div aria-hidden="true" className={cn('h-4 w-36', BAR)} />

  if (weekQuery.data !== undefined) {
    weekText = weekLabel(weekQuery.data.week_start)
  } else if (isFailed) {
    weekText = week === null ? null : weekLabel(week)
  }

  const sentCount = attentionCount(weekQuery.data?.rows ?? [])
  const allLabel = weekQuery.data === undefined ? 'All' : `All (${weekQuery.data.rows.length})`
  const attentionLabel = weekQuery.data === undefined ? 'Needs attention' : `Needs attention (${sentCount})`
  const emptyMessage = isAttention
    ? 'No reminders need attention this week.'
    : 'No reminders were sent this week.'

  const table = showsPreview ? (
    <DataTable
      caption="Reminder preview"
      columns={previewColumns}
      rows={preview ?? []}
      rowKey={rowKey}
      status={status}
      errorMessage={errorMessage}
      onRetry={handleRetry}
      emptyMessage="No Guardians are due this week."
      onRowSelect={(row) => navigate(`/guardians/${row.guardian_id}`)}
    />
  ) : (
    <DataTable
      caption={isAttention ? 'Reminders needing attention' : 'Reminders sent'}
      columns={sentColumns}
      rows={rows}
      rowKey={rowKey}
      status={status}
      errorMessage={errorMessage}
      onRetry={handleRetry}
      emptyMessage={emptyMessage}
      onRowSelect={(row) => navigate(`/guardians/${row.guardian_id}`)}
    />
  )

  const isHeadingPending = isFirstLoad
  let heading = showsPreview ? 'Preview' : 'Sent'
  let description = showsPreview
    ? "The run hasn't happened yet. This is who it would remind if it ran now."
    : "What the run sent for this week, with WhatsApp's latest delivery status."

  if (isFailed) {
    heading = ''
    description = ''
  }

  return (
    <div className="space-y-6" aria-busy={isFirstLoad || shownQuery.isPending}>
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Reminders</h1>
          {(!isFailed || week !== null) && (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Previous week"
                ref={previousRef}
                // aria-disabled, not disabled: a disabled button drops keyboard focus to <body>.
                aria-disabled={isPreviousUnavailable || undefined}
                className={cn(weekButtonClasses, isPreviousUnavailable && UNAVAILABLE_CLASSES)}
                onClick={() => {
                  if (!isPreviousUnavailable) handleStep(-1)
                }}
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <span
                aria-live="polite"
                className="flex h-5 min-w-36 items-center justify-center text-center text-sm font-medium tabular-nums"
              >
                {weekText}
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Next week"
                aria-disabled={isNextUnavailable || undefined}
                className={cn(weekButtonClasses, isNextUnavailable && UNAVAILABLE_CLASSES)}
                onClick={() => {
                  if (!isNextUnavailable) handleStep(1)
                }}
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>
        {!isFailed && schedule !== null && (
          <p className="text-sm text-muted-foreground">{schedule}</p>
        )}
        {!isFailed && schedule === null && canReadSettings && settingsQuery.isPending && (
          <div className="flex h-5 items-center" aria-hidden="true">
            <div className={cn('h-4 w-56', BAR)} />
          </div>
        )}
      </div>

      {!isFailed && preview !== null && !hasRun && isPaused(preview) && (
        <p role="status" className="rounded-lg border border-border bg-muted px-3 py-2 text-sm">
          <span className="font-medium">Reminders are paused.</span>{' '}
          <span className="text-muted-foreground">
            No reminder template is approved yet, so every Guardian below will be skipped. A developer
            adds the template ids once WhatsApp approves them.
          </span>
        </p>
      )}

      <div className="space-y-3">
        {!isFailed && (
          <div className="space-y-1">
            {isHeadingPending ? (
              <>
                <div className="flex h-7 items-center" aria-hidden="true">
                  <div className={cn('h-5 w-24', BAR)} />
                </div>
                <div className="flex h-5 items-center" aria-hidden="true">
                  <div className={cn('h-4 w-72 max-w-full', BAR)} />
                </div>
              </>
            ) : (
              <>
                <h2 className="font-heading text-lg font-semibold tracking-tight">{heading}</h2>
                <p className="text-sm text-muted-foreground">{description}</p>
              </>
            )}
          </div>
        )}

        {showsTabs && (
          <SegmentedTabs
            ariaLabel="Reminder rows"
            panelId={PANEL_ID}
            value={view}
            onChange={handleViewChange}
            tabs={[
              { value: 'all', label: <span className="tabular-nums">{allLabel}</span> },
              { value: ATTENTION_VIEW, label: <span className="tabular-nums">{attentionLabel}</span> },
            ]}
          />
        )}

        <div
          id={PANEL_ID}
          role={showsTabs ? 'tabpanel' : undefined}
          aria-labelledby={showsTabs ? segmentedTabId(PANEL_ID, view) : undefined}
        >
          {table}
        </div>
      </div>
    </div>
  )
}
