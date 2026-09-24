import { describe, it, expect } from 'vitest'
import { bookingSearchParams } from './bookings'

describe('bookingSearchParams', () => {
  it('appends child_id when given', () => {
    const search = bookingSearchParams({ child_id: 'c1' })

    expect(search).toContain('child_id=c1')
  })

  it('omits child_id when not given', () => {
    const search = bookingSearchParams({})

    expect(new URLSearchParams(search).has('child_id')).toBe(false)
  })

  it('serialises repeated statuses as repeated keys', () => {
    const search = bookingSearchParams({ status: ['pending', 'confirmed'] })

    expect(new URLSearchParams(search).getAll('status')).toEqual(['pending', 'confirmed'])
  })
})
