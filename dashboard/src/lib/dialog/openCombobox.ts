type AttributeReader = Pick<Element, 'getAttribute'>

// A dialog's Escape handler checks this so the first Escape closes only an open combobox list.
export function isOpenCombobox(element: AttributeReader | null): boolean {
  if (element === null) return false

  return element.getAttribute('role') === 'combobox' && element.getAttribute('aria-expanded') === 'true'
}
