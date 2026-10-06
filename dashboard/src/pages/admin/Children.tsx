import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'

import { AddChildSlideOver } from '@/components/children/AddChildSlideOver'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { Pager } from '@/components/shared/Pager'
import { SegmentedTabs } from '@/components/shared/SegmentedTabs'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorDetail } from '@/lib/api'
import {
  AWAITING_EMPTY,
  AWAITING_SEARCH_EMPTY,
  awaitingRow,
  awaitingTabLabel,
  childTabFrom,
  evaluatedCell,
  type AwaitingRow,
  type ChildTab,
} from '@/lib/child-evaluation/childEvaluation'
import {
  childListParams,
  deactivateMessage,
  guardianNames,
  homeNames,
  nextSessionLabel,
} from '@/lib/children-list/childrenList'
import {
  childQueries,
  updateChild,
  type ChildRecord,
  type ChildSummary,
} from '@/lib/queries/children'
import { gradeLabel } from '@/lib/children/children'
import { segmentedTabId } from '@/lib/segmented-tabs/segmentedTabs'
import { DEFAULT_PAGE_SIZE } from '@/lib/queries/page'

const SEARCH_DEBOUNCE_MS = 300
const checkboxClasses = 'size-4 rounded border-input'
const LOAD_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const REACTIVATE_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const PANEL_ID = 'children-panel'
const TAB_PARAM = 'tab'
const PAGE_PARAM = 'page'
const AWAITING_TAB: ChildTab = 'awaiting'
const COUNT_PAGE_SIZE = 1
const openLinkClasses =
  'inline-flex min-h-11 items-center gap-0.5 rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-0'

// `back` is the list URL, so the child screen's "Back to children" returns to this tab and page.
const awaitingColumns = (back: { back: string }): Column<AwaitingRow>[] => [
  { id: 'name', header: 'Child', primary: true, cell: (row) => row.name },
  { id: 'guardians', header: 'Guardian', cell: (row) => row.guardians },
  { id: 'grade', header: 'Overall grade', cell: (row) => row.grade },
  { id: 'since', header: 'Since', cell: (row) => row.since },
  {
    id: 'open',
    header: 'Child screen',
    align: 'end',
    cell: (row) => (
      <Link
        to={`/children/${row.id}`}
        state={back}
        aria-label={`Open ${row.name}`}
        // The row navigates on click too; the link must not trigger it a second time.
        onClick={(event) => event.stopPropagation()}
        className={openLinkClasses}
      >
        Open
        <ChevronRight aria-hidden="true" className="size-4" />
      </Link>
    ),
  },
]

