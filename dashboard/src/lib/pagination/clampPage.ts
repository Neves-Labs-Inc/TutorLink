// The last page that has rows; an empty list still has page 1.
export function clampPage(page: number, total: number, pageSize: number): number {
  return Math.min(page, Math.max(1, Math.ceil(total / pageSize)))
}
