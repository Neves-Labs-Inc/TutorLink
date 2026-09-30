import type { HouseholdListParams } from '@/lib/queries/households'

export const householdListParams = (
  q: string,
  page: number,
  pageSize: number,
): HouseholdListParams => {
  const params: HouseholdListParams = { page, page_size: pageSize }
  const term = q.trim()

  if (term !== '') {
    params.q = term
  }

  return params
}

export const householdCountLabel = (total: number): string =>
  total === 1 ? '1 household' : `${total} households`
