import { useEffect, useState } from 'react'

import { clampPage } from '@/lib/pagination/clampPage'

type PageData = { items: unknown[]; total: number; page_size: number }

type Options = {
  page: number
  setPage: (page: number) => void
  data: PageData | undefined
  isPlaceholderData: boolean
  isFetching: boolean
}

type ClampedPage = {
  // Hand these to Pager: clamped and held at the clamping response's total, so it never shows an
  // inverted range or a stale cached count while the clamped page loads.
  pagerPage: number
  pagerTotal: number
  // Past the end, or clamped and still loading: show loading, never the empty copy.
  outOfRange: boolean
}

// Moves a paginated list back to its last page when fresh data shows the current page has gone past the end.
export function useClampedPage({
  page,
  setPage,
  data,
  isPlaceholderData,
  isFetching,
}: Options): ClampedPage {
  // The total from the response that triggered the clamp; null when no clamp is in flight.
  const [clampedTotal, setClampedTotal] = useState<number | null>(null)
  const total = data?.total
  const pageSize = data?.page_size
  const isFresh = !isPlaceholderData && total !== undefined && pageSize !== undefined
  const needsClamp = isFresh && clampPage(page, total, pageSize) !== page
  const isEmptyPlaceholder =
    isPlaceholderData && data !== undefined && data.total > 0 && data.items.length === 0

  // Adjusted during render (React's "storing information from previous renders"), not in an effect.
  if (needsClamp && clampedTotal === null && total !== undefined) {
    setClampedTotal(total)
  }
  // A cached target page can render as fresh while its refetch is in flight, so wait for the fetch.
  // Settles on in-range data, or on no data at all (the fetch failed and the error state takes over).
  if (clampedTotal !== null && !needsClamp && !isFetching && !isPlaceholderData) {
    setClampedTotal(null)
  }

  useEffect(() => {
    // Placeholder data belongs to another page, so only a fresh response may move the page.
    if (!needsClamp || total === undefined || pageSize === undefined) return
    setPage(clampPage(page, total, pageSize))
  }, [needsClamp, page, setPage, total, pageSize])

  const pagerTotal = clampedTotal ?? total ?? 0
  return {
    pagerPage: pageSize === undefined ? page : clampPage(page, pagerTotal, pageSize),
    pagerTotal,
    // The placeholder term covers a retry after a failed clamped fetch, which shows the empty past-the-end
    // response as placeholder. Fresh empty pages stay out of it so an in-range empty page shows its empty copy.
    outOfRange: isEmptyPlaceholder || needsClamp || clampedTotal !== null,
  }
}
