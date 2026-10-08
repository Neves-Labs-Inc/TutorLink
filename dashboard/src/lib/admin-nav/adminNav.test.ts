import { describe, expect, it } from 'vitest'
import type { Role } from '@/lib/auth/auth'
import { adminNavItemsFor } from './adminNav'

const labelsFor = (role: Role): string[] => adminNavItemsFor(role).map((item) => item.label)

describe('adminNavItemsFor', () => {
  const FULL = ['Dashboard', 'Bookings', 'Tutors', 'Children', 'Guardians', 'Chats', 'Reminders', 'Users', 'Settings']

  it('gives a manager every staff item but Users and Settings, in order', () => {
    expect(labelsFor('manager')).toEqual(['Dashboard', 'Bookings', 'Tutors', 'Children', 'Guardians', 'Chats', 'Reminders'])
  })

  it('gives an admin every item', () => {
    expect(labelsFor('admin')).toEqual(FULL)
  })

  it('gives a developer every item', () => {
    expect(labelsFor('developer')).toEqual(FULL)
  })

  it('gives a tutor none of the staff items', () => {
    expect(labelsFor('tutor')).toEqual([])
  })
})
