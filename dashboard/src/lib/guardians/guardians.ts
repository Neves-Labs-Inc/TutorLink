import type { GuardianCreate } from '@/lib/queries/guardians'

export type HomeDraft = {
  label: string
  address: string
  accessCode: string
}

export type GuardianDraft = {
  name: string
  phoneNumber: string
  home: HomeDraft
}

// Display only. The canonical phone number is the server's, normalised by `phone_service` from a
// `system_settings` row with no client-side equivalent (CONSTITUTION §7); a value reformatted here
// must never be sent back in a request.
const NANP_PATTERN = /^\+1(\d{3})(\d{3})(\d{4})$/

export const formatPhoneForDisplay = (e164: string): string => {
  const parts = NANP_PATTERN.exec(e164)

  return parts === null ? e164 : `+1 (${parts[1]}) ${parts[2]}-${parts[3]}`
}

export const guardianFormErrors = (draft: GuardianDraft): string[] => {
  const errors: string[] = []

  if (draft.name.trim() === '') {
    errors.push('Name is required.')
  }

  if (draft.phoneNumber.trim() === '') {
    errors.push('Phone number is required.')
  }

  const address = draft.home.address.trim()
  const accessCode = draft.home.accessCode.trim()

  if ((address !== '' || accessCode !== '') && (address === '' || accessCode === '')) {
    errors.push('A home requires both an address and an access code.')
  }

  return errors
}

export const createGuardianPayload = (draft: GuardianDraft): GuardianCreate => {
  const payload: GuardianCreate = {
    name: draft.name.trim(),
    phone_number: draft.phoneNumber.trim(),
  }
  const address = draft.home.address.trim()
  const accessCode = draft.home.accessCode.trim()

  if (address !== '' && accessCode !== '') {
    const label = draft.home.label.trim()

    payload.home = { address, access_code: accessCode, label: label === '' ? null : label }
  }

  return payload
}
