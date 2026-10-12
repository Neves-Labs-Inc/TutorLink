import { describe, expect, it } from 'vitest'

import { clampPage } from '@/lib/pagination/clampPage'

describe('clampPage', () => {
  it('moves to page 1 when the list is empty', () => {
    expect(clampPage(3, 0, 20)).toBe(1)
  })

  it('moves to the last full page when the total is an exact multiple of the page size', () => {
    expect(clampPage(3, 40, 20)).toBe(2)
  })

  it('keeps a page that is in range', () => {
    expect(clampPage(2, 41, 20)).toBe(2)
  })

  it('moves a page far past the end to the last page', () => {
    expect(clampPage(50, 41, 20)).toBe(3)
  })
})
