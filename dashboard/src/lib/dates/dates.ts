type CalendarDate = { year: number; month: number; day: number }

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

export const DAY_LABELS: readonly string[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export const todayLocalIso = (now: Date): string =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

export const addDaysIso = (iso: string, days: number): string => {
  const { year, month, day } = splitIso(iso)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))

  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
}

export const formatIsoDate = (iso: string): string => {
  const { year, month, day } = splitIso(iso)

  return `${day} ${MONTH_LABELS[month - 1]} ${year}`
}

export const formatTime = (hms: string): string => {
  const [hour, minute] = hms.split(':').map(Number)
  const meridiem = hour < 12 ? 'AM' : 'PM'

  return `${hour % 12 === 0 ? 12 : hour % 12}:${pad(minute)} ${meridiem}`
}

const pad = (value: number): string => String(value).padStart(2, '0')

const splitIso = (iso: string): CalendarDate => {
  const [year, month, day] = iso.split('-').map(Number)

  return { year, month, day }
}
