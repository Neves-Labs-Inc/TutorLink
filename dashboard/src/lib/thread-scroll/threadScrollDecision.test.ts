import { describe, it, expect } from 'vitest'
import { threadScrollDecision, type ThreadSnapshot } from './threadScrollDecision'

const snapshot = (firstId: string | null, lastId: string | null, length: number): ThreadSnapshot => ({
  firstId,
  lastId,
  length,
})

const EMPTY = snapshot(null, null, 0)

describe('threadScrollDecision', () => {
  it('jumps when the first messages arrive in an empty thread', () => {
    const decision = threadScrollDecision({
      previous: EMPTY,
      next: snapshot('a', 'c', 3),
      wasNearBottom: true,
      lastIsOwnSend: false,
    })

    expect(decision).toBe('jump')
  })

  it('follows the admin own send even when scrolled up', () => {
    const decision = threadScrollDecision({
      previous: snapshot('a', 'c', 3),
      next: snapshot('a', 'client-1', 4),
      wasNearBottom: false,
      lastIsOwnSend: true,
    })

    expect(decision).toBe('follow')
  })

  it('follows an incoming message when the admin was near the bottom', () => {
    const decision = threadScrollDecision({
      previous: snapshot('a', 'c', 3),
      next: snapshot('a', 'd', 4),
      wasNearBottom: true,
      lastIsOwnSend: false,
    })

    expect(decision).toBe('follow')
  })

  it('does not move for an incoming message when scrolled up', () => {
    const decision = threadScrollDecision({
      previous: snapshot('a', 'c', 3),
      next: snapshot('a', 'd', 4),
      wasNearBottom: false,
      lastIsOwnSend: false,
    })

    expect(decision).toBe('none')
  })

  it('treats a sliding window refetch as an append and follows when near the bottom', () => {
    const decision = threadScrollDecision({
      previous: snapshot('a', 'c', 3),
      next: snapshot('b', 'd', 3),
      wasNearBottom: true,
      lastIsOwnSend: false,
    })

    expect(decision).toBe('follow')
  })

  it('does not move on a sliding window refetch when scrolled up', () => {
    const decision = threadScrollDecision({
      previous: snapshot('a', 'c', 3),
      next: snapshot('b', 'd', 3),
      wasNearBottom: false,
      lastIsOwnSend: false,
    })

    expect(decision).toBe('none')
  })

  it('preserves the viewport when an older page is prepended', () => {
    const decision = threadScrollDecision({
      previous: snapshot('c', 'e', 3),
      next: snapshot('a', 'e', 5),
      wasNearBottom: false,
      lastIsOwnSend: false,
    })

    expect(decision).toBe('preserve')
  })

  it('does nothing when ids are unchanged and only content changed', () => {
    const decision = threadScrollDecision({
      previous: snapshot('a', 'c', 3),
      next: snapshot('a', 'c', 3),
      wasNearBottom: true,
      lastIsOwnSend: false,
    })

    expect(decision).toBe('none')
  })

  it('does not move when the echo replaces the own optimistic message while scrolled up', () => {
    const decision = threadScrollDecision({
      previous: snapshot('a', 'client-1', 4),
      next: snapshot('a', 'server-1', 4),
      wasNearBottom: false,
      lastIsOwnSend: false,
    })

    expect(decision).toBe('none')
  })
})
