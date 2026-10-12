export type KeyPress = {
  key: string
  shiftKey: boolean
  isComposing: boolean
  keyCode: number
}

// Safari fires the Enter that commits an IME composition after `isComposing` has already turned
// false, but still reports keyCode 229.
const IME_PROCESS_KEY_CODE = 229

// Enter during IME composition only confirms the composition, so it must not send.
export const shouldSubmitOnKey = ({ key, shiftKey, isComposing, keyCode }: KeyPress): boolean =>
  key === 'Enter' && !shiftKey && !isComposing && keyCode !== IME_PROCESS_KEY_CODE