export const Children = () => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  // The page lives in the URL beside the tab, so browser back restores both together.
  const page = Number(searchParams.get(PAGE_PARAM)) || 1
  const backState = { back: `${location.pathname}${location.search}` }
  const tab = childTabFrom(searchParams.get(TAB_PARAM))
  const isAwaiting = tab === AWAITING_TAB
  const [addOpen, setAddOpen] = useState(false)
  const [deactivateTarget, setDeactivateTarget] = useState<ChildSummary | null>(null)
  const [reactivateTarget, setReactivateTarget] = useState<ChildSummary | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [searchInput])

  const setPage = (nextPage: number) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)

        if (nextPage > 1) {
          next.set(PAGE_PARAM, String(nextPage))
        } else {
          next.delete(PAGE_PARAM)
        }

        return next
      },
      { replace: true },
    )
  }

  const handleSearchInputChange = (nextSearchInput: string) => {
    setSearchInput(nextSearchInput)
    setPage(1)
  }

  const handleTabChange = (nextTab: ChildTab) => {
    setSearchParams(nextTab === AWAITING_TAB ? { [TAB_PARAM]: nextTab } : {}, { replace: true })
  }

  const handleShowInactiveChange = (nextShowInactive: boolean) => {
    setShowInactive(nextShowInactive)
    setPage(1)
  }

  const listOptions = childQueries.list(
    childListParams({
      q: search,
      showInactive,
      page,
      pageSize: DEFAULT_PAGE_SIZE,
      awaitingEvaluation: isAwaiting,
    }),
  )
  const { data, isPending, isError, error, refetch } = useQuery({
    ...listOptions,
    // Keep the old page while paging or searching, but never show the other tab's rows.
    placeholderData: (previous, previousQuery) => {
      const previousParams = previousQuery?.queryKey[2] as { awaiting_evaluation?: boolean } | undefined

      return Boolean(previousParams?.awaiting_evaluation) === isAwaiting
        ? keepPreviousData(previous)
        : undefined
    },
  })
  // The tab count ignores the search, so it reads the same on both tabs.
  const awaitingCount = useQuery(
    childQueries.list({ awaiting_evaluation: true, page: 1, page_size: COUNT_PAGE_SIZE }),
  )

  const children = data?.items ?? []
  let emptyMessage: string

  if (isAwaiting) {
    emptyMessage = search.trim() !== '' ? AWAITING_SEARCH_EMPTY : AWAITING_EMPTY
  } else if (search.trim() !== '') {
    emptyMessage = 'No children match that search.'
  } else if (showInactive) {
    emptyMessage = 'No inactive children.'
  } else {
    emptyMessage = 'No active children.'
  }

  const invalidateAfterWrite = () => {
    queryClient.invalidateQueries({ queryKey: ['children'] })
    queryClient.invalidateQueries({ queryKey: ['guardians'] })
    queryClient.invalidateQueries({ queryKey: ['households'] })
    queryClient.invalidateQueries({ queryKey: ['bookings'] })
  }

  const reactivateMutation = useMutation({
    mutationFn: (childId: string) => updateChild(childId, { is_active: true }),
    onSuccess: () => {
      invalidateAfterWrite()
      setReactivateTarget(null)
    },
  })

  const columns: Column<ChildSummary>[] = [
    { id: 'name', header: 'Name', primary: true, cell: (row) => row.name },
    { id: 'grade', header: 'Overall grade', cell: (row) => gradeLabel(row.grade_level) },
    { id: 'evaluated', header: 'Evaluated', cell: (row) => <span className="whitespace-nowrap">{evaluatedCell(row.evaluated)}</span> },
    { id: 'school', header: 'School', cell: (row) => row.school_name },
    { id: 'guardians', header: 'Guardians', cell: (row) => guardianNames(row) },
    { id: 'homes', header: 'Homes', cell: (row) => homeNames(row) },
    { id: 'next_session', header: 'Next session', cell: (row) => nextSessionLabel(row) },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => <StatusBadge status={row.is_active ? 'active' : 'inactive'} />,
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (row) => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={(event) => {
            // D-7C-5: the row's own click opens `/children/{id}`; the action must not also fire it.
            event.stopPropagation()

            if (row.is_active) {
              setDeactivateTarget(row)
            } else {
              setReactivateTarget(row)
            }
          }}
        >
          {row.is_active ? 'Deactivate' : 'Reactivate'}
        </Button>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Children</h1>
        <Button type="button" onClick={() => setAddOpen(true)}>
          Add child
        </Button>
      </div>

      <SegmentedTabs
        ariaLabel="Children"
        panelId={PANEL_ID}
        value={tab}
        onChange={handleTabChange}
        tabs={[
          { value: 'all', label: 'All' },
          {
            value: AWAITING_TAB,
            label: (
              <span className="tabular-nums">
                {awaitingTabLabel(awaitingCount.isSuccess ? awaitingCount.data.total : null)}
              </span>
            ),
          },
        ]}
      />

      <div className="flex flex-wrap items-end gap-6">
        <div className="w-full max-w-xs space-y-1.5">
          <Label htmlFor="children-search">Search children or guardians</Label>
          <Input
            id="children-search"
            type="search"
            value={searchInput}
            onChange={(event) => handleSearchInputChange(event.target.value)}
          />
        </div>
        {!isAwaiting && (
          <Label className="w-fit">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(event) => handleShowInactiveChange(event.target.checked)}
              className={checkboxClasses}
            />
            Show inactive
          </Label>
        )}
      </div>

      <div
        id={PANEL_ID}
        role="tabpanel"
        aria-labelledby={segmentedTabId(PANEL_ID, tab)}
        className="space-y-6"
      >
        {isAwaiting ? (
          <DataTable
            caption="Children awaiting evaluation"
            columns={awaitingColumns(backState)}
            rows={children.map(awaitingRow)}
            rowKey={(row) => row.id}
            status={isPending ? 'pending' : isError ? 'error' : 'ready'}
            errorMessage={errorDetail(error) ?? LOAD_FALLBACK_ERROR}
            onRetry={() => refetch()}
            emptyMessage={emptyMessage}
            onRowSelect={(row) => navigate(`/children/${row.id}`, { state: backState })}
          />
        ) : (
          <DataTable
            caption="Children"
            columns={columns}
            rows={children}
            rowKey={(row) => row.id}
            status={isPending ? 'pending' : isError ? 'error' : 'ready'}
            errorMessage={errorDetail(error) ?? LOAD_FALLBACK_ERROR}
            onRetry={() => refetch()}
            emptyMessage={emptyMessage}
            onRowSelect={(row) => navigate(`/children/${row.id}`, { state: backState })}
          />
        )}

        {data && (
          <Pager
            page={page}
            pageSize={data.page_size}
            total={data.total}
            onPageChange={setPage}
            disabled={isPending}
          />
        )}
      </div>

      <AddChildSlideOver
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={(child: ChildRecord) => navigate(`/children/${child.id}`)}
      />

      <DeactivateChildDialog
        key={deactivateTarget?.id ?? 'none'}
        child={deactivateTarget}
        onOpenChange={(open) => {
          if (!open) setDeactivateTarget(null)
        }}
        onSuccess={() => {
          invalidateAfterWrite()
          setDeactivateTarget(null)
        }}
      />

      <ConfirmDialog
        open={reactivateTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setReactivateTarget(null)
            reactivateMutation.reset()
          }
        }}
        title="Reactivate child"
        body={`Reactivate ${reactivateTarget?.name ?? ''}?`}
        confirmLabel="Reactivate"
        pending={reactivateMutation.isPending}
        errorMessage={
          reactivateMutation.isError
            ? (errorDetail(reactivateMutation.error) ?? REACTIVATE_FALLBACK_ERROR)
            : null
        }
        onConfirm={() => {
          if (reactivateTarget !== null) reactivateMutation.mutate(reactivateTarget.id)
        }}
      />
    </div>
  )
}

