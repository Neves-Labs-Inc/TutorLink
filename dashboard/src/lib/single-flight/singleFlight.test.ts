import { describe, expect, it } from 'vitest'

import { createSingleFlight } from '@/lib/single-flight/singleFlight'

describe('createSingleFlight', () => {
  it('allows the first start', () => {
    expect(createSingleFlight().tryStart()).toBe(true)
  })

  it('refuses a second start while the first is in flight', () => {
    const flight = createSingleFlight()
    flight.tryStart()
    expect(flight.tryStart()).toBe(false)
  })

  it('allows a start again after finish', () => {
    const flight = createSingleFlight()
    flight.tryStart()
    flight.finish()
    expect(flight.tryStart()).toBe(true)
  })

  it('keeps separate guards independent', () => {
    const invite = createSingleFlight()
    const reset = createSingleFlight()
    invite.tryStart()
    expect(reset.tryStart()).toBe(true)
  })
})
