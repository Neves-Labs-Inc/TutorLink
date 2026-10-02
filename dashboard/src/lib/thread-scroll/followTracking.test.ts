import { describe, it, expect } from 'vitest'
import { isFollowingAfter } from './followTracking'

describe('isFollowingAfter', () => {
  it('starts following on a smooth follow with distance to travel', () => {
    const isFollowing = isFollowingAfter(false, { kind: 'decision', decision: 'follow', isSmooth: true, distance: 240 })

    expect(isFollowing).toBe(true)
  })

  it('does not start following when a follow has nothing to travel', () => {
    const isFollowing = isFollowingAfter(false, { kind: 'decision', decision: 'follow', isSmooth: true, distance: 0 })

    expect(isFollowing).toBe(false)
  })

  it('does not start following on an instant follow under reduced motion', () => {
    const isFollowing = isFollowingAfter(false, { kind: 'decision', decision: 'follow', isSmooth: false, distance: 240 })

    expect(isFollowing).toBe(false)
  })

  it('stops following on a jump', () => {
    const isFollowing = isFollowingAfter(true, { kind: 'decision', decision: 'jump', isSmooth: false, distance: 500 })

    expect(isFollowing).toBe(false)
  })

  it('stops following when older messages are prepended', () => {
    const isFollowing = isFollowingAfter(true, { kind: 'decision', decision: 'preserve', isSmooth: false, distance: 500 })

    expect(isFollowing).toBe(false)
  })

  it('keeps a follow in flight through a status update', () => {
    const isFollowing = isFollowingAfter(true, { kind: 'decision', decision: 'none', isSmooth: false, distance: 120 })

    expect(isFollowing).toBe(true)
  })

  it('keeps following while the smooth scroll moves toward the bottom', () => {
    const isFollowing = isFollowingAfter(true, { kind: 'scroll', previousDistance: 240, distance: 150 })

    expect(isFollowing).toBe(true)
  })

  it('stops following once the scroll settles at the bottom', () => {
    const isFollowing = isFollowingAfter(true, { kind: 'scroll', previousDistance: 20, distance: 0 })

    expect(isFollowing).toBe(false)
  })

  it('stops following when the admin scrolls away from the bottom by any means', () => {
    const isFollowing = isFollowingAfter(true, { kind: 'scroll', previousDistance: 150, distance: 210 })

    expect(isFollowing).toBe(false)
  })

  it('never starts following from a scroll', () => {
    const isFollowing = isFollowingAfter(false, { kind: 'scroll', previousDistance: 240, distance: 150 })

    expect(isFollowing).toBe(false)
  })
})
