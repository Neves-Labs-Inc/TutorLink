export type KeyPress = {
  key: string
  shiftKey: boolean
  isComposing: boolean
}

// Enter during IME composition only confirms the composition, so it must not send.
export const shouldSubmitOnKey = ({ key, shiftKey, isComposing }: KeyPress): boolean =>
  key === 'Enter' && !shiftKey && !isComposing
