import { create } from 'zustand'

type Role = 'admin' | 'tutor' | null

interface AuthState {
  accessToken: string | null
  role: Role
  tutorId: string | null
  setSession: (session: { accessToken: string; role: Role; tutorId: string | null }) => void
  clearSession: () => void
}

// The access token lives in memory only — no browser web storage,
// no Zustand persist middleware. Not now, not ever.
export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  role: null,
  tutorId: null,
  setSession: ({ accessToken, role, tutorId }) => set({ accessToken, role, tutorId }),
  clearSession: () => set({ accessToken: null, role: null, tutorId: null }),
}))
