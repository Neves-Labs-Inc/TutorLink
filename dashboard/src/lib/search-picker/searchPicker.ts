export const nextHighlight = (
  current: number,
  key: 'ArrowDown' | 'ArrowUp',
  count: number,
): number => {
  let result: number

  if (count === 0) {
    result = -1
  } else if (key === 'ArrowDown') {
    result = current < 0 ? 0 : (current + 1) % count
  } else {
    result = current < 0 ? count - 1 : (current - 1 + count) % count
  }

  return result
}

export const optionId = (pickerId: string, optionId: string): string => `${pickerId}-option-${optionId}`
