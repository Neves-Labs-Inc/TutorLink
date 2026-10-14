import { describe, it, expect } from 'vitest'
import { isFromInteractiveDescendant } from './isFromInteractiveDescendant'

// Node test env has no DOM, so fake just the part of Element the helper uses.
const fakeElement = (closestResult: unknown): Element =>
  ({ closest: () => closestResult }) as unknown as Element

describe('isFromInteractiveDescendant', () => {
  const container = fakeElement(null)

  it('is true when the target sits inside an interactive element', () => {
    const button = fakeElement(null)
    const target = fakeElement(button)

    expect(isFromInteractiveDescendant(target, container)).toBe(true)
  })

  it('is false when the closest interactive element is the container itself', () => {
    const target = fakeElement(container)

    expect(isFromInteractiveDescendant(target, container)).toBe(false)
  })

  it('is false when nothing interactive is found', () => {
    const target = fakeElement(null)

    expect(isFromInteractiveDescendant(target, container)).toBe(false)
  })

  it('is false for a null target', () => {
    expect(isFromInteractiveDescendant(null, container)).toBe(false)
  })

  it('is false for a target that is not an element', () => {
    expect(isFromInteractiveDescendant({} as EventTarget, container)).toBe(
      false,
    )
  })

  it('asks for buttons, links, form controls, roles and tabindex', () => {
    let selector = ''
    const target = {
      closest: (s: string) => {
        selector = s
        return null
      },
    } as unknown as EventTarget
    isFromInteractiveDescendant(target, container)

    const parts = selector.split(',').map((s) => s.trim())
    for (const part of [
      'button',
      'a',
      'input',
      'select',
      'textarea',
      'label',
      '[role="button"]',
      '[role="link"]',
      '[tabindex]',
    ]) {
      expect(parts).toContain(part)
    }
  })
})
