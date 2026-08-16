# TutorLink — Admin Dashboard Design

## Overview

The TutorLink dashboard is a Vite + React web application. It serves two types of users with different views and access levels:

- **Admin** — full control over tutors, clients, bookings, availability, and user accounts
- **Tutor** — read-only view of their own schedule, sessions, and time off

The dashboard is fully responsive, designed to work on desktop browsers and iPhone.

---

## Tech Stack

| Concern | Choice |
|---|---|
| Framework | Vite + React |
| Routing | React Router v6 |
| State management | React Query (server state) + Zustand (UI state) |
| Styling | Tailwind CSS |
| Component library | shadcn/ui |
| HTTP client | Axios |
| Auth | JWT stored in memory (not localStorage) with refresh token in HttpOnly cookie |

---

## Authentication

### Login Page (`/login`)

- Email + password form
- Calls `POST /auth/token`
- On success: stores access token in memory, refresh token in HttpOnly cookie
- Redirects to `/dashboard` for admins or `/schedule` for tutors
- Role is read from the decoded JWT and stored in app state

### Route Guards

All routes are protected. Unauthenticated users are redirected to `/login`. Tutor users attempting to access admin-only routes are redirected to their own schedule view.

---

## Navigation

### Admin — Sidebar (desktop) / Hamburger menu (mobile)

```
TutorLink
─────────────
Dashboard
Tutors
Clients
Bookings
Subjects
Users
─────────────
Logout
```

### Tutor — Bottom tab bar (mobile) / Sidebar (desktop)

```
My Schedule  |  My Sessions  |  Time Off
```

---

## Admin Views

---

### Dashboard (`/dashboard`)

Overview page with key metrics at a glance.

**Widgets:**
- Today's sessions (count + list)
- Upcoming sessions this week
- Total active tutors
- Total active clients
- Recent bookings (last 5)

---

### Tutors (`/tutors`)

Manage the tutor roster.

**List view:**
- Table of all tutors: name, email, phone, subjects, active status
- Search by name
- Filter by subject, active status
- "Add Tutor" button → opens a slide-over form

**Tutor detail (`/tutors/{id}`):**
- Profile section: name, email, phone, bio, active toggle
- Subjects section: list of assigned subjects + the grade ceiling for each, add/remove
- Availability section: weekly schedule grid (Mon–Sun), add/edit/remove slots
- Exceptions section: list of upcoming exceptions, add new exception
- Recent bookings for this tutor

**Forms:**
- Add/Edit Tutor: name, email, phone, bio
- Add Subject: subject dropdown + a single grade ceiling input
- Add Availability Slot: day of week, start time, end time
- Add Exception: date range picker, start time (optional), end time (optional), reason dropdown, notes
  - The times apply to **each day** in the range, not as one continuous absence. Label them so an admin
    picking Mon–Wed 09:00–17:00 reads "those hours on all three days", not "Monday morning through
    Wednesday evening" — the overnights stay bookable

---

### Clients (`/clients`)

View all guardian/client records.

**List view:**
- Table: guardian name, phone number, number of homes, number of children, active status
- Search by name or phone number
- Filter by active status

**Client detail (`/clients/{id}`):**
- Guardian info: name, phone. No address here — see homes below
- Homes: label, address, access code — a client may have more than one, and a home may be shared with another guardian
- Children list: name, age, grade, school — each expandable, showing that child's guardians and homes
- Booking history across all children, filterable by status and date

---

### Bookings (`/bookings`)

View and manage all sessions.

**List/Table view:**
- Columns: date, time, child name, tutor name, subject, status
- Filters: date range, tutor, subject, status
- Status badge with colour coding: pending (yellow), confirmed (green), cancelled (red), completed (grey)
- Click a row to open booking detail slide-over
- "Create Booking" button for manual bookings

**Booking detail slide-over:**
- Full session info: child, the guardian who booked it, tutor, subject, date, time, and the home it is at
- Parent address + access code (visible to admin)
- Status update dropdown
- Notes field

---

### Subjects (`/subjects`)

Manage the canonical subject list.

**List view:**
- Table: subject name, description, number of tutors teaching it, active status
- "Add Subject" button

**Forms:**
- Add/Edit Subject: name, description, active toggle

---

### Users (`/users`)

Manage login accounts for admin and tutor users.

**List view:**
- Table: email, role, linked tutor (if tutor role), active status
- "Add User" button

**Forms:**
- Add User: email, temporary password, role selector, tutor link (shown when role = tutor)
- Edit User: email, role, active toggle, reset password option

---

## Tutor Views

---

### My Schedule (`/schedule`)

The tutor's weekly availability view.

- Read-only weekly grid showing their recurring availability slots
- Exceptions displayed as blocked-out dates with reason label — a partial-day exception blocks only its own hours, not the whole day
- Cannot edit — directs tutor to contact admin for changes

---

### My Sessions (`/sessions`)

The tutor's upcoming and past bookings.

**List view:**
- Upcoming sessions (default tab): date, time, child name, subject, address + access code
- Past sessions (second tab): same fields + status
- Search by child name
- Filter by date range

**Session card (mobile):**
- Child name + grade
- Subject
- Date + time
- Address + access code (tap to reveal) — **from the booking's home**, not the guardian's. A child with separated guardians has two, and the session is at one of them

---

### Time Off (`/time-off`)

The tutor's exception history.

- List of upcoming and past exceptions: date range, time range (blank = all day), reason, notes
- Read-only — tutor cannot create or delete exceptions themselves
- Includes a contact prompt: "To request time off, contact your admin"

> **Note:** whether tutors can self-serve time off requests is a future decision. For now, all exceptions are admin-managed.

---

## Responsive Behaviour

| Element | Desktop | Mobile (iPhone) |
|---|---|---|
| Admin navigation | Left sidebar, always visible | Hamburger menu, slides in |
| Tutor navigation | Left sidebar | Bottom tab bar (3 tabs) |
| Tables | Full column set | Horizontal scroll or card layout |
| Forms | Slide-over panel | Full-screen modal |
| Booking detail | Slide-over | Full-screen page |
| Tutor weekly grid | Full 7-day grid | Scrollable horizontal grid |

---

## Component Structure

```
dashboard/src/
├── pages/
│   ├── Login.jsx
│   ├── admin/
│   │   ├── Dashboard.jsx
│   │   ├── Tutors.jsx
│   │   ├── TutorDetail.jsx
│   │   ├── Clients.jsx
│   │   ├── ClientDetail.jsx
│   │   ├── Bookings.jsx
│   │   ├── Subjects.jsx
│   │   └── Users.jsx
│   └── tutor/
│       ├── Schedule.jsx
│       ├── Sessions.jsx
│       └── TimeOff.jsx
├── components/
│   ├── layout/
│   │   ├── AdminSidebar.jsx
│   │   ├── TutorNav.jsx
│   │   └── RouteGuard.jsx
│   ├── shared/
│   │   ├── StatusBadge.jsx
│   │   ├── SlideOver.jsx
│   │   ├── DataTable.jsx
│   │   └── ConfirmDialog.jsx
│   └── forms/
│       ├── TutorForm.jsx
│       ├── BookingForm.jsx
│       ├── AvailabilityForm.jsx
│       ├── ExceptionForm.jsx
│       └── UserForm.jsx
├── hooks/
│   ├── useAuth.js
│   ├── useTutors.js
│   ├── useBookings.js
│   └── useClients.js
├── lib/
│   ├── api.js          # Axios instance with JWT interceptor
│   └── auth.js         # Token management
└── App.jsx
```