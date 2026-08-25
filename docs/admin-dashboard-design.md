# TutorLink — Admin Dashboard Design

## Overview

The TutorLink dashboard is a Vite + React web application. It serves three types of users with different views and access levels:

- **Admin** — full control over tutors, clients, bookings, availability, and user accounts
- **Tutor** — read-only view of their own schedule, sessions, and time off
- **Developer** — a superset of admin: the same views and the same access, plus system-level fields an admin does not see

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
- Redirects to `/dashboard` for admins and developers, or `/schedule` for tutors
- Role is read from the decoded JWT and stored in app state

### Route Guards

All routes are protected. Unauthenticated users are redirected to `/login`. Tutor users attempting to access admin-only routes are redirected to their own schedule view. Admin routes admit admin or above — asked that way, not by naming roles — so a developer is admitted alongside an admin.

---

## Navigation

### Admin — Sidebar (desktop) / Hamburger menu (mobile)

```
TutorLink
─────────────
Dashboard
Tutors
Clients
Chats
Bookings
Subjects
Users
Settings
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

**Data:**
- `GET /api/stats/overview?date=<today>` supplies the four counts and the recent-bookings feed in one request. `date` is required — the API holds no clock.
- Today's session **list** is `GET /api/bookings?status=pending&status=confirmed&from=<today>&to=<today>` — the same status scoping as `today_session_count`, so the number and the rows beneath it agree. The stats endpoint carries the count only; an aggregate endpoint returns aggregates.
- "Upcoming this week" is the rest of the ISO week — tomorrow through Sunday, so it reads `0` on a Sunday. Label the widget with the `week_end` the response returns rather than computing a week boundary in the client.
- `<today>` is the **browser's local date**; re-fetch on date rollover so a tab left open past midnight does not keep showing yesterday. The API bounds `date` neither way and will not catch a stale one.
- Bigger hazard: `scheduled_date` is a bare **business-local** date and TutorLink configures no business timezone, so an admin whose machine runs a different zone from the sessions sends the wrong calendar day near either edge of the day and the widgets show another day's counts with no error. Until a business timezone exists there is nothing but the browser to resolve `<today>` against; show the date the page queried rather than only the word "today".

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
- Exceptions section: list of upcoming exceptions with a status badge (pending / approved / rejected),
  approve/reject buttons on any `pending` row, add new exception
- Recent bookings for this tutor

**Forms:**
- Add/Edit Tutor: name, email, phone, bio
- Add Subject: subject dropdown + a single grade ceiling input
- Add Availability Slot: day of week, start time, end time
- Add Exception: date range picker, start time (optional), end time (optional), reason dropdown, notes
  - The times apply to **each day** in the range, not as one continuous absence. Label them so an admin
    picking Mon–Wed 09:00–17:00 reads "those hours on all three days", not "Monday morning through
    Wednesday evening" — the overnights stay bookable
  - An exception created here is `approved` on creation, not `pending` — an admin's own entry needs no
    review step, unlike a tutor's self-serve request from `/time-off`

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

### Chats (`/chats`)

Every WhatsApp conversation the bot has had, admin-only — tutors have no chat surface.

**Conversation list:**
- Rows: guardian name, or the bare phone number when intake never got far enough to create one, last
  message preview, relative time, a `Human` badge naming the holder when the conversation is under
  takeover
- Unread rows render bold with a dot
- Filters: all / bot / human, unread only, and a free-text search box over phone number and guardian
  name
- A guardian who has changed phone number has one row per number, since a thread stays on the number it
  was held with. The list shows the same name more than once, so each row carries its phone number
  underneath to tell them apart, and ordering by last message puts the live one on top

**Thread (`/chats/{id}`):**
- Client messages left-aligned; bot and admin messages right-aligned
- Admin messages are labelled with the sending admin's email, so a later reader can tell a human reply
  from a bot one without opening the message detail
- Failed outbound messages carry an error marker
- Opening a thread marks it read
- The composer is disabled and replaced by a **Take over** button until the conversation is claimed.
  Once claimed, a banner reads that the bot is paused and names who paused it, with a **Release to
  bot** control next to it. Release opens a confirm dialog rather than acting immediately — releasing
  hands an in-progress conversation back to an automated flow that starts fresh, not from where the
  admin left it, so an accidental click should not be able to do that to a client mid-conversation

Live updates for both the list and the open thread arrive over the single admin WebSocket described in
`docs/api-design.md`, not a per-conversation connection.

---

### Bookings (`/bookings`)

View and manage all sessions.

**List/Table view:**
- Columns: date, time, child name, tutor name, subject, status
- Filters: date range, tutor, subject, status
- Status badge with colour coding: pending (yellow), confirmed (green), cancelled (red), completed (grey)
- Click a row to open booking detail slide-over
- "Create Booking" button for manual bookings → opens a slide-over form

**Create Booking form:**
- Child selector (searchable, across all clients)
- Tutor selector
- Subject selector
- Date, start time, end time
- Home selector — scoped to **the selected child's homes**, not a free list of every home in the system.
  Empty until a child is chosen, and re-scoped when the child changes
- `booked_by_guardian_id` stays NULL for bookings created here; this is the admin path, with no guardian
  on the other end of it

**Booking detail slide-over:**
- Full session info: child, the guardian who booked it, tutor, subject, date, time, and the home it is at
- The address and access code of **the booking's home** — not the guardian's (visible to admin)
- Status update dropdown
- Notes field

---

### Subjects (`/subjects`)

Manage the canonical subject list.

**List view:**
- Table: subject name, description, number of tutors teaching it, active status
- "Add Subject" button

**Data:**
- "number of tutors teaching it" is the `tutor_count` field on each `GET /api/subjects` item — active tutors only, one request, no second call per row.

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

### Settings (`/settings`)

System-wide configuration, reachable by admin and developer alike — the same `ADMIN_ROLES` gate as `/dashboard`, not an admin-only check.

**List view:**
- Renders exactly the rows `GET /api/settings` returns, in the order it returns them. The page keeps no list of its own about which settings exist — a setting added by a migration appears without a dashboard change
- Each row's control comes from the server's `value_type`; a `value_type` the dashboard has no editor for renders read-only rather than being guessed at or hidden
- Which fields the viewer may edit is the server's answer, not the page's: every field the page received is editable by the viewer who received it, and a developer-only field is simply absent from an admin's response — not blank, not redacted, absent
- A row flagged `is_developer_only` carries a "Developer only" badge beside its label. An admin never receives such a row, so the badge is something only a developer can see
- **Today no setting is developer-only, so the page renders identically for both roles.** This is expected, not a gap — the mechanism is built ahead of any field that needs it

**Editing:**
- One "Save changes" button saves the whole form as a single batch; only the fields that changed are sent, in one all-or-nothing request
- A "Discard changes" button restores the server values
- A refused save shows the API's own message and keeps the viewer's edits

**The nine settings today**, named here for a reader's reference — this list is documentation, not a client-side key list the page itself holds: `session_length_minutes`, `session_gap_minutes`, `booking_lookahead_days`, `min_booking_lead_hours`, `cancellation_cutoff_hours`, and the four login rate limits (`login_rate_limit_ip_max_attempts`, `login_rate_limit_ip_window_seconds`, `login_rate_limit_email_max_attempts`, `login_rate_limit_email_window_seconds`). A `max_attempts` of `0` disables that rate-limit bucket. See `docs/api-design.md`'s Settings section for what each one does.

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

The tutor's exception history and self-serve time-off requests.

- List of upcoming and past exceptions: date range, time range (blank = all day), reason, notes, status
  (pending / approved / rejected)
- "Request Time Off" button → the same date range / time range / reason / notes form as the admin's Add
  Exception, but the row it creates lands `pending`, not `approved`
- A `pending` request does not block bookings — only after an admin approves it does it subtract from the
  tutor's availability. The status badge is what tells the tutor whether a request has taken effect yet
- A tutor may withdraw a request while it is still `pending` (delete from the list). Once an admin has
  approved or rejected it, the row is locked from the tutor's side — undoing an admin's decision is an
  admin action, not a tutor one

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
| Chats list + thread | Two-pane: list on the left, thread on the right | List full-screen; thread opens as a full-screen page with a back control |

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
│   │   ├── Chats.jsx
│   │   ├── ChatThread.jsx
│   │   ├── Bookings.jsx
│   │   ├── Subjects.jsx
│   │   ├── Users.jsx
│   │   └── Settings.jsx
│   └── tutor/
│       ├── Schedule.jsx
│       ├── Sessions.jsx
│       └── TimeOff.jsx
├── components/
│   ├── layout/
│   │   ├── AdminSidebar.jsx
│   │   ├── TutorNav.jsx
│   │   └── RouteGuard.jsx
│   ├── chat/
│   │   ├── ConversationList.jsx
│   │   ├── MessageThread.jsx
│   │   └── Composer.jsx
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
│   ├── useClients.js
│   └── useConversations.js
├── lib/
│   ├── api.js          # Axios instance with JWT interceptor
│   ├── auth.js         # Token management
│   └── socket.js       # WebSocket connection, auth handshake, reconnect backoff
└── App.jsx
```

This tree is illustrative and predates the TypeScript conversion: the shipped files are `.tsx`, and the settings page lives at `pages/admin/Settings.tsx` with its server state in `lib/queries/settings.ts` and its pure logic in `lib/settings.ts`.