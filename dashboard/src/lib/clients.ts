import type { ClientListParams } from '@/lib/queries/clients'

export type ClientFilterState = {
  q: string
  isActive: boolean
  page: number
  pageSize: number
}

// Display only. The canonical phone number is the server's, normalised by `phone_service` from a
// `system_settings` row with no client-side equivalent (CONSTITUTION §7); a value reformatted here
// must never be sent back in a request.
const NANP_PATTERN = /^\+1(\d{3})(\d{3})(\d{4})$/

export const clientListParams = (state: ClientFilterState): ClientListParams => {
  const params: ClientListParams = {
    is_active: state.isActive,
    page: state.page,
    page_size: state.pageSize,
  }
  const term = state.q.trim()

  if (term !== '') {
    params.q = term
  }

  return params
}

export const formatPhoneForDisplay = (e164: string): string => {
  const parts = NANP_PATTERN.exec(e164)

  return parts === null ? e164 : `+1 (${parts[1]}) ${parts[2]}-${parts[3]}`
}
