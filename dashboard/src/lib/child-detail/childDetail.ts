import axios from 'axios'

import type { BookingListParams } from '@/lib/queries/bookings'
import type { ChildDetail } from '@/lib/queries/children'
import { defaultWindow, type SessionTab, type SessionWindow } from '@/lib/tutor-sessions/tutorSessions'

export type ChildSessionState = { tab: SessionTab; from: string; to: string }

export const EMPTY_CHILD_SESSION_STATE: ChildSessionState = { tab: 'upcoming', from: '', to: '' }

const NO_ACTIVE_HOME_REASON = 'Add a home first.'

// `child_id` and the tab's window (SA-30's scoped exception: Upcoming stays "from today", not
// "starts after now" — `defaultWindow` already encodes that). Never `status` (P6-2 precedent):
// a cancelled session must stay visible on whichever tab it falls into.
export const childSessionParams = (
  childId: string,
  state: ChildSessionState,
  page: number,
  todayIso: string,
): BookingListParams => {
  const window = childSessionWindow(state, todayIso)
  const params: BookingListParams = { child_id: childId, page }

  if (window.from !== undefined) {
    params.from = window.from
  }
  if (window.to !== undefined) {
    params.to = window.to
  }

  return params
}

// Disabled only for "no active home" (OQ-68) — inactivity alone never disables Book a session.
export const bookingBlockedReason = (child: ChildDetail): string | null =>
  child.homes.some((home) => home.is_active) ? null : NO_ACTIVE_HOME_REASON

// "Reactivate and book" for an inactive child; the form does the reactivation at submit (P7C-P).
export const bookButtonLabel = (child: ChildDetail): string =>
  child.is_active ? 'Book a session' : 'Reactivate and book'

export const isNotFoundError = (error: unknown): boolean =>
  axios.isAxiosError(error) && error.response?.status === 404

// An untouched pair takes the tab's default window; once either end is set, the state is
// authoritative (A-68 — the window is editable, not a floor). Mirrors `tutorSessions.ts`'s
// `sessionWindow`, kept private the same way.
const childSessionWindow = (state: ChildSessionState, todayIso: string): SessionWindow => {
  let window = defaultWindow(state.tab, todayIso)

  if (state.from !== '' || state.to !== '') {
    window = {}

    if (state.from !== '') {
      window.from = state.from
    }
    if (state.to !== '') {
      window.to = state.to
    }
  }

  return window
}
