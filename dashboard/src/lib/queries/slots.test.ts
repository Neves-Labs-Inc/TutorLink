import { describe, it, expect } from 'vitest'
import { slotSearchParams } from './slots'

describe('slotSearchParams', () => {
  it('sends the subject and date alone when nothing else is set', () => {
    const search = new URLSearchParams(slotSearchParams({ subject_id: 's1', date: '2026-10-21' }))

    expect([...search.keys()].sort()).toEqual(['date', 'subject_id'])
  })

  it('sends child_id, tutor_id and exclude_booking_id only when set', () => {
    const search = new URLSearchParams(
      slotSearchParams({
        subject_id: 's1',
        date: '2026-10-21',
        child_id: 'c1',
        tutor_id: 't1',
        exclude_booking_id: 'b1',
      }),
    )

    expect(search.get('child_id')).toBe('c1')
    expect(search.get('tutor_id')).toBe('t1')
    expect(search.get('exclude_booking_id')).toBe('b1')
  })
})
