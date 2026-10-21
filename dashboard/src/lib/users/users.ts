type RoleOption = { value: string; label: string }

const ROLE_OPTIONS: RoleOption[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'tutor', label: 'Tutor' },
  { value: 'developer', label: 'Developer' },
]

// The `users.name` column is varchar(255); the server counts code points after a trim.
const DISPLAY_NAME_MAX_LENGTH = 255

// Mirrors the server's blank and length checks so the form can say so before a round trip. The
// server's hidden-character refusal stays server-side and comes back as the save error.
export const displayNameError = (draft: string): string | null => {
  const trimmed = draft.trim()
  let error: string | null = null

  if (trimmed === '') {
    error = 'Display name is required.'
  } else if ([...trimmed].length > DISPLAY_NAME_MAX_LENGTH) {
    error = `Display name must be ${DISPLAY_NAME_MAX_LENGTH} characters or fewer.`
  }

  return error
}

export const roleLabel = (role: string): string =>
  ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role
