import axios, {
  AxiosHeaders,
  type AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios'
import type { BookingWarning } from '@/lib/queries/bookings'
import { queryClient } from '@/lib/queryClient'
import { useAuthStore } from '@/stores/authStore'

// Same-origin only (D-012): the Vite dev proxy forwards /api and /auth to the API, so the
// base URL stays empty and `withCredentials` lets the HttpOnly refresh cookie ride along.
const clientConfig = {
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '',
  withCredentials: true,
}

type TokenPairResponse = {
  access_token: string
  token_type: string
  // The body also carries `refresh_token`. It is deliberately not typed and never read:
  // the browser's copy is the HttpOnly cookie the server set, and JavaScript must not hold
  // a second one.
}

type RetriableRequestConfig = InternalAxiosRequestConfig & {
  retriedAfterRefresh?: boolean
}

// Every /api/* call. Carries the bearer token and the silent-refresh retry.
export const api = axios.create({ ...clientConfig })

// /auth/* only, and deliberately interceptor-free: a refresh triggered by a 401 must not be
// able to 401 its way back into the same interceptor and loop forever.
export const authApi = axios.create({ ...clientConfig })

export const requestLogin = (email: string, password: string) =>
  // Form-encoded, and the field is `username`, not `email` (D-021). JSON here returns 400.
  authApi.post<TokenPairResponse>('/auth/token', new URLSearchParams({ username: email, password }))

export const requestForgotPassword = (email: string) =>
  authApi.post<{ detail: string }>('/auth/password/forgot', { email })

export const requestSetPassword = (token: string, password: string) =>
  authApi.post<TokenPairResponse>('/auth/password/set', { token, password })

export type PasswordLinkKind = 'invite' | 'reset'

export type PasswordLinkState = 'valid' | 'expired' | 'used' | 'invalid'

// `kind` is null only for `invalid`; `name` and `email` only come with a valid Invite.
export type PasswordLink = {
  kind: PasswordLinkKind | null
  state: PasswordLinkState
  name: string | null
  email: string | null
}

export type LinkLookupResult =
  | { isRateLimited: false; link: PasswordLink }
  | { isRateLimited: true; retryAfterSeconds: number }

const HTTP_TOO_MANY_REQUESTS = 429
const SECONDS_PER_MINUTE = 60
// Used when a 429 comes without a readable `Retry-After`.
const FALLBACK_RETRY_AFTER_SECONDS = 15 * SECONDS_PER_MINUTE

const parseRetryAfter = (header: unknown): number => {
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : FALLBACK_RETRY_AFTER_SECONDS
}

// Says what a link is before a password is typed. A 429 is an answer, not a failure: it
// resolves with the wait. Network errors and 5xx reject so the caller can offer a retry.
export const requestLinkLookup = async (token: string): Promise<LinkLookupResult> => {
  let result: LinkLookupResult

  try {
    const { data } = await authApi.post<PasswordLink>('/auth/password/link', { token })
    result = { isRateLimited: false, link: data }
  } catch (error) {
    const isRateLimited =
      axios.isAxiosError(error) && error.response?.status === HTTP_TOO_MANY_REQUESTS
    if (!isRateLimited) throw error

    result = {
      isRateLimited: true,
      retryAfterSeconds: parseRetryAfter(error.response?.headers['retry-after']),
    }
  }

  return result
}

// No body: the HttpOnly cookie carries the refresh token.
export const requestRefresh = () => authApi.post<TokenPairResponse>('/auth/refresh')

export const requestLogout = async (): Promise<void> => {
  try {
    await authApi.post('/auth/logout')
  } catch {
    // The server returns 204 unconditionally and never reveals whether the token was valid;
    // a request that fails anyway must still let the client tear its session down.
  }
}

// Returns the server's `{"detail": "..."}` string when there is one, so callers can render
// it without importing axios (REQ-009 keeps axios confined to this module).
export const errorDetail = (error: unknown): string | null => {
  let detail: string | null = null

  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { detail?: unknown } | undefined
    detail = typeof data?.detail === 'string' ? data.detail : null
  }

  return detail
}

// The `warnings[]` of a refusal the Office may confirm (`POST /api/bookings` 409), or null when
// the failure carried none and is a plain block.
export const warningsOf = (error: unknown): BookingWarning[] | null => {
  let warnings: BookingWarning[] | null = null

  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { warnings?: unknown } | undefined
    warnings = Array.isArray(data?.warnings) ? (data.warnings as BookingWarning[]) : null
  }

  return warnings
}

