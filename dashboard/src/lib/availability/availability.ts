const DAYS_IN_WEEK = 7

// `Date.getDay()` is 0 = Sunday, `tutor_availability.day_of_week` is 0 = Monday. Every conversion
// between the two goes through here: reading a slot off the wrong index offers Tuesday's hours on
// a Wednesday, and nothing in the system reports that as an error.
export const dayOfWeekFromIso = (iso: string): number => {
  const [year, month, day] = iso.split('-').map(Number)
  const sundayFirst = new Date(Date.UTC(year, month - 1, day)).getUTCDay()

  return (sundayFirst + 6) % DAYS_IN_WEEK
}
