export type ThreadSnapshot = { firstId: string | null; lastId: string | null; length: number }

export type ThreadScrollInput = {
  previous: ThreadSnapshot
  next: ThreadSnapshot
  wasNearBottom: boolean // measured before the new content rendered
  lastIsOwnSend: boolean // next.lastId is the admin's newly added optimistic message
}

export type ThreadScrollDecision = 'jump' | 'follow' | 'preserve' | 'none'

// Rule order matters: a last-id change is an append even when the first id changes too (a sliding
// newest-page window, or an echo replacing the optimistic bubble), so it is checked before a prepend.
export const threadScrollDecision = ({
  previous,
  next,
  wasNearBottom,
  lastIsOwnSend,
}: ThreadScrollInput): ThreadScrollDecision => {
  let decision: ThreadScrollDecision = 'none'

  if (previous.length === 0 && next.length > 0) {
    decision = 'jump'
  } else if (next.lastId !== previous.lastId) {
    decision = lastIsOwnSend || wasNearBottom ? 'follow' : 'none'
  } else if (next.firstId !== previous.firstId && next.length > previous.length) {
    decision = 'preserve'
  }

  return decision
}
