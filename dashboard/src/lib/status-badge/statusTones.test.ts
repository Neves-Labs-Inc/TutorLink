import { describe, expect, it } from 'vitest'
import { TONE_CLASSES } from './statusTones'

describe('StatusBadge reminder keys', () => {
  it.each([
    ['will_send', 'confirmed'],
    ['will_skip', 'pending'],
    ['sent', 'confirmed'],
    ['delivered', 'confirmed'],
    ['read', 'confirmed'],
    ['failed', 'cancelled'],
    ['undeliverable', 'cancelled'],
    ['skipped', 'pending'],
  ])('gives %s the %s tone, not the neutral fallback', (key, tone) => {
    expect(TONE_CLASSES[key]).toBe(`bg-status-${tone}-bg text-status-${tone}`)
  })
})

describe('StatusBadge access keys', () => {
  it('gives no_login the pending tone', () => {
    expect(TONE_CLASSES.no_login).toBe('bg-status-pending-bg text-status-pending')
  })

  it('gives invited the neutral completed tone', () => {
    expect(TONE_CLASSES.invited).toBe('bg-status-completed-bg text-status-completed')
  })
})
