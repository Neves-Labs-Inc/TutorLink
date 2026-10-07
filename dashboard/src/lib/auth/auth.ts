import type { AuthStatus } from '@/stores/authStore'

export const ROLES = ['admin', 'manager', 'tutor', 'developer'] as const

export type Role = (typeof ROLES)[number]

export type AccessTokenClaims = {
  sub: string
  role: Role
  tutorId: string | null
  exp: number
}

// Every role that works the office side (Dashboard, Chats, Bookings...). Tutor is the only one out.
export const STAFF_ROLES: readonly Role[] = ['admin', 'manager', 'developer']

// The account-management subset: Users and Settings stay closed to a Manager.
export const ADMIN_ROLES: readonly Role[] = ['admin', 'developer']

const STAFF_ROLE_SET: ReadonlySet<Role> = new Set(STAFF_ROLES)

export const isStaffRole = (role: Role): boolean => STAFF_ROLE_SET.has(role)

const STAFF_LANDING_PATH = '/dashboard'
const TUTOR_LANDING_PATH = '/schedule'
const LOGIN_PATH = '/login'

export const landingPath = (role: Role): string =>
  isStaffRole(role) ? STAFF_LANDING_PATH : TUTOR_LANDING_PATH

export type Chrome = 'staff' | 'tutor'

// Asked as "is tutor", never "is not admin": a new Staff role must not inherit the tutor chrome.
export const chromeFor = (role: Role): Chrome => (role === 'tutor' ? 'tutor' : 'staff')

export type GuardDecision = { kind: 'wait' } | { kind: 'allow' } | { kind: 'redirect'; to: string }

// The access token dies on reload while the refresh cookie survives, so on the first paint of
// every page load the bootstrap refresh is still in flight and `role` is null without the visitor
// being anonymous. Redirecting then would sign every user out on every reload.
export const guardDecision = (
  status: AuthStatus,
  role: Role | null,
  allow: readonly Role[],
): GuardDecision => {
  if (status === 'loading') return { kind: 'wait' }
  if (role === null) return { kind: 'redirect', to: LOGIN_PATH }

  return allow.includes(role) ? { kind: 'allow' } : { kind: 'redirect', to: landingPath(role) }
}

const isRole = (value: unknown): value is Role => (ROLES as readonly unknown[]).includes(value)

// This decode is NOT verification. The signature is never checked in the browser and the
// claims below must never be trusted for an authorisation decision. The role is read only
// so the UI can pick which chrome to render; every real access decision belongs to the
// server, which re-verifies the token on every single request. A user who edits the payload
// in devtools changes what they see, never what they can reach.
export const decodeAccessToken = (token: string): AccessTokenClaims | null => {
  const segments = token.split('.')
  let claims: AccessTokenClaims | null = null

  if (segments.length === 3) {
    try {
      const base64 = segments[1].replace(/-/g, '+').replace(/_/g, '/')
      const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
      const payload: unknown = JSON.parse(atob(padded))

      if (typeof payload === 'object' && payload !== null) {
        const { sub, role, tutor_id: tutorId, exp } = payload as Record<string, unknown>
        const usable = typeof sub === 'string' && typeof exp === 'number' && isRole(role)

        if (usable) {
          claims = { sub, role, tutorId: typeof tutorId === 'string' ? tutorId : null, exp }
        }
      }
    } catch {
      claims = null
    }
  }

  return claims
}
