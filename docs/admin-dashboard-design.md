# TutorLink — Admin Dashboard Design

## Overview

The TutorLink dashboard is a Vite + React web application. It serves three types of users with different views and access levels:

- **Admin** — full control over tutors, guardians and children, bookings, availability, and user accounts
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
Children
Guardians
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
- Total active guardians
- Recent bookings (last 5)

**Data:**
- `GET /api/stats/overview?date=<today>` supplies the four counts and the recent-bookings feed in one request. `date` is required — the API holds no clock.
- Today's session **list** is `GET /api/bookings?status=pending&status=confirmed&from=<today>&to=<today>` — the same status scoping as `today_session_count`, so the number and the rows beneath it agree. The stats endpoint carries the count only; an aggregate endpoint returns aggregates.
- "Upcoming this week" is the rest of the ISO week — tomorrow through Sunday, so it reads `0` on a Sunday. Label the widget with the `week_end` the response returns rather than computing a week boundary in the client.
- `<today>` is the **browser's local date**; re-fetch on date rollover so a tab left open past midnight does not keep showing yesterday. The API bounds `date` neither way and will not catch a stale one.
- Bigger hazard: `scheduled_date` is a bare **business-local** date and the API now has a `BUSINESS_TIMEZONE` setting, but the stats endpoint still takes its date from the caller, so an admin whose machine runs a different zone from the business sends the wrong calendar day near either edge of the day and the widgets show another day's counts with no error. Until the dashboard resolves `<today>` in the business zone, the browser is all it has; show the date the page queried rather than only the word "today".

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

### Children (`/children`)

Every child in the system, organised around the child rather than the guardian.

**List view:**
- Table: name, grade, school, guardian name(s), home(s), next session (the child's next upcoming booking)
- Hides inactive children by default, with a "show inactive" toggle — the same convention as
  Tutors and Guardians
- Search by child or guardian name
- Deactivate / reactivate is a row action on the list, not on the child's detail page.
  Deactivating a child with upcoming sessions shows "this will cancel N sessions" before the
  admin confirms; confirming cancels them and notifies nobody — no WhatsApp to the guardians, no
  notice to the tutor
- "Add child" opens a slide-over: pick **one or more** guardians first, then a home from all of
  the selected guardians' active homes, then the child's own fields (name, date of birth, grade,
  school, notes)

**Child detail (`/children/{id}`):**
- Info: name, date of birth with the current age derived from it ("Not recorded" when missing),
  grade, school, notes — all editable
- Guardians and homes, with links that can be added and removed — at least one guardian and one
  home are required
- Upcoming and past bookings
- "Book a session" opens the booking form with this child pre-selected. Disabled only when the
  child has no active home; an inactive child shows **Reactivate and book** instead of a plain
  submit — reactivate, then book
- No deactivate control here — that lives on the `/children` list

### Guardians (`/guardians`)

Household cards — every guardian and child reachable through a chain of guardian–child links.

**List view:**
- A household is a connected component of guardian–child links: separated parents sharing a
  child, plus one parent's new partner and her own child linked to that parent, are all one
  household. A guardian with no children is a household of one
- A card shows: guardians with phone numbers; children (name and grade, linking to
  `/children/{id}`). No homes and no upcoming sessions on the card
- Inactive guardians are always shown, with an "inactive" badge — no hide toggle. An inactive
  child on a card carries its own badge
- A search box matches any guardian name, child name, or phone number, and returns the whole
  household
- "Add guardian" opens the same form as today's create-client flow: name, phone, optional home.
  The new guardian appears as a solo household, and submitting opens that guardian's own page

**Guardian detail (`/guardians/{id}`)** — today's Client detail page, renamed:
- Guardian info: name, phone. No address here — see homes below
- Homes: label, address, access code — a guardian may have more than one, and a home may be
  shared with another guardian. Homes can be added (choosing which of the guardian's children are
  tutored there), edited, and deactivated or reactivated
- Children: name, date of birth with the current age derived from it ("Not recorded" when
  missing), grade, school, and notes. "Add child" here pre-fills this guardian; children can also
  be added from the `/children` page
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
- A pending reactivation request shows a panel above the thread: "Reactivation requested for
  {name}" (a link to the child's page; "already active" when so), with **Approve** and **Deny**,
  each behind a confirm dialog — Approve: "Reactivate {name}?"; Deny: "Deny the request? {name}
  stays inactive. The guardian is not notified." Available without a takeover. The flag's badge
  uses the routine (non-error) tone
- A flagged thread shows its reason as a badge in the header with a **Mark handled** button beside
  it — one click, no confirmation; the thread leaves the flagged list and the client is not
  notified. A reactivation request has no Mark handled: Approve or Deny ends it. If the bot flagged
  the thread again after it was opened, Mark handled is refused and the new flag is shown

Live updates for both the list and the open thread arrive over the single admin WebSocket described in
`docs/api-design.md`, not a per-conversation connection.

---

### Bookings (`/bookings`)

View and manage all sessions.

**List/Table view:**
- Columns: date, time, child name, tutor name, subject, status
- Filters: date range, tutor, subject, child, status
- Status badge with colour coding: pending (yellow), confirmed (green), cancelled (red), completed (grey)
- Click a row to open booking detail slide-over
- "Create Booking" button for manual bookings → opens a slide-over form. When opened from a
  child's page, that child is pre-selected

**Create Booking form:**
- Child selector (searchable, across all guardians). Inactive children are listed too and marked
  as such; choosing one turns the submit button into **Reactivate and book** — the form
  reactivates the child, then books. If the booking then fails, the child stays active and the
  form keeps the draft
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
- The grid is not editable here. **Availability** changes are an admin action — the view directs the tutor to contact an admin. **Time off** is self-serve: the view directs the tutor to `/time-off`, where they request it themselves

---

### My Sessions (`/sessions`)

The tutor's upcoming and past bookings.

**List view:**
- Upcoming sessions (default tab): date, time, child name, subject, address + access code, **status**
- Past sessions (second tab): the same fields, including **status**
- **Status is shown on both tabs, and Upcoming applies no status filter.** Upcoming is not live-only: a cancelled future session is bounded out of Past, so filtering it off Upcoming would leave it on neither tab and the tutor's only signal would be a row silently vanishing
- Search by child name
- Filter by date range

**Session card (mobile):**
- Child name + grade
- Subject
- Date + time
- Address + access code (tap to reveal) — **from the booking's home**, not the guardian's. A child with separated guardians has two, and the session is at one of them

**Session detail** (opening a session): the session, the home it is at (address and access code,
tap to reveal), the session's own notes under **Session notes**, and the child's notes — learning
needs, allergies — under **Child notes**. The child's date of birth and age are never shown to a
tutor.

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
│   │   ├── Children.jsx
│   │   ├── ChildDetail.jsx
│   │   ├── Guardians.jsx
│   │   ├── GuardianDetail.jsx
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
│   ├── useGuardians.js
│   ├── useChildren.js
│   └── useConversations.js
├── lib/
│   ├── api.js          # Axios instance with JWT interceptor
│   ├── auth.js         # Token management
│   └── socket.js       # WebSocket connection, auth handshake, reconnect backoff
└── App.jsx
```

This tree is illustrative and predates the TypeScript conversion: the shipped files are `.tsx`, and the settings page lives at `pages/admin/Settings.tsx` with its server state in `lib/queries/settings.ts` and its pure logic in `lib/settings.ts`.