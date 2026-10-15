export type Theme = 'light' | 'dark'
export type Screen = 'list' | 'calendar' | 'tutor'
export interface VariantProps { theme: Theme; screen: Screen }

export type BookingKind = 'Tutoring' | 'Evaluation'
export type BookingStatus = 'Upcoming' | 'Completed' | 'Cancelled' | 'Taken over' | 'Pending'
export interface Booking {
  id: string
  kind: BookingKind
  status: BookingStatus
  child: string
  childNotes?: string
  guardian: string
  tutor: string
  subject: string
  level: string
  start: string
  durationMin: number
  location: string
  directions?: string
}

export const bookings: Booking[] = [
  { id: 'b01', kind: 'Tutoring', status: 'Completed', child: 'Lucas Herrera', guardian: 'Diana Herrera', tutor: 'Marco Diaz', subject: 'Reading', level: 'Grade 2', start: '2026-10-12T15:00:00', durationMin: 60, location: '8450 NW 53rd St, Doral, FL 33166' },
  { id: 'b02', kind: 'Evaluation', status: 'Completed', child: 'Valentina Rojas', guardian: 'Carlos Rojas', tutor: 'Priya Patel', subject: 'Math', level: 'Grade 5', start: '2026-10-12T16:30:00', durationMin: 90, location: 'In office' },
  { id: 'b03', kind: 'Tutoring', status: 'Cancelled', child: 'Mateo Silva', guardian: 'Andrea Silva', tutor: 'Jordan Blake', subject: 'Science', level: 'Grade 6', start: '2026-10-12T17:30:00', durationMin: 60, location: '10200 NW 41st St, Doral, FL 33178' },
  { id: 'b04', kind: 'Tutoring', status: 'Upcoming', child: 'Sofia Martinez', childNotes: 'Gets anxious with fractions; likes drawing', guardian: 'Laura Martinez', tutor: 'Ana Ruiz', subject: 'Math', level: 'Grade 4', start: '2026-10-13T09:30:00', durationMin: 60, location: '5600 NW 105th Ct, Doral, FL 33178', directions: 'Gate code 4512, blue door on the left' },
  { id: 'b05', kind: 'Evaluation', status: 'Upcoming', child: 'Daniel Ortiz', childNotes: 'First evaluation; shy at first, warms up with games', guardian: 'Patricia Ortiz', tutor: 'Ana Ruiz', subject: 'Reading', level: 'Grade 3', start: '2026-10-13T11:30:00', durationMin: 90, location: 'In office' },
  { id: 'b06', kind: 'Tutoring', status: 'Upcoming', child: 'Isabella Gomez', childNotes: 'Needs frequent short breaks', guardian: 'Monica Gomez', tutor: 'Ana Ruiz', subject: 'Writing', level: 'Grade 5', start: '2026-10-13T15:30:00', durationMin: 60, location: '3300 NW 87th Ave, Doral, FL 33172', directions: 'Visitor parking, apartment 4B, call on arrival' },
  { id: 'b07', kind: 'Tutoring', status: 'Upcoming', child: 'Gabriel Torres', childNotes: 'Prepping for a spelling test on Friday', guardian: 'Ricardo Torres', tutor: 'Ana Ruiz', subject: 'Reading', level: 'Grade 2', start: '2026-10-13T17:30:00', durationMin: 60, location: '8700 NW 36th St, Doral, FL 33166', directions: 'Ring the bell twice, dog is friendly' },
  { id: 'b08', kind: 'Tutoring', status: 'Upcoming', child: 'Emma Castillo', guardian: 'Julia Castillo', tutor: 'Marco Diaz', subject: 'Math', level: 'Grade 3', start: '2026-10-13T16:00:00', durationMin: 60, location: 'In office' },
  { id: 'b09', kind: 'Evaluation', status: 'Pending', child: 'Noah Fernandez', guardian: 'Elena Fernandez', tutor: 'Priya Patel', subject: 'Math', level: 'Grade 6', start: '2026-10-14T14:00:00', durationMin: 90, location: 'In office' },
  { id: 'b10', kind: 'Tutoring', status: 'Taken over', child: 'Camila Reyes', guardian: 'Sandra Reyes', tutor: 'Jordan Blake', subject: 'Science', level: 'Grade 7', start: '2026-10-14T16:30:00', durationMin: 60, location: '11010 NW 58th St, Doral, FL 33178' },
  { id: 'b11', kind: 'Tutoring', status: 'Upcoming', child: 'Santiago Vega', guardian: 'Maria Vega', tutor: 'Marco Diaz', subject: 'Math', level: 'Grade 5', start: '2026-10-15T15:00:00', durationMin: 60, location: '9100 NW 25th St, Doral, FL 33172' },
  { id: 'b12', kind: 'Tutoring', status: 'Upcoming', child: 'Sofia Martinez', guardian: 'Laura Martinez', tutor: 'Ana Ruiz', subject: 'Math', level: 'Grade 4', start: '2026-10-15T17:00:00', durationMin: 60, location: '5600 NW 105th Ct, Doral, FL 33178', directions: 'Gate code 4512, blue door on the left' },
  { id: 'b13', kind: 'Evaluation', status: 'Upcoming', child: 'Olivia Mendez', guardian: 'Teresa Mendez', tutor: 'Jordan Blake', subject: 'Reading', level: 'Grade 1', start: '2026-10-16T10:00:00', durationMin: 90, location: 'In office' },
  { id: 'b14', kind: 'Tutoring', status: 'Upcoming', child: 'Lucas Herrera', guardian: 'Diana Herrera', tutor: 'Sam Okafor', subject: 'Reading', level: 'Grade 2', start: '2026-10-16T15:30:00', durationMin: 60, location: '8450 NW 53rd St, Doral, FL 33166' },
  { id: 'b15', kind: 'Tutoring', status: 'Pending', child: 'Adriana Paz', guardian: 'Luis Paz', tutor: 'Sam Okafor', subject: 'Writing', level: 'Grade 8', start: '2026-10-17T10:30:00', durationMin: 60, location: 'In office' },
  { id: 'b16', kind: 'Evaluation', status: 'Upcoming', child: 'Mia Dominguez', guardian: 'Veronica Dominguez', tutor: 'Priya Patel', subject: 'Math', level: 'Grade 2', start: '2026-10-18T11:00:00', durationMin: 90, location: 'In office' },
]

export const currentTutor = 'Ana Ruiz'

export const tutorSessions: Booking[] = bookings
  .filter((booking) => booking.tutor === currentTutor)
  .sort((a, b) => a.start.localeCompare(b.start))

export interface TodoItem { id: string; kind: 'time-off' | 'chat' | 'evaluation' | 'booking'; title: string; detail: string }

export const todo: TodoItem[] = [
  { id: 't1', kind: 'time-off', title: 'Time off request — Marco Diaz', detail: 'Oct 20–22, 3 days' },
  { id: 't2', kind: 'chat', title: 'Laura Martinez wrote in chat', detail: 'Asks to move Thursday’s session to 6 pm' },
  { id: 't3', kind: 'evaluation', title: 'Evaluation needs a tutor', detail: 'Noah Fernandez, Math Grade 6, Oct 14' },
  { id: 't4', kind: 'booking', title: 'Booking taken over', detail: 'Camila Reyes: Jordan Blake covers Oct 14' },
  { id: 't5', kind: 'chat', title: 'Carlos Rojas wrote in chat', detail: 'Questions about the evaluation results' },
]

export const weekStart = '2026-10-12'
export const today = '2026-10-13'
