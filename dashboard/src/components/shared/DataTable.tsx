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

const LOADING_ROWS = [0, 1, 2, 3]
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
      <Card>
        <CardContent aria-busy="true" className="space-y-3">
          <p className="text-sm text-muted-foreground">Loading…</p>
          {LOADING_ROWS.map((row) => (
            <div key={row} className="h-8 animate-pulse rounded-lg bg-muted" />
          ))}
        </CardContent>
      </Card>
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