// The `booking_ids` of a Home refusal (archive, or taking a Guardian off it) that upcoming
// Bookings block, or null when the failure carried none.
export function bookingIdsOf(error: unknown): string[] | null {
  let bookingIds: string[] | null = null

  if (axios.isAxiosError(error)) {
    // The API's refusal body: `{detail, booking_ids}` (`routers/homes.py`, `archive.py`).
    const data = error.response?.data as { booking_ids?: unknown } | undefined
    bookingIds = Array.isArray(data?.booking_ids) ? (data.booking_ids as string[]) : null
  }

  return bookingIds
}

// What a 409 from the Booking writes means, so the screen can pick the right recovery: confirm
// the warnings, reload a stale row, pick another time, or just show the sentence.
export type Conflict =
  | { kind: 'warnings'; warnings: BookingWarning[] }
  | { kind: 'stale' }
  | { kind: 'overlap' }
  | { kind: 'refused'; detail: string }

const STALE_DETAIL = /changed since/i
const OVERLAP_DETAIL = /overlap/i

// Null when the failure is not a 409. The API words these in `detail` (`booking_writes.py`,
// `booking_status.py`); only the warnings 409 has a structured body.
export const conflictOf = (error: unknown): Conflict | null => {
  if (errorStatus(error) !== 409) return null

  const warnings = warningsOf(error)
  const detail = errorDetail(error) ?? ''
  let conflict: Conflict = { kind: 'refused', detail }

  if (warnings !== null) {
    conflict = { kind: 'warnings', warnings }
  } else if (STALE_DETAIL.test(detail)) {
    conflict = { kind: 'stale' }
  } else if (OVERLAP_DETAIL.test(detail)) {
    conflict = { kind: 'overlap' }
  }

  return conflict
}

// The HTTP status of a failed request, so callers can tell a refusal (403) from a conflict (409)
// without importing axios.
export const errorStatus = (error: unknown): number | null =>
  axios.isAxiosError(error) ? (error.response?.status ?? null) : null

// Request config for a call that must outlive the page (a deferred act flushed on `pagehide`):
// only fetch's `keepalive` survives unload, so it switches to axios's fetch adapter. The request
// interceptors run before any adapter, so the bearer token still rides along.
export function getKeepaliveConfig(keepalive: boolean): AxiosRequestConfig {
  if (!keepalive) return {}

  return { adapter: 'fetch', fetchOptions: { keepalive: true } }
}

// One response header of a failed request (e.g. a 429's `Retry-After`), so callers can read it
// without importing axios. Lookup is case-insensitive.
export const errorHeader = (error: unknown, name: string): string | null => {
  let value: string | null = null

  if (axios.isAxiosError(error) && error.response !== undefined) {
    const header = AxiosHeaders.from(error.response.headers as AxiosHeaders).get(name)
    value = typeof header === 'string' ? header : null
  }

  return value
}

// Single-flight, and module-level on purpose. Refresh tokens rotate on every use (D-017)
// and the server treats a replayed one as a breach: it revokes the entire family, which
// logs the user out instantly. Two API calls both 401-ing on the same expired access token
// is the ordinary case, so concurrent callers must share one in-flight POST /auth/refresh
// rather than each presenting the same cookie.
let refreshPromise: Promise<string> | null = null

export const refreshSession = (): Promise<string> => {
  if (refreshPromise === null) {
    refreshPromise = requestRefresh()
      .then((response) => {
        const accessToken = response.data.access_token
        useAuthStore.getState().setSession({ accessToken })

        return accessToken
      })
      .catch((error: unknown) => {
        useAuthStore.getState().clearSession()
        // As on Logout: the next sign-in on this tab must not see the expired user's cached rows.
        queryClient.clear()
        throw error
      })
      .finally(() => {
        refreshPromise = null
      })
  }

  return refreshPromise
}

api.interceptors.request.use((config) => {
  const { accessToken } = useAuthStore.getState()

  if (accessToken !== null) {
    config.headers.Authorization = `Bearer ${accessToken}`
  }

  return config
})

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetriableRequestConfig | undefined
    const retriable =
      error.response?.status === 401 && config !== undefined && !config.retriedAfterRefresh
    let result: Promise<unknown>

    if (retriable) {
      // Marked before the replay so a second 401 rejects instead of refreshing again.
      config.retriedAfterRefresh = true

      let refreshed = true
      try {
        await refreshSession()
      } catch {
        // The session is already cleared; surface the original 401 to the caller.
        refreshed = false
      }

      result = refreshed ? api(config) : Promise.reject(error)
    } else {
      result = Promise.reject(error)
    }

    return result
  },
)
