import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'

export type PagerProps = {
  page: number; pageSize: number; total: number
  onPageChange: (page: number) => void
  disabled?: boolean
}

export const Pager = ({ page, pageSize, total, onPageChange, disabled = false }: PagerProps) => {
  const first = (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, total)
  let content: ReactNode = null

  if (page > 1 || total > pageSize) {
    content = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p aria-live="polite" className="text-sm text-muted-foreground">
          Showing {first}–{last} of {total}
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || page * pageSize >= total}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    )
  }

  return content
}
