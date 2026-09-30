import type { Home } from '@/lib/queries/guardians'
import type { GuardianHomeCreate, HomeUpdate } from '@/lib/queries/homes'

export type HomeDraft = {
  label: string
  address: string
  accessCode: string
}

export const EMPTY_HOME_DRAFT: HomeDraft = { label: '', address: '', accessCode: '' }

const MAX_LABEL_LENGTH = 64
const MAX_ACCESS_CODE_LENGTH = 64

export const homeDraftErrors = (draft: HomeDraft): string[] => {
  const errors: string[] = []

  if (draft.address.trim() === '') {
    errors.push('Address is required.')
  }

  if (draft.accessCode.trim() === '') {
    errors.push('Access code is required.')
  }

  if (draft.label.trim().length > MAX_LABEL_LENGTH) {
    errors.push(`Label must be ${MAX_LABEL_LENGTH} characters or fewer.`)
  }

  if (draft.accessCode.trim().length > MAX_ACCESS_CODE_LENGTH) {
    errors.push(`Access code must be ${MAX_ACCESS_CODE_LENGTH} characters or fewer.`)
  }

  return errors
}

export const homeInput = (draft: HomeDraft): Omit<GuardianHomeCreate, 'child_ids'> => {
  const label = draft.label.trim()

  return {
    label: label === '' ? null : label,
    address: draft.address.trim(),
    access_code: draft.accessCode.trim(),
  }
}

export const homeDraftFrom = (home: Home): HomeDraft => ({
  label: home.label ?? '',
  address: home.address,
  accessCode: home.access_code,
})

export const homeUpdate = (draft: HomeDraft, original: Home): HomeUpdate => {
  const update: HomeUpdate = {}
  const label = draft.label.trim()
  const address = draft.address.trim()
  const accessCode = draft.accessCode.trim()

  if (label !== (original.label ?? '')) {
    update.label = label
  }

  if (address !== original.address) {
    update.address = address
  }

  if (accessCode !== original.access_code) {
    update.access_code = accessCode
  }

  return update
}

export const homeName = (home: Home): string => home.label ?? home.address
