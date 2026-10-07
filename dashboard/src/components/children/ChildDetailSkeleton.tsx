import { DataTable, type Column } from '@/components/shared/DataTable'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { LEVEL_HEADERS } from '@/lib/child-evaluation/childEvaluation'
import { cn } from '@/lib/utils'

const BAR = 'rounded-lg bg-muted animate-pulse motion-reduce:animate-none'
const DETAIL_PAIRS = [0, 1, 2, 3]
const GRADE_PAIR = 1

const LEVEL_COLUMNS: Column<never>[] = [
  { id: 'subject', header: LEVEL_HEADERS.subject, primary: true, cell: () => null },
  { id: 'level', header: LEVEL_HEADERS.level, cell: () => null },
  { id: 'set_by', header: LEVEL_HEADERS.setBy, cell: () => null },
  { id: 'actions', header: LEVEL_HEADERS.actions, align: 'end', cell: () => null },
]

// Shaped like Details, the Evaluated card and the Subject levels table it stands in for.
export const ChildDetailSkeleton = () => (
  <div aria-busy="true" className="space-y-6">
    <span className="sr-only">Loading child…</span>
    <Card aria-hidden="true">
      <CardHeader>
        <div className="flex h-6 items-center">
          <div className={cn(BAR, 'h-4 w-16')} />
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 sm:grid-cols-2">
          {DETAIL_PAIRS.map((pair) => (
            <div key={pair} className="space-y-1">
              <dt className={cn(BAR, 'h-3 w-20')} />
              <dd className={cn(BAR, 'h-4 w-28')} />
              {pair === GRADE_PAIR && <div className={cn(BAR, 'h-3 w-56 max-w-full')} />}
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>

    <section className="space-y-3">
      <h2 className="font-heading text-lg font-semibold tracking-tight">Evaluation</h2>
      <Card aria-hidden="true">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2">
            <div className={cn(BAR, 'mt-0.5 size-4 rounded-full')} />
            <div className="space-y-0.5">
              <div className={cn(BAR, 'h-4 w-40')} />
              <div className={cn(BAR, 'h-4 w-64 max-w-full')} />
            </div>
          </div>
          <div className={cn(BAR, 'h-11 w-full sm:w-32 md:h-8')} />
        </CardContent>
      </Card>
      {/* The page announces "Loading child…" once; the table's own status would repeat it. */}
      <div aria-hidden="true">
        <DataTable
          caption="Subject levels"
          columns={LEVEL_COLUMNS}
          rows={[]}
          rowKey={() => ''}
          status="pending"
          emptyMessage=""
        />
      </div>
    </section>
  </div>
)
