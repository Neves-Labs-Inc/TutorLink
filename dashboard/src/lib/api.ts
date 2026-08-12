import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from '@/stores/authStore'

// Same-origin only (D-012): the Vite dev proxy forwards /api and /auth to the API, so the
// base URL stays empty and `withCredentials` lets the HttpOnly refresh cookie ride along.
const clientConfig = {
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '',
  withCredentials: true,
}

// Every /api/* call. Carries the bearer token and the silent-refresh retry.
export const api = axios.create({ ...clientConfig })

// /auth/* only, and deliberately interceptor-free: a refresh triggered by a 401 must not be
// able to 401 its way back into the same interceptor and loop forever.
export const authApi = axios.create({ ...clientConfig })

interface TokenPairResponse {
  access_token: string
  token_type: string
  // The body also carries `refresh_token`. It is deliberately not typed and never read:
  // the browser's copy is the HttpOnly cookie the server set, and JavaScript must not hold
  // a second one.
}

interface RetriableRequestConfig extends InternalAxiosRequestConfig {
  retriedAfterRefresh?: boolean
}

export function requestLogin(email: string, password: string) {
  // Form-encoded, and the field is `username`, not `email` (D-021). JSON here returns 400.
  return authApi.post<TokenPairResponse>(
    '/auth/token',
    new URLSearchParams({ username: email, password }),
  )
}

// No body: the HttpOnly cookie carries the refresh token.
export function requestRefresh() {
  return authApi.post<TokenPairResponse>('/auth/refresh')
}

export async function requestLogout(): Promise<void> {
  try {
    await authApi.post('/auth/logout')
  } catch {
    // The server returns 204 unconditionally and never reveals whether the token was valid;
    // a request that fails anyway must still let the client tear its session down.
  }
}

// Returns the server's `{"detail": "..."}` string when there is one, so callers can render
// it without importing axios (REQ-009 keeps axios confined to this module).
export function errorDetail(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null
  const data = error.response?.data as { detail?: unknown } | undefined
  return typeof data?.detail === 'string' ? data.detail : null
}

// Single-flight, and module-level on purpose. Refresh tokens rotate on every use (D-017)
// and the server treats a replayed one as a breach: it revokes the entire family, which
// logs the user out instantly. Two API calls both 401-ing on the same expired access token
// is the ordinary case, so concurrent callers must share one in-flight POST /auth/refresh
// rather than each presenting the same cookie.
let refreshPromise: Promise<string> | null = null

export function refreshSession(): Promise<string> {
  if (refreshPromise !== null) return refreshPromise

  refreshPromise = requestRefresh()
    .then((response) => {
      const accessToken = response.data.access_token
      useAuthStore.getState().setSession({ accessToken })
      return accessToken
    })
    .catch((error: unknown) => {
      useAuthStore.getState().clearSession()
      throw error
    })
    .finally(() => {
      refreshPromise = null
    })

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

    if (error.response?.status !== 401 || config === undefined || config.retriedAfterRefresh) {
      return Promise.reject(error)
    }

    // Marked before the replay so a second 401 rejects instead of refreshing again.
    config.retriedAfterRefresh = true

    try {
      await refreshSession()
    } catch {
      // The session is already cleared; surface the original 401 to the caller.
      return Promise.reject(error)
    }

    return api(config)
  },
)