type DeactivateChildDialogProps = {
  child: ChildSummary | null
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

const DEACTIVATE_FALLBACK_ERROR = 'Something went wrong. Please try again.'

// P7C-O: the count shown must be the same one the server cancels by, read fresh from the child's
// detail every time the dialog opens, and refreshed again after a 409 so the admin's second
// confirm carries the true, current number. The parent remounts this component (keyed by the
// child id) whenever the target changes, so the count query and the mutation always start clean.
const DeactivateChildDialog = ({ child, onOpenChange, onSuccess }: DeactivateChildDialogProps) => {
  const countQuery = useQuery({
    ...childQueries.detail(child?.id ?? ''),
    enabled: child !== null,
    staleTime: 0,
  })
  const count = countQuery.data?.upcoming_session_count ?? null

  const mutation = useMutation({
    mutationFn: (expectedCancellations: number) =>
      updateChild(child!.id, { is_active: false, expected_cancellations: expectedCancellations }),
  })

  const handleConfirm = () => {
    if (child === null || count === null) return

    mutation.mutate(count, {
      onSuccess,
      // The server re-checks the live count against `expected_cancellations` and 409s if it
      // changed; re-read it so the dialog's next message and next confirm carry the true number.
      onError: () => countQuery.refetch(),
    })
  }

  let body: ReactNode

  if (countQuery.isError) {
    body = (
      <div className="space-y-2">
        <p role="alert" className="font-medium text-destructive">
          {errorDetail(countQuery.error) ?? LOAD_FALLBACK_ERROR}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => countQuery.refetch()}>
          Try again
        </Button>
      </div>
    )
  } else if (count === null || child === null) {
    body = 'Loading…'
  } else {
    body = deactivateMessage(child.name, count)
  }

  return (
    <ConfirmDialog
      open={child !== null}
      onOpenChange={onOpenChange}
      title="Deactivate child"
      body={body}
      confirmLabel="Deactivate"
      destructive
      pending={mutation.isPending || countQuery.isFetching || count === null}
      errorMessage={mutation.isError ? (errorDetail(mutation.error) ?? DEACTIVATE_FALLBACK_ERROR) : null}
      onConfirm={handleConfirm}
    />
  )
}
