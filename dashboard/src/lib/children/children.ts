import { formatIsoDate } from '@/lib/dates/dates'

export const ageOn = (dateOfBirth: string, today: Date): number => {
  const [birthYear, birthMonth, birthDay] = dateOfBirth.split('-').map(Number)
  const todayMonth = today.getMonth() + 1
  const todayDay = today.getDate()
  let age = today.getFullYear() - birthYear

  if (todayMonth < birthMonth || (todayMonth === birthMonth && todayDay < birthDay)) {
    age -= 1
  }

  return age
}

export const formatDateOfBirth = (dateOfBirth: string | null, today: Date): string => {
  let result: string

  if (dateOfBirth === null) {
    result = 'Not recorded'
  } else {
    result = `${formatIsoDate(dateOfBirth)} (age ${ageOn(dateOfBirth, today)})`
  }

  return result
}
