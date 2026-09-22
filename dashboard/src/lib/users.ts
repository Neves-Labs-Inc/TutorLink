export type RoleOption = { value: string; label: string; disabled?: boolean }

export type NewTutorDraft = {
  name: string
  phoneNumber: string
  bio: string
}

export type UserDraft = {
  email: string
  password: string
  role: string
  tutorId: string | null
  tutorMode: 'link' | 'new'
  newTutor: NewTutorDraft
}

export type TutorCreatePayload = {
  name: string
  phone_number: string
  bio?: string
}

export type UserCreatePayload = {
  email: string
  password: string
  role: string
  tutor_id?: string
  tutor?: TutorCreatePayload
}

export type UserUpdatePayload = {
  email: string
  role: string
  is_active: boolean
  password?: string
}

const BASE_ROLE_OPTIONS: RoleOption[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'tutor', label: 'Tutor' },
]

const DEVELOPER_ROLE_OPTION: RoleOption = { value: 'developer', label: 'Developer' }

const ALL_ROLE_OPTIONS: RoleOption[] = [...BASE_ROLE_OPTIONS, DEVELOPER_ROLE_OPTION]

const MIN_PASSWORD_LENGTH = 8

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

export const requiresTutorLink = (role: string): boolean => role === 'tutor'

export const userFormErrors = (draft: UserDraft, mode: 'create' | 'edit'): string[] => {
  const errors: string[] = []

  if (draft.email.trim() === '') {
    errors.push('Email is required.')
  } else if (!draft.email.includes('@')) {
    errors.push('Email must be a valid address.')
  }

  if (mode === 'create' && draft.password.length < MIN_PASSWORD_LENGTH) {
    errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  }

  if (mode === 'create' && requiresTutorLink(draft.role)) {
    if (draft.tutorMode === 'link' && draft.tutorId === null) {
      errors.push('A tutor account requires a linked tutor.')
    } else if (draft.tutorMode === 'new') {
      if (draft.newTutor.name.trim() === '') {
        errors.push('New tutor name is required.')
      }

      if (draft.newTutor.phoneNumber.trim() === '') {
        errors.push('New tutor phone number is required.')
      }
    }
  }

  return errors
}

export const createUserPayload = (draft: UserDraft): UserCreatePayload => {
  const payload: UserCreatePayload = {
    email: draft.email.trim(),
    password: draft.password,
    role: draft.role,
  }

  if (requiresTutorLink(draft.role) && draft.tutorMode === 'link' && draft.tutorId !== null) {
    payload.tutor_id = draft.tutorId
  } else if (requiresTutorLink(draft.role) && draft.tutorMode === 'new') {
    const tutor: TutorCreatePayload = {
      name: draft.newTutor.name.trim(),
      phone_number: draft.newTutor.phoneNumber.trim(),
    }

    if (draft.newTutor.bio.trim() !== '') {
      tutor.bio = draft.newTutor.bio.trim()
    }

    payload.tutor = tutor
  }

  return payload
}

export const updateUserPayload = (
  draft: Omit<UserDraft, 'tutorId' | 'tutorMode' | 'newTutor'> & { isActive: boolean },
): UserUpdatePayload => {
  const payload: UserUpdatePayload = {
    email: draft.email.trim(),
    role: draft.role,
    is_active: draft.isActive,
  }

  if (draft.password.trim() !== '') {
    payload.password = draft.password
  }

  return payload
}
