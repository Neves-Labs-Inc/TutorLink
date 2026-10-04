// PROTOTYPE ONLY (ticket #112, screen `awaiting`). Variants disagree on where the list lives:
// A its own sidebar page, B a card on the dashboard home, C a tab on the Children list.
import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

import { DataTable, type Column } from '@/components/shared/DataTable'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  ALL_CHILDREN_ROWS,
  AWAITING_ROWS,
  formatOverallGrade,
  type AwaitingRow,
  type ChildListRow,
} from '@/lib/prototype/staffScreensData'
import { cn } from '@/lib/utils'

type AwaitingScreenPrototypeProps = {
  variant: string
  onOpenChild: (childId: string) => void
  onSeeAll: () => void
}

type ListTab = 'all' | 'awaiting'

const DASHBOARD_PREVIEW_COUNT = 3

const linkClasses =
  'inline-flex items-center gap-0.5 rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

const awaitingColumns = (onOpenChild: (childId: string) => void): Column<AwaitingRow>[] => [
  { id: 'child', header: 'Child', primary: true, cell: (row) => row.child },
  { id: 'guardian', header: 'Guardian', cell: (row) => row.guardian },
  { id: 'grade', header: 'Overall grade', cell: (row) => formatOverallGrade(row.overallGrade) },
  { id: 'reason', header: 'Reason', cell: (row) => row.reason },
  { id: 'since', header: 'Since', cell: (row) => row.since },
  {
    id: 'open',
    header: 'Child screen',
    align: 'end',
    hideOnMobile: true,
    cell: (row) => (
      <button type="button" className={linkClasses} onClick={() => onOpenChild(row.childId)}>
        Open
        <ChevronRight aria-hidden="true" className="size-4" />
      </button>
    ),
  },
]

export const AwaitingScreenPrototype = ({ variant, onOpenChild, onSeeAll }: AwaitingScreenPrototypeProps) => {
  let content: ReactNode = <AwaitingVariantA onOpenChild={onOpenChild} />
  if (variant === 'B') content = <AwaitingVariantB onOpenChild={onOpenChild} onSeeAll={onSeeAll} />
  if (variant === 'C') content = <AwaitingVariantC onOpenChild={onOpenChild} />
  return content
}

const AwaitingVariantA = ({ onOpenChild }: { onOpenChild: (childId: string) => void }) => (
  <div className="space-y-6">
    <div className="space-y-1">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">Awaiting evaluation</h1>
      <p className="text-sm text-muted-foreground">
        Children not Evaluated yet, and Evaluated Children with a subject the bot handed to the
        office because it had no level.
      </p>
    </div>
    <DataTable
      caption="Children awaiting evaluation"
      columns={awaitingColumns(onOpenChild)}
      rows={AWAITING_ROWS}
      rowKey={(row) => row.child}
      status="ready"
      emptyMessage="No Children awaiting evaluation."
      onRowSelect={(row) => onOpenChild(row.childId)}
    />
  </div>
)

const STATS = [
  { label: 'Sessions today', value: 12, detail: 'Live on Oct 4' },
  { label: 'Sessions this week', value: 58, detail: 'Oct 4 – Oct 10' },
  { label: 'Active tutors', value: 9, detail: 'Taking bookings' },
  { label: 'Active guardians', value: 41, detail: 'With a linked Child' },
]

const AwaitingVariantB = ({
  onOpenChild,
  onSeeAll,
}: {
  onOpenChild: (childId: string) => void
  onSeeAll: () => void
}) => (
  <div className="space-y-6">
    <h1 className="font-heading text-2xl font-semibold tracking-tight">Dashboard</h1>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {STATS.map((stat) => (
        <Card key={stat.label}>
          <CardContent className="space-y-1">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p className="font-heading text-3xl font-semibold tabular-nums">{stat.value}</p>
            <p className="text-xs text-muted-foreground">{stat.detail}</p>
          </CardContent>
        </Card>
      ))}
    </div>

    <Card>
      <CardHeader>
        <CardTitle>{AWAITING_ROWS.length} Children awaiting evaluation</CardTitle>
        <CardDescription>Until then the bot hands their bookings to the office.</CardDescription>
        <CardAction>
          <Button type="button" variant="outline" size="sm" onClick={onSeeAll}>
            See all
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {AWAITING_ROWS.slice(0, DASHBOARD_PREVIEW_COUNT).map((row) => (
            <li key={row.child}>
              <button
                type="button"
                onClick={() => onOpenChild(row.childId)}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-start hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{row.child}</span>
                  <span className="block text-xs text-muted-foreground">
                    {row.guardian} · {formatOverallGrade(row.overallGrade)}
                  </span>
                </span>
                <span className="text-end text-xs text-muted-foreground">
                  <span className="block text-sm text-foreground">{row.reason}</span>
                  since {row.since}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Today&apos;s sessions</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">(Existing table, unchanged.)</p>
      </CardContent>
    </Card>
  </div>
)

const TABS: { value: ListTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'awaiting', label: `Awaiting evaluation (${AWAITING_ROWS.length})` },
]

const allColumns: Column<ChildListRow>[] = [
  { id: 'name', header: 'Name', primary: true, cell: (row) => row.name },
  { id: 'grade', header: 'Overall grade', cell: (row) => formatOverallGrade(row.overallGrade) },
  { id: 'guardian', header: 'Guardian', cell: (row) => row.guardian },
  { id: 'evaluated', header: 'Evaluated', cell: (row) => row.evaluated },
]

const AwaitingVariantC = ({ onOpenChild }: { onOpenChild: (childId: string) => void }) => {
  const [tab, setTab] = useState<ListTab>('awaiting')

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Children</h1>
        <Button type="button">Add child</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex gap-1 rounded-lg border border-border p-1" role="tablist">
          {TABS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              role="tab"
              aria-selected={tab === entry.value}
              onClick={() => setTab(entry.value)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium',
                tab === entry.value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <Input className="max-w-xs" placeholder="Search children" aria-label="Search children" />
      </div>
      {tab === 'all' ? (
        <DataTable
          caption="Children"
          columns={allColumns}
          rows={ALL_CHILDREN_ROWS}
          rowKey={(row) => row.name}
          status="ready"
          emptyMessage="No children yet."
          onRowSelect={(row) => onOpenChild(row.childId)}
        />
      ) : (
        <DataTable
          caption="Children awaiting evaluation"
          columns={awaitingColumns(onOpenChild)}
          rows={AWAITING_ROWS}
          rowKey={(row) => row.child}
          status="ready"
          emptyMessage="No Children awaiting evaluation."
          onRowSelect={(row) => onOpenChild(row.childId)}
        />
      )}
    </div>
  )
}
