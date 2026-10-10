const INTERACTIVE_SELECTOR = [
  'button',
  'a',
  'input',
  'select',
  'textarea',
  'label',
  '[role="button"]',
  '[role="link"]',
  '[tabindex]',
].join(', ')

// The container itself matches [tabindex] when it is a focusable row, so it is
// excluded: only descendants count.
export const isFromInteractiveDescendant = (
  target: EventTarget | null,
  container: Element,
): boolean => {
  if (!target || !('closest' in target)) return false

  // Safe: 'closest' in target means it is an Element.
  const match = (target as Element).closest(INTERACTIVE_SELECTOR)
  return match !== null && match !== container
}
