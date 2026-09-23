import { create } from 'zustand'
import { decodeAccessToken, type Role } from '@/lib/auth/auth'

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

type AuthState = {
  status: AuthStatus
  accessToken: string | null
  role: Role | null
  tutorId: string | null
  setSession: (session: { accessToken: string }) => void
  clearSession: () => void
}

// `status` starts as 'loading' because the access token lives in memory and dies on reload
// while the refresh cookie survives: until the bootstrap refresh settles we do not yet know
// whether this visitor is signed in.
const ANONYMOUS = {
  status: 'anonymous',
  accessToken: null,
  role: null,
  tutorId: null,
} as const

// The access token lives in memory only — no browser web storage,
// no Zustand persist middleware. Not now, not ever.
export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  accessToken: null,
  role: null,
  tutorId: null,
  // The token is the single source of truth for the session: role and tutorId are decoded
  // from it rather than passed in, so the store cannot disagree with the bearer token that
  // the server will actually see. A token that will not decode is not a half-session — it
  // lands in exactly the same state as a logged-out user.
  setSession: ({ accessToken }) => {
    const claims = decodeAccessToken(accessToken)

    if (claims === null) {
      set(ANONYMOUS)
    } else {
      set({ status: 'authenticated', accessToken, role: claims.role, tutorId: claims.tutorId })
    }
  },
  clearSession: () => set(ANONYMOUS),
}))
