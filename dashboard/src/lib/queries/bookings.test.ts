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
      bookingSearchParams({
        kind: 'evaluation',
        location: 'in_office',
        user_id: 'u1',
      }),
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

describe('bookingSearchParams (redesign filters)', () => {
  it('repeats child_id, user_id and kind', () => {
    const search = new URLSearchParams(
      bookingSearchParams({
        child_id: ['c1', 'c2'],
        user_id: ['u1', 'u2'],
        kind: ['regular', 'evaluation'],
      }),
    )

    expect(search.getAll('child_id')).toEqual(['c1', 'c2'])
    expect(search.getAll('user_id')).toEqual(['u1', 'u2'])
    expect(search.getAll('kind')).toEqual(['regular', 'evaluation'])
  })

  it('sends q and to_sort_out when given, and neither when not', () => {
    const given = new URLSearchParams(bookingSearchParams({ q: 'ana', to_sort_out: true }))
    const absent = new URLSearchParams(bookingSearchParams({}))

    expect(given.get('q')).toBe('ana')
    expect(given.get('to_sort_out')).toBe('true')
    expect(absent.has('q')).toBe(false)
    expect(absent.has('to_sort_out')).toBe(false)
  })

  it('sends to_sort_out=false rather than dropping it', () => {
    const search = new URLSearchParams(bookingSearchParams({ to_sort_out: false }))

    expect(search.get('to_sort_out')).toBe('false')
  })
})
