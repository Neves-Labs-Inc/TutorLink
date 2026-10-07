import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Guardian, GuardianDetail } from '@/lib/queries/guardians'
import type { ChildDetail } from '@/lib/queries/children'

const findGuardianByPhone = vi.fn()

vi.mock('@/lib/queries/guardians', () => ({
  findGuardianByPhone: (...args: unknown[]) => findGuardianByPhone(...args),
}))

const { checkPhone, phoneCheckOutcome, linkPayload, alreadyLinked, withoutId, candidateHomes } = await import(
  './childLinks'
)

const activeGuardian: Guardian = {
  id: 'g1',
  name: 'Jane Doe',
  phone_number: '+12025550123',
  is_active: true,
  home_count: 0,
  child_count: 0,
}
const inactiveGuardian: Guardian = { ...activeGuardian, id: 'g2', is_active: false }

const baseChild: ChildDetail = {
  id: 'c1',
  name: 'Tommy',
  date_of_birth: null,
  grade_level: 7,
  school_name: 'Lincoln Middle School',
  notes: null,
  is_active: true,
  upcoming_session_count: 0,
  guardians: [],
  homes: [],
  levels: [],
  evaluated: null,
}

describe('phoneCheckOutcome', () => {
  it('prefers active over inactive when both are given', () => {
    expect(phoneCheckOutcome(activeGuardian, inactiveGuardian)).toEqual({
      kind: 'active',
      guardian: activeGuardian,
    })
  })

  it('returns inactive when only the inactive lookup matches', () => {
    expect(phoneCheckOutcome(null, inactiveGuardian)).toEqual({
      kind: 'inactive',
      guardian: inactiveGuardian,
    })
  })

  it('returns free when neither matches', () => {
    expect(phoneCheckOutcome(null, null)).toEqual({ kind: 'free' })
  })
})

describe('checkPhone', () => {
  beforeEach(() => {
    findGuardianByPhone.mockReset()
  })

  it('makes one request when the active lookup matches', async () => {
    findGuardianByPhone.mockResolvedValueOnce(activeGuardian)

    const result = await checkPhone('+12025550123')

    expect(result).toEqual({ kind: 'active', guardian: activeGuardian })
    expect(findGuardianByPhone).toHaveBeenCalledTimes(1)
  })

  it('makes two requests when the active lookup misses and the inactive one matches', async () => {
    findGuardianByPhone.mockResolvedValueOnce(null).mockResolvedValueOnce(inactiveGuardian)

    const result = await checkPhone('+12025550123')

    expect(result).toEqual({ kind: 'inactive', guardian: inactiveGuardian })
    expect(findGuardianByPhone).toHaveBeenCalledTimes(2)
  })

  it('makes two requests and returns free when both miss', async () => {
    findGuardianByPhone.mockResolvedValue(null)

    const result = await checkPhone('+12025550123')

    expect(result).toEqual({ kind: 'free' })
    expect(findGuardianByPhone).toHaveBeenCalledTimes(2)
  })
})

describe('linkPayload', () => {
  it('builds the guardian_id shape for a found guardian', () => {
    expect(
      linkPayload({ kind: 'active', guardian: activeGuardian }, { phoneNumber: '', name: '', homeIds: ['h1'] }),
    ).toEqual({ guardian_id: 'g1', home_ids: ['h1'] })
  })

  it('builds the nested guardian shape for a free number, never both keys', () => {
    const payload = linkPayload(
      { kind: 'free' },
      { phoneNumber: '+12025550199', name: 'John Doe', homeIds: [] },
    )

    expect(payload).toEqual({
      guardian: { name: 'John Doe', phone_number: '+12025550199' },
      home_ids: [],
    })
    expect(payload).not.toHaveProperty('guardian_id')
  })

  it('trims the new guardian name and phone number', () => {
    const payload = linkPayload(
      { kind: 'free' },
      { phoneNumber: '  +12025550199  ', name: '  John Doe  ', homeIds: [] },
    )

    expect(payload).toEqual({
      guardian: { name: 'John Doe', phone_number: '+12025550199' },
      home_ids: [],
    })
  })
})

describe('alreadyLinked', () => {
  const child: ChildDetail = {
    ...baseChild,
    guardians: [{ id: 'g1', name: 'Jane Doe', phone_number: '+12025550123', is_active: true }],
  }

  it('is true when the found guardian is already one of the child\'s guardians', () => {
    expect(alreadyLinked({ kind: 'active', guardian: activeGuardian }, child)).toBe(true)
  })

  it('is false for a free number', () => {
    expect(alreadyLinked({ kind: 'free' }, child)).toBe(false)
  })

  it('is false when the found guardian is not linked to this child', () => {
    expect(alreadyLinked({ kind: 'inactive', guardian: inactiveGuardian }, child)).toBe(false)
  })
})

describe('withoutId', () => {
  it('drops the given id and returns the rest as a plain id list', () => {
    expect(withoutId([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'b')).toEqual(['a', 'c'])
  })
})

describe('candidateHomes', () => {
  const linkedHome = { id: 'h1', label: null, address: '1 Elm St', access_code: '1111', is_active: true }
  const dadsHome = { id: 'h2', label: "Dad's", address: '2 Oak St', access_code: '2222', is_active: true }
  const inactiveHome = { id: 'h3', label: null, address: '3 Pine St', access_code: '3333', is_active: false }
  const child: ChildDetail = { ...baseChild, homes: [linkedHome] }
  const guardianA: GuardianDetail = {
    id: 'g1',
    name: 'Jane',
    phone_number: '+12025550123',
    is_active: true,
    homes: [linkedHome, dadsHome, inactiveHome],
    children: [],
    language: null,
    language_conversation_id: null,
  }
  const guardianB: GuardianDetail = {
    id: 'g2',
    name: 'John',
    phone_number: '+12025550199',
    is_active: true,
    homes: [dadsHome],
    children: [],
    language: null,
    language_conversation_id: null,
  }

  it('excludes inactive homes, homes already on the child, and duplicates shared by two guardians', () => {
    expect(candidateHomes(child, [guardianA, guardianB])).toEqual([dadsHome])
  })

  it('returns an empty list when there are no other homes', () => {
    expect(candidateHomes(child, [{ ...guardianA, homes: [linkedHome] }])).toEqual([])
  })
})
