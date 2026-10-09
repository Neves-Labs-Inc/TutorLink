import { formatLocalDateTime } from '@/lib/dates/dates'

export type RoleOption = { value: string; label: string; disabled?: boolean }

export type ProfileDraft = {
  phoneNumber: string
  bio: string
}

export type UserDraft = {
  displayName: string
  email: string
  role: string
  profile: ProfileDraft
}

export type ProfileCreatePayload = {
  phone_number: string
  bio?: string
}

export type UserCreatePayload = {
  email: string
  name: string
  role: string
  tutor?: ProfileCreatePayload
}

export type UserUpdatePayload = {
  email: string
  name: string
  role: string
  is_active: boolean
}

const BASE_ROLE_OPTIONS: RoleOption[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'tutor', label: 'Tutor' },
]

const DEVELOPER_ROLE_OPTION: RoleOption = { value: 'developer', label: 'Developer' }

const ALL_ROLE_OPTIONS: RoleOption[] = [...BASE_ROLE_OPTIONS, DEVELOPER_ROLE_OPTION]

export const PHONE_REQUIRED_ERROR = 'Phone number is required.'

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
  ALL_ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role

// Presentation only, never enforcement: the server refuses the write regardless of what this
// returns (`api/app/services/user_service.py:87-88,123-126,158-159`, 403 "Only a developer may
// create or modify a developer account"). An admin crafting the request by hand is still
// stopped there. Omitting the option here is a courtesy, not a security control (CONSTITUTION #5).
export const roleOptions = (viewerRole: string): RoleOption[] =>
  viewerRole === 'developer' ? ALL_ROLE_OPTIONS : BASE_ROLE_OPTIONS

// A developer row opened by a non-developer viewer would otherwise select a value with no
// matching option, and an HTML <select> silently falls back to displaying its first option
// (`Admin`) while state keeps the real role — a form that lies about the row it is editing.
// Adding the row's actual role back in, disabled, keeps the display truthful without letting
// the viewer select their way into it.
export const editRoleOptions = (viewerRole: string, currentRole: string): RoleOption[] => {
  const options = roleOptions(viewerRole)
  const knownOption = ALL_ROLE_OPTIONS.find((option) => option.value === currentRole)

  return options.some((option) => option.value === currentRole) || knownOption === undefined
    ? options
    : [...options, { ...knownOption, disabled: true }]
}

// Mirrors the API's PROFILE_ROLES: these roles are created together with their tutor profile.
export const requiresProfile = (role: string): boolean => role === 'tutor' || role === 'manager'

export const userFormErrors = (draft: UserDraft, mode: 'create' | 'edit'): string[] => {
  const errors: string[] = []
  const nameError = displayNameError(draft.displayName)

  if (nameError !== null) {
    errors.push(nameError)
  }

  if (draft.email.trim() === '') {
    errors.push('Email is required.')
  } else if (!draft.email.includes('@')) {
    errors.push('Email must be a valid address.')
  }

  if (mode === 'create' && requiresProfile(draft.role) && draft.profile.phoneNumber.trim() === '') {
    errors.push(PHONE_REQUIRED_ERROR)
  }

  return errors
}

export const createUserPayload = (draft: UserDraft): UserCreatePayload => {
  const payload: UserCreatePayload = {
    email: draft.email.trim(),
    name: draft.displayName.trim(),
    role: draft.role,
  }

  if (requiresProfile(draft.role)) {
    const tutor: ProfileCreatePayload = { phone_number: draft.profile.phoneNumber.trim() }

    if (draft.profile.bio.trim() !== '') {
      tutor.bio = draft.profile.bio.trim()
    }

    payload.tutor = tutor
  }

  return payload
}

export const updateUserPayload = (draft: UserDraft & { isActive: boolean }): UserUpdatePayload => ({
  email: draft.email.trim(),
  name: draft.displayName.trim(),
  role: draft.role,
  is_active: draft.isActive,
})

export type AccessBadge = 'no_login' | 'invited'

export const accessBadge = (user: {
  has_password: boolean
  invite_expires_at: string | null
}): AccessBadge | null => {
  let badge: AccessBadge | null = null

  if (user.invite_expires_at !== null) {
    badge = 'invited'
  } else if (!user.has_password) {
    badge = 'no_login'
  }

  return badge
}

export const inviteExpiryTooltip = (user: { invite_expires_at: string | null }): string =>
  user.invite_expires_at === null ? '' : `Link expires ${formatLocalDateTime(user.invite_expires_at)}`
