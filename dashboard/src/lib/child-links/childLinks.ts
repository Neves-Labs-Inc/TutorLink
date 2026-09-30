import { findGuardianByPhone, type Guardian, type GuardianDetail, type Home } from '@/lib/queries/guardians'
import type { ChildDetail, GuardianLinkCreate } from '@/lib/queries/children'

export type PhoneCheck =
  | { kind: 'free' }
  | { kind: 'active'; guardian: Guardian }
  | { kind: 'inactive'; guardian: Guardian }

export const phoneCheckOutcome = (active: Guardian | null, inactive: Guardian | null): PhoneCheck => {
  if (active !== null) {
    return { kind: 'active', guardian: active }
  }

  return inactive !== null ? { kind: 'inactive', guardian: inactive } : { kind: 'free' }
}

// Active lookup first; the inactive one only runs when the active one misses (07B F's contract).
export const checkPhone = async (phoneNumber: string): Promise<PhoneCheck> => {
  const active = await findGuardianByPhone(phoneNumber, true)
  const inactive = active === null ? await findGuardianByPhone(phoneNumber, false) : null

  return phoneCheckOutcome(active, inactive)
}

export const linkPayload = (
  check: PhoneCheck,
  draft: { phoneNumber: string; name: string; homeIds: string[] },
): GuardianLinkCreate =>
  check.kind === 'free'
    ? {
        guardian: { name: draft.name.trim(), phone_number: draft.phoneNumber.trim() },
        home_ids: draft.homeIds,
      }
    : { guardian_id: check.guardian.id, home_ids: draft.homeIds }

export const alreadyLinked = (check: PhoneCheck, child: ChildDetail): boolean =>
  check.kind !== 'free' && child.guardians.some((guardian) => guardian.id === check.guardian.id)

export const withoutId = (items: { id: string }[], id: string): string[] =>
  items.filter((item) => item.id !== id).map((item) => item.id)

// The active homes of the child's guardians, minus the ones already on the child, deduplicated
// across guardians who share a home.
export const candidateHomes = (child: ChildDetail, guardians: GuardianDetail[]): Home[] => {
  const existingHomeIds = new Set(child.homes.map((home) => home.id))
  const seen = new Set<string>()
  const result: Home[] = []

  for (const guardian of guardians) {
    for (const home of guardian.homes) {
      if (!home.is_active || existingHomeIds.has(home.id) || seen.has(home.id)) {
        continue
      }

      seen.add(home.id)
      result.push(home)
    }
  }

  return result
}
