export type FocusOutcome = 'saved' | 'save-failed' | 'discarded'
export type FocusTargetKind = 'saved-message' | 'save-button' | 'first-field'

// A disabled Save can't hold focus, so a failed save that left nothing to retry falls back to the first field.
export function focusTarget(outcome: FocusOutcome, isSaveEnabled: boolean): FocusTargetKind {
  if (outcome === 'saved') return 'saved-message'
  if (outcome === 'save-failed' && isSaveEnabled) return 'save-button'
  return 'first-field'
}
