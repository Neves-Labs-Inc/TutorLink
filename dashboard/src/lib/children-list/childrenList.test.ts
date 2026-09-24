import { describe, it, expect } from 'vitest'
import {
  childListParams,
  deactivateMessage,
  guardianNames,
  homeNames,
  nextSessionLabel,
} from './childrenList'
import type { ChildSummary } from '@/lib/queries/children'

const BASE_ROW: ChildSummary = {
  id: 'child-1',
  name: 'Tommy Doe',
  grade_level: 7,
  school_name: 'Lincoln Middle School',
  is_active: true,
  guardians: [],
  homes: [],
  next_session: null,
}

describe('childListParams', () => {
  it('sends is_active: false when showInactive is true', () => {
    expect(childListParams({ q: '', showInactive: true, page: 1, pageSize: 20 })).toEqual({
      is_active: false,
      page: 1,
      page_size: 20,
    })
  })

  it('sends is_active: true when showInactive is false', () => {
    expect(childListParams({ q: '', showInactive: false, page: 1, pageSize: 20 })).toEqual({
      is_active: true,
      page: 1,
      page_size: 20,
    })
  })

  it('omits q when blank or whitespace', () => {
    expect(childListParams({ q: '   ', showInactive: false, page: 1, pageSize: 20 })).toEqual({
      is_active: true,
      page: 1,
      page_size: 20,
    })
  })

  it('trims and includes q when present', () => {
    expect(childListParams({ q: '  tommy  ', showInactive: false, page: 2, pageSize: 10 })).toEqual({
      is_active: true,
      q: 'tommy',
      page: 2,
      page_size: 10,
    })
  })
})

describe('guardianNames', () => {
  it('joins every guardian name with a comma', () => {
    const row: ChildSummary = {
      ...BASE_ROW,
      guardians: [
        { id: 'g1', name: 'Jane Doe' },
        { id: 'g2', name: 'John Doe' },
      ],
    }

    expect(guardianNames(row)).toBe('Jane Doe, John Doe')
  })

  it('falls back to an em dash when there are none', () => {
    expect(guardianNames(BASE_ROW)).toBe('—')
  })
})

describe('homeNames', () => {
  it('uses the label when there is one', () => {
    const row: ChildSummary = {
      ...BASE_ROW,
      homes: [{ id: 'h1', label: "Mum's", address: '123 Main St', is_active: true }],
    }

    expect(homeNames(row)).toBe("Mum's")
  })

  it('falls back to the address when there is no label', () => {
    const row: ChildSummary = {
      ...BASE_ROW,
      homes: [{ id: 'h1', label: null, address: '123 Main St', is_active: true }],
    }

    expect(homeNames(row)).toBe('123 Main St')
  })

  it('joins several homes with a comma', () => {
    const row: ChildSummary = {
      ...BASE_ROW,
      homes: [
        { id: 'h1', label: "Mum's", address: '123 Main St', is_active: true },
        { id: 'h2', label: null, address: '456 Oak Ave', is_active: true },
      ],
    }

    expect(homeNames(row)).toBe("Mum's, 456 Oak Ave")
  })

  it('falls back to an em dash when there are none', () => {
    expect(homeNames(BASE_ROW)).toBe('—')
  })
})

describe('nextSessionLabel', () => {
  it('formats the date, time, subject and tutor', () => {
    const row: ChildSummary = {
      ...BASE_ROW,
      next_session: {
        id: 'b1',
        scheduled_date: '2026-10-05',
        start_time: '09:00:00',
        end_time: '10:00:00',
        tutor: { id: 't1', name: 'Sarah Miller' },
        subject: { id: 's1', name: 'Math' },
      },
    }

    expect(nextSessionLabel(row)).toBe('5 Oct 2026 · 9:00 AM · Math with Sarah Miller')
  })

  it('falls back to "None scheduled" when there is none', () => {
    expect(nextSessionLabel(BASE_ROW)).toBe('None scheduled')
  })
})

describe('deactivateMessage', () => {
  it('names the child alone when there is nothing to cancel', () => {
    expect(deactivateMessage('Tommy Doe', 0)).toBe('Deactivate Tommy Doe?')
  })

  it('uses the singular for one session', () => {
    expect(deactivateMessage('Tommy Doe', 1)).toBe(
      'Deactivate Tommy Doe? This will cancel 1 upcoming session. Nobody will be notified.',
    )
  })

  it('uses the plural for more than one session', () => {
    expect(deactivateMessage('Tommy Doe', 3)).toBe(
      'Deactivate Tommy Doe? This will cancel 3 upcoming sessions. Nobody will be notified.',
    )
  })
})
