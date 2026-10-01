import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export type Column<T> = {
  id: string
  header: string
  cell: (row: T) => ReactNode
  primary?: boolean
  hideOnMobile?: boolean
  align?: 'start' | 'end'
}

export type DataTableProps<T> = {
  caption: string
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  status: 'pending' | 'error' | 'ready'
  errorMessage?: string | null
  onRetry?: () => void
  emptyMessage: string
  onRowSelect?: (row: T) => void
}

type LayoutProps<T> = {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  onRowSelect?: (row: T) => void
}

type TableLayoutProps<T> = LayoutProps<T> & { caption: string }

const SKELETON_TABLE_ROWS = [0, 1, 2, 3]
const SKELETON_CARDS = [0, 1, 2]
const PRIMARY_BAR_WIDTH = 'w-32'
const END_BAR_WIDTH = 'w-16 ml-auto'
// Cycled so neighbouring columns do not all look the same width.
const TEXT_BAR_WIDTHS = ['w-24', 'w-16', 'w-20']
const ERROR_FALLBACK = 'Something went wrong. Please try again.'

export const DataTable = <T,>({
  caption,
  columns,
  rows,
  rowKey,
  status,
  errorMessage,
  onRetry,
  emptyMessage,
  onRowSelect,
}: DataTableProps<T>) => {
  let content: ReactNode

  if (status === 'pending') {
    content = (
      <div aria-busy="true">
        <span className="sr-only">Loading {caption}…</span>
        <TableSkeleton columns={columns} />
        <CardSkeleton columns={columns} />
      </div>
    )
  } else if (status === 'error') {
    content = (
      <Card>
        <CardContent className="space-y-4">
          <p role="alert" className="text-sm font-medium text-destructive">
            {errorMessage ?? ERROR_FALLBACK}
          </p>
          {onRetry && (
            <Button type="button" variant="outline" onClick={onRetry}>
              Try again
            </Button>
          )}
        </CardContent>
      </Card>
    )
  } else if (rows.length === 0) {
    content = (
      <Card>
        <CardContent>
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        </CardContent>
      </Card>
    )
  } else {
    content = (
      <>
        <TableLayout
          caption={caption}
          columns={columns}
          rows={rows}
          rowKey={rowKey}
          onRowSelect={onRowSelect}
        />
        <CardLayout
          columns={columns}
          rows={rows}
          rowKey={rowKey}
          onRowSelect={onRowSelect}
        />
      </>
    )
  }

  return content
}

const TableLayout = <T,>({
  caption,
  columns,
  rows,
  rowKey,
  onRowSelect,
}: TableLayoutProps<T>) => (
  <Card className="hidden md:block">
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border">
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className={cn(
                  'px-4 py-2 text-start text-xs font-medium text-muted-foreground',
                  column.align === 'end' && 'text-end',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-border last:border-b-0 hover:bg-muted hover:cursor-pointer" onClick={() => onRowSelect?.(row)}>
              {columns.map((column) => (
                <td
                  key={column.id}
                  className={cn('px-4 py-3 align-middle', column.align === 'end' && 'text-end')}
                >
                  {
                    column.cell(row)
                  }
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </Card>
)

const CardLayout = <T,>({ columns, rows, rowKey, onRowSelect }: LayoutProps<T>) => (
  <ul className="space-y-3 md:hidden">
    {rows.map((row) => (
      <li key={rowKey(row)}>
        <Card onClick={() => onRowSelect?.(row)}>
          <CardContent className="space-y-3">
            <div className="text-sm font-medium text-foreground">
              {/* <PrimaryCell column={columns[0]} row={row} /> */}
              {columns[0].cell(row)}
            </div>
            <dl className="space-y-1.5">
              {columns
                .filter((column) => column.id !== columns[0].id && !column.hideOnMobile)
                .map((column) => (
                  <div key={column.id} className="flex items-baseline justify-between gap-4">
                    <dt className="text-xs text-muted-foreground">{column.header}</dt>
                    <dd className="text-end text-sm text-foreground">{column.cell(row)}</dd>
                  </div>
                ))}
            </dl>
          </CardContent>
        </Card>
      </li>
    ))}
  </ul>
)

type SkeletonProps<T> = { columns: Column<T>[] }

type SkeletonLineProps = { size?: 'sm' | 'xs'; className: string }

const SKELETON_BAR = 'rounded-lg bg-muted animate-pulse motion-reduce:animate-none'

const getBarWidth = <T,>(column: Column<T>, index: number): string => {
  if (index === 0) return PRIMARY_BAR_WIDTH
  if (column.align === 'end') return END_BAR_WIDTH
  return TEXT_BAR_WIDTHS[(index - 1) % TEXT_BAR_WIDTHS.length]
}

// Bar inside a line box as tall as the text it replaces: text-sm = 20px, text-xs = 16px.
const SkeletonLine = ({ size = 'sm', className }: SkeletonLineProps) => (
  <div aria-hidden="true" className={cn('flex items-center', size === 'sm' ? 'h-5' : 'h-4')}>
    <div className={cn(SKELETON_BAR, size === 'sm' ? 'h-4' : 'h-3', className)} />
  </div>
)

// One-column lists (Chats): name line, badge row, preview line, like ConversationCell.
const SingleColumnSkeleton = () => (
  <div aria-hidden="true" className="space-y-1.5">
    <SkeletonLine className="w-32" />
    <div className={cn('h-5 w-12 rounded-full', SKELETON_BAR)} />
    <SkeletonLine className="w-48" />
  </div>
)

const TableSkeleton = <T,>({ columns }: SkeletonProps<T>) => (
  <Card className="hidden md:block">
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className={cn(
                  'px-4 py-2 text-start text-xs font-medium text-muted-foreground',
                  column.align === 'end' && 'text-end',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SKELETON_TABLE_ROWS.map((row) => (
            <tr key={row} className="border-b border-border last:border-b-0">
              {columns.map((column, index) => (
                <td
                  key={column.id}
                  className={cn('px-4 py-3 align-middle', column.align === 'end' && 'text-end')}
                >
                  {columns.length === 1 ? (
                    <SingleColumnSkeleton />
                  ) : (
                    <SkeletonLine className={getBarWidth(column, index)} />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </Card>
)

const CardSkeleton = <T,>({ columns }: SkeletonProps<T>) => {
  const detailColumns = columns.slice(1).filter((column) => !column.hideOnMobile)

  return (
    <ul className="space-y-3 md:hidden">
      {SKELETON_CARDS.map((card) => (
        <li key={card}>
          <Card>
            <CardContent className="space-y-3">
              {columns.length === 1 ? (
                <SingleColumnSkeleton />
              ) : (
                <SkeletonLine className="w-32" />
              )}
              {/* The real card always renders the dl; its space-y-3 margin adds 12px. */}
              <dl className="space-y-1.5">
                {detailColumns.map((column) => (
                  <div key={column.id} className="flex items-center justify-between gap-4">
                    <SkeletonLine size="xs" className="w-16" />
                    <SkeletonLine className="w-20" />
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  )
}
