import type { ThreadScrollDecision } from './threadScrollDecision'

// Sub-pixel scroll positions mean "at the bottom" and "did not move" need a little slack.
const SETTLE_TOLERANCE_PX = 1

export type FollowEvent =
  // A scroll event on the thread; distances are scrollHeight - scrollTop - clientHeight.
  | { kind: 'scroll'; previousDistance: number; distance: number }
  // A decision applied after a message change; distance is measured before scrolling.
  | { kind: 'decision'; decision: ThreadScrollDecision; isSmooth: boolean; distance: number }

// Whether a smooth follow is still in flight, so a message landing mid-animation counts as at the
// bottom. A follow only ever moves toward the bottom, so any move away means the admin took over,
// whatever the input (wheel, touch, keys, scrollbar drag, autoscroll).
export const isFollowingAfter = (wasFollowing: boolean, event: FollowEvent): boolean => {
  let isFollowing = wasFollowing

  if (event.kind === 'scroll') {
    const hasSettled = event.distance <= SETTLE_TOLERANCE_PX
    const hasMovedAway = event.distance > event.previousDistance + SETTLE_TOLERANCE_PX
    if (hasSettled || hasMovedAway) isFollowing = false
  } else if (event.decision === 'follow') {
    // With nothing to travel no scroll event fires, so the flag would never clear.
    isFollowing = event.isSmooth && event.distance > SETTLE_TOLERANCE_PX
  } else if (event.decision === 'jump' || event.decision === 'preserve') {
    isFollowing = false
  }

  return isFollowing
}
