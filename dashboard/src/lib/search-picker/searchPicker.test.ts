import { describe, it, expect } from 'vitest'
import { nextHighlight, optionId } from './searchPicker'

describe('nextHighlight', () => {
  const cases: { current: number; key: 'ArrowDown' | 'ArrowUp'; count: number; expected: number }[] = [
    { current: -1, key: 'ArrowDown', count: 3, expected: 0 },
    { current: 2, key: 'ArrowDown', count: 3, expected: 0 },
    { current: 0, key: 'ArrowUp', count: 3, expected: 2 },
    { current: -1, key: 'ArrowUp', count: 3, expected: 2 },
    { current: 1, key: 'ArrowDown', count: 3, expected: 2 },
    { current: 1, key: 'ArrowUp', count: 3, expected: 0 },
    { current: -1, key: 'ArrowDown', count: 0, expected: -1 },
    { current: -1, key: 'ArrowUp', count: 0, expected: -1 },
    { current: 5, key: 'ArrowDown', count: 0, expected: -1 },
  ]

  it.each(cases)('from $current with $key over $count options gives $expected', ({ current, key, count, expected }) => {
    expect(nextHighlight(current, key, count)).toBe(expected)
  })
})

describe('optionId', () => {
  it('is stable for the same inputs', () => {
    expect(optionId('picker-1', 'abc')).toBe(optionId('picker-1', 'abc'))
  })

  it('is unique per option', () => {
    expect(optionId('picker-1', 'abc')).not.toBe(optionId('picker-1', 'def'))
  })

  it('is unique per picker', () => {
    expect(optionId('picker-1', 'abc')).not.toBe(optionId('picker-2', 'abc'))
  })
})
