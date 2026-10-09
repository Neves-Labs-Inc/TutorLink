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

  it('appends kind, location and user_id when given', () => {
    const search = new URLSearchParams(
      bookingSearchParams({ kind: 'evaluation', location: 'in_office', user_id: 'u1' }),
    )

    expect(search.get('kind')).toBe('evaluation')
    expect(search.get('location')).toBe('in_office')
    expect(search.get('user_id')).toBe('u1')
  })

  it('omits kind, location and user_id when not given', () => {
    const search = new URLSearchParams(bookingSearchParams({}))

    expect(search.has('kind')).toBe(false)
    expect(search.has('location')).toBe(false)
    expect(search.has('user_id')).toBe(false)
  })

  it('serialises repeated statuses as repeated keys', () => {
    const search = bookingSearchParams({ status: ['pending', 'confirmed'] })

    expect(new URLSearchParams(search).getAll('status')).toEqual(['pending', 'confirmed'])
  })
})
