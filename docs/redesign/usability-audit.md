# Usability audit: dashboard, per role and device

Resolves #182 (part of map #180). Walked on 2026-10-13 in headless Chromium (Playwright), at **1440×900 (desktop)** and **390×844 (phone)**, signed in as an Admin, a Manager and a Tutor. All screenshots are under [`audit/`](audit/).

**Setup.** This was run against a fresh database (`ux_audit_182`) on the local test Postgres, with migrations at head (0036). It was seeded with 5 subjects, 1 Admin, 1 Manager and 3 Tutors (one with no login yet), 10 Guardians and 13 Children with homes and Subject levels, about 106 bookings spread over ±3 weeks around today (one live Evaluation), weekly availability, 5 time-off requests (pending, approved and rejected) and 7 chats (bot-held, taken over, and flagged as stuck, question or booking request). Twilio and SMTP were not configured, so outbound sends fail by design. Screenshot names follow `role-page-device.png`. A `-viewport-` name is the first screen only; any other name is the full page.

**Severity.**
- **High**: blocks or badly slows a frequent job, or hides information someone needs to act.
- **Medium**: adds real friction or causes confusion, but there is a workaround.
- **Low**: polish, consistency or copy.

---

## 1. Jobs per role and how many steps they take today

A step is a click, tap or field entry, counted from the role's landing page. "Hunt" means the user has to page, scroll or filter, and the number of steps depends on the data.

### Office (Admin and Manager)

| Job | Path today | Steps |
|---|---|---|
| See what is happening today | Lands on Dashboard: "Today's sessions" plus counts | 0 (but nothing tells them what needs attention) |
| Find what needs action (flagged chats, pending time off, children awaiting evaluation, pending bookings) | No single place. Chats → "Flagged only"; Children → "Awaiting evaluation" tab; each Tutor page → Exceptions; Bookings → Status "Pending" | 3 pages minimum, plus **one page per Tutor** for time off |
| Approve a Tutor's time off | Tutors → open tutor → scroll to Exceptions → Approve | 4 per tutor, and nothing signals which tutor has a request (hunt) |
| Book a session | Bookings → New booking → Child (search) → Staff → Location → Subject → Date → Start → End → Create | 10, with no availability or free slots shown |
| Book from a Child | Children → Child → scroll to bottom → Book a session → the same form | 11+ |
| Reschedule a booking | Bookings (list opens on the **oldest** bookings) → switch to Calendar or filter → open booking → Edit → change date and time → Save | 6–8 plus hunt |
| Cancel a booking | Open booking → Status dropdown → "Cancelled" | 3 plus hunt (no explicit "Cancel booking" action) |
| Answer a flagged chat | Chats → (Flagged only) → open thread → Take over → type → Send → Hand back to bot → Mark handled | 7–8 |
| Evaluate a Child | Children → "Awaiting evaluation" → Child → for each subject: pick subject, pick level, Add level → mark Evaluated | 4 + 3 per subject |
| Add a new family by hand | Guardians → Add guardian → save → guardian page → Add home → save → Add child (needs a guardian with a home) → save | 3 forms, ~15 fields |
| Add a Tutor (Admin only) | **Users** (not Tutors) → Add user → Role "Tutor" → name, email, phone → Save → Tutors → open → Add subject (×n) → Add slot (×n) | 10 + 3 per subject + 5 per slot, across 2 sections |
| Manager: see own sessions | Bookings → Staff = self → opens on oldest first → Calendar or paginate | 3–5 plus hunt; `/sessions` redirects a Manager to Dashboard |
| Manager: request own time off | Not possible in the UI | none |

### Tutor

| Job | Path today | Steps |
|---|---|---|
| See my next session | Lands on **My Schedule**, which shows availability, not sessions → My Sessions → (phone: scroll past the filter card) → tap row | 2–3 |
| Get the address and access code | … → session row → Show access code | 3–4 |
| Request time off | Time Off → Request Time Off → First day → Last day → (optional hours) → Reason → Send | 6–8 |
| See whether time off was approved | Time Off → read the badge | 1 |
| Change availability | Not possible. The copy says "an admin action"; the Tutor has to ask outside the app | none |

---

## 2. Findings

Count: **14 high, 31 medium, 22 low** (67 in total). Cross-role findings come first, then findings by role and page. Within each page, findings are ordered by severity.

### 2.1 Cross-role (every signed-in role)

**X1 — High — No "needs attention" signal anywhere.**
- **Where:** Sidebar or tab bar, Dashboard, every page.
- **Why it hurts:** Unread or flagged chats, pending time off, Children awaiting evaluation and pending bookings each live on a different page, and no nav item carries a badge or count. Office learns about work only by visiting every section, and things that are time-sensitive slip. For example, a Takeover is only possible within 24 hours of the Guardian's last message.
- **Screenshots:** `audit/admin-dashboard-desktop.png`, `audit/admin-nav-open-phone.png`

**X2 — High — On phone, every table becomes a stack of key/value cards.**
- **Where:** Bookings, Dashboard, Children, Users, Tutor detail, Guardian detail, My Sessions.
- **Why it hurts:** Each row turns into a 6–9 line card that repeats labels ("Child", "Staff", "Location"…). Bookings is about 4,900px tall for 20 rows, and Children about 3,700px for 11. Scanning and comparing become impossible, and the useful field (time, child) is not visually primary.
- **Screenshots:** `audit/admin-bookings-phone.png`, `audit/admin-children-phone.png`, `audit/admin-tutors-detail-phone.png`

**X3 — Medium — Two navigation models for one product.**
- **Where:** App shell.
- **Why it hurts:** On phone, Office gets a hamburger drawer while Tutors get a bottom tab bar. On desktop both get a sidebar, but Profile and Logout are text for Office and unlabeled icons in the Tutor's phone header. A Manager will move between both mental models (map decision: one merged app).
- **Screenshots:** `audit/admin-nav-open-phone.png`, `audit/tutor-schedule-phone.png`

**X4 — Medium — Inconsistent button hierarchy and footer order.**
- **Where:** Slide-overs and section headers.
- **Why it hurts:** Add child and New booking put the primary button first, on the left. Add user, Add slot and Request Time Off put Cancel first and the primary on the right. "Edit" is filled primary on Child and Guardian pages but outline on Tutor detail. "Add guardian", "Add home" and "Add child" are filled, while "Add subject", "Add slot" and "Add exception" are outline. Users cannot learn where the main action is.
- **Screenshots:** `audit/admin-children-add-desktop.png`, `audit/admin-users-add-desktop.png`, `audit/admin-children-detail-desktop.png`, `audit/admin-tutors-detail-desktop.png`

**X5 — Medium — Three styles of segmented control for the same idea.**
- **Where:** Upcoming/Past and All/Regular/Evaluation filters.
- **Why it hurts:** Bookings, Children and Time Off use a boxed segmented tab. My Sessions uses small pill chips under a "Show" label. Bookings status uses outline chips. The same job (switch a list's scope) looks different on each page.
- **Screenshots:** `audit/tutor-sessions-desktop.png`, `audit/tutor-time-off-desktop.png`, `audit/admin-bookings-desktop.png`

**X6 — Medium — Lists that hold history default to oldest first.**
- **Where:** Bookings list, Guardian booking history, Manager's own bookings.
- **Why it hurts:** Page 1 shows completed sessions from three weeks ago, and today is on page 3 or later. The most common question ("what's coming up?") needs a date filter or the Calendar toggle. Child detail and My Sessions do default to Upcoming, which is inconsistent.
- **Screenshots:** `audit/admin-bookings-desktop.png`, `audit/admin-guardians-detail-desktop.png`, `audit/manager-bookings-own-filter-desktop.png`

**X7 — Medium — Explanatory copy written about the system, not for the user.**
- **Where:** Throughout.
- **Why it hurts:** Examples:
  - "this device's local date"
  - "the grid itself is a read-only view"
  - "A request lands pending and blocks nothing until an admin approves it — the status badge is what says whether it has taken effect"
  - "Filters the sessions on this page, not the whole history"
  - "A deactivated home stays listed here; the guardian list counts only the active ones"

  These explain the implementation and add reading load.
- **Screenshots:** `audit/tutor-time-off-desktop.png`, `audit/tutor-sessions-desktop.png`, `audit/admin-guardians-detail-desktop.png`

**X8 — Medium — Vocabulary drifts from CONTEXT.md and between pages.**
- **Where:** Copy.
- **Why it hurts:** Examples:
  - Login says "manage tutors, **clients**, and bookings". "Client" is a term CONTEXT.md says to avoid, and Tutors read this line too.
  - Office calls time off "**Exceptions**", Tutors call it "**Time Off**".
  - Booking "**Edit**" is the domain act **Reschedule**.
  - Chat badges say "**Bot**" and "**Human**" and the header says "**Held by**", where the glossary has Takeover and Hand-back.
  - The Guardians page counts "**households**", a term that is not in the glossary.
  - Tutor copy says "an **admin** approves", but Managers approve too.
- **Screenshots:** `audit/auth-login-phone.png`, `audit/admin-tutors-detail-desktop.png`, `audit/admin-chats-desktop.png`, `audit/admin-guardians-desktop.png`

**X9 — Low — Phone numbers appear in two formats.**
- **Where:** Guardians list and Child page, versus Guardian detail, Chats and Tutors.
- **Why it hurts:** Some pages show `+1 (555) 111-0001` and others show raw `+15551110001`. It looks like two different values and is harder to read aloud.
- **Screenshots:** `audit/admin-guardians-desktop.png`, `audit/admin-guardians-detail-desktop.png`

**X10 — Low — Error states echo the raw server message, repeated per section.**
- **Where:** Dashboard, Bookings, Chats on a failed API.
- **Why it hurts:** The page shows "Internal error" three times on Dashboard, with no hint of what happened or whether data is safe. Retry is good, but the copy isn't human. Loading skeletons are good and consistent.
- **Screenshots:** `audit/admin-dashboard-error-desktop.png`, `audit/admin-chats-error-phone.png`, `audit/admin-bookings-loading-desktop.png`

### 2.2 Admin and Manager (Office)

The findings below apply to both roles unless they say Admin-only.

#### Dashboard

**O1 — High — The Dashboard is a report, not a work queue.**
- **Where:** `/dashboard`.
- **Why it hurts:** Two counters, today's sessions and "Recent bookings". Nothing about flagged chats, pending time off, pending bookings, Children awaiting evaluation or failed messages. It is the landing page but cannot answer "what do I need to do?" See X1.
- **Screenshot:** `audit/admin-dashboard-desktop.png`

**O2 — Medium — "Recent bookings" has no clear order or meaning.**
- **Where:** Dashboard.
- **Why it hurts:** Dates jump (22 Oct, 14 Oct, 24 Sep, 30 Sep, 26 Oct) because the list is ordered by creation, not by date, and the label doesn't say so. Users can't tell whether these are new, changed or upcoming.
- **Screenshot:** `audit/admin-dashboard-desktop.png`

**O3 — Low — The two stat cards repeat the section below and waste the first screen on phone.**
- **Where:** Dashboard.
- **Why it hurts:** "Today's sessions: 4" sits above a table of the same 4 sessions. On phone the cards take the whole first screen.
- **Screenshot:** `audit/admin-dashboard-phone.png`

#### Bookings

**O4 — High — Creating a booking is a blind form.**
- **Where:** New booking slide-over.
- **Why it hurts:**
  - Staff is not filtered by subject or grade.
  - No free slots or availability are shown.
  - Start and end times are typed by hand. The session length setting exists but nothing pre-fills it.
  - Conflicts surface only on submit.

  Ten inputs for the most common Office job, and staff must already know who is free.
- **Screenshots:** `audit/admin-bookings-new-desktop.png`, `audit/admin-bookings-new-phone.png`

**O5 — High — Cancel and Reschedule are hidden.**
- **Where:** Booking detail slide-over.
- **Why it hurts:** Cancelling is a Status dropdown set to "Cancelled", with no labelled action. Rescheduling is a small outline "Edit" that opens a **second** slide-over on top of the first. Neither action is named as the domain act, and both sit between read-only fields.
- **Screenshots:** `audit/admin-bookings-detail-upcoming-desktop.png`, `audit/admin-bookings-edit-desktop.png`

**O6 — Medium — List is the default view, and the filter card dominates.**
- **Where:** Bookings.
- **Why it hurts:** The Calendar view is the more useful one (week at a glance, current day highlighted) but needs a click every visit. The filter card (6 fields + 4 chips) is always open on desktop and pushes results below the fold.
- **Screenshots:** `audit/admin-bookings-desktop.png`, `audit/admin-bookings-calendar-desktop.png`

**O7 — Medium — Booking detail contradicts the edit form.**
- **Where:** Booking detail.
- **Why it hurts:** Notes is badged "Read-only" in the detail, but the Edit form has an editable Notes field. Completed bookings show a Status dropdown with no Edit button, so it is unclear what can still change.
- **Screenshots:** `audit/admin-bookings-row-click-desktop.png`, `audit/admin-bookings-edit-desktop.png`

**O8 — Medium — Booking detail is a dead end.**
- **Where:** Booking detail.
- **Why it hurts:** The child, guardian and staff names are plain text, not links, and the Guardian's phone is not shown. To call the family about a change, staff close the panel, go to Children, search, open the child, then open the guardian.
- **Screenshot:** `audit/admin-bookings-row-click-desktop.png`

**O9 — Low — Calendar cards can't be clicked to create.**
- **Where:** Bookings → Calendar.
- **Why it hurts:** Empty space in a day cannot be clicked to start a booking at that time, and the week grid has no time axis. Evaluations are shown only by a dashed border and an italic word.
- **Screenshot:** `audit/admin-bookings-calendar-desktop.png`

**O10 — Low — Phone booking list and Calendar repeat staff and location on every card.**
- **Where:** Bookings on phone.
- **Why it hurts:** It adds density. The agenda-style Calendar on phone is actually the better phone layout but isn't the default.
- **Screenshots:** `audit/admin-bookings-calendar-phone.png`, `audit/admin-bookings-filters-phone.png`

#### Tutors

**O11 — High — Time-off approvals are buried per Tutor.**
- **Where:** Tutor detail → "Exceptions".
- **Why it hurts:** Pending requests exist only inside each Tutor's page, below Profile, Subjects and Availability. Nothing in the Tutors list, sidebar or Dashboard shows that a request is waiting. A request can sit until the dates have passed.
- **Screenshots:** `audit/admin-tutors-detail-desktop.png`, `audit/admin-tutors-desktop.png`

**O12 — High — There is no "Add tutor" on the Tutors page.**
- **Where:** Tutors list.
- **Why it hurts:** The only top action is "Manage subjects". Adding a Tutor happens in **Users** → Add user → Role "Tutor", and the phone field appears only after the role is chosen. Managers have no way to add a Tutor at all, yet they can Deactivate one.
- **Screenshots:** `audit/admin-tutors-desktop.png`, `audit/admin-users-add-desktop.png`, `audit/manager-tutor-detail-viewport-desktop.png`

**O13 — Medium — Tutors list hides sign-in state.**
- **Where:** Tutors list.
- **Why it hurts:** Sofia (never invited, cannot sign in) shows the same green "Active" as everyone else. The "No login" badge is only on Users. Office can't see from Tutors who still needs an Invite.
- **Screenshots:** `audit/admin-tutors-desktop.png`, `audit/admin-users-desktop.png`

**O14 — Medium — Availability copy contradicts the UI, and the grid scrolls sideways on phone.**
- **Where:** Tutor detail → Availability.
- **Why it hurts:** The help text says "the grid itself is a read-only view", but every slot card has edit and delete icons. On phone the 7-day grid scrolls horizontally with Thursday to Sunday off-screen and no scroll cue.
- **Screenshots:** `audit/admin-tutors-detail-desktop.png`, `audit/admin-tutors-detail-phone.png`

**O15 — Medium — "Upcoming bookings" on Tutor detail is read-only and includes cancelled sessions.**
- **Where:** Tutor detail.
- **Why it hurts:** The copy says "The next 10 sessions… Editing happens on the bookings page." Rows can't be opened, so editing means leaving the page and finding the booking again. Cancelled sessions take 1 of the 10 slots.
- **Screenshot:** `audit/admin-tutors-detail-desktop.png`

**O16 — Low — Subject "Remove" is styled as plain text, and destructive actions sit next to Edit.**
- **Where:** Tutor detail.
- **Why it hurts:** "Remove" next to a subject looks like a label. The red "Deactivate" sits beside "Edit" in the profile header, which invites a mis-tap on phone.
- **Screenshots:** `audit/admin-tutors-detail-desktop.png`, `audit/admin-tutors-detail-phone.png`

#### Children

**O17 — Medium — Every Children row has a "Deactivate" button.**
- **Where:** Children list.
- **Why it hurts:** A rare, destructive action is the only button on each row, on desktop and phone. Opening the child (the common job) has no visible affordance: the row is clickable but nothing signals it.
- **Screenshots:** `audit/admin-children-desktop.png`, `audit/admin-children-phone.png`

**O18 — Medium — The Children table is cramped and wordy.**
- **Where:** Children list.
- **Why it hurts:** "Evaluated" repeats "Alice Admin, 13 Sep 2026" on every row. "Next session" wraps to 3 lines. Names and grades wrap. There are 10 columns, so the useful ones (name, guardian, next session, awaiting evaluation) don't stand out.
- **Screenshot:** `audit/admin-children-desktop.png`

**O19 — Medium — Child page: "Book a session" sits at the very bottom.**
- **Where:** Child detail.
- **Why it hurts:** The main action for a child is below Details, Evaluation, Subject levels, Guardians, Homes and the sessions table, about 1,800px down on desktop and further on phone.
- **Screenshots:** `audit/admin-children-detail-desktop.png`, `audit/admin-children-detail-phone.png`

**O20 — Medium — Subject level editing mixes two models.**
- **Where:** Child detail → Evaluation.
- **Why it hurts:** Existing levels are inline dropdowns that apply immediately. New levels use a separate Subject + Level + "Add level" row. A repeated hint line lists each subject with no level. The page-level Edit covers only Details.
- **Screenshot:** `audit/admin-children-detail-desktop.png`

**O21 — Low — "Remove" on a child's only home is disabled with no reason.**
- **Where:** Child detail → Homes.
- **Why it hurts:** The greyed button gives no tooltip or hint.
- **Screenshot:** `audit/admin-children-detail-desktop.png`

**O22 — Low — Add child dead-ends on a missing home.**
- **Where:** Add child slide-over.
- **Why it hurts:** It says "None of the selected guardians has an active home. Add one on a guardian's page first" before a guardian is even chosen. Users have to leave the form, losing their place, to fix it.
- **Screenshot:** `audit/admin-children-add-desktop.png`

#### Guardians

**O23 — Medium — Guardian cards don't look clickable and are labelled as "households".**
- **Where:** Guardians list.
- **Why it hurts:** The cards have no link styling or action. Inside each card, "Guardians" and "Children" small labels repeat on every card. The count says "9 households" on a page called Guardians.
- **Screenshot:** `audit/admin-guardians-desktop.png`

**O24 — Medium — Guardian page mixes inline edits with an Edit button.**
- **Where:** Guardian detail.
- **Why it hurts:** Language is an always-live dropdown (it changes immediately), while Name and Phone need "Edit". The Children table has an empty Status column, and its rows don't link to the Child.
- **Screenshot:** `audit/admin-guardians-detail-desktop.png`

**O25 — Medium — Guardian booking history is long, oldest first, and not actionable.**
- **Where:** Guardian detail.
- **Why it hurts:** 20 past rows show before anything upcoming, rows can't be opened, and the filter block uses checkboxes where Bookings uses chips.
- **Screenshots:** `audit/admin-guardians-detail-desktop.png`, `audit/admin-guardians-detail-phone.png`

**O26 — Low — "Record opt-in" sits alone with little context.**
- **Where:** Guardian detail → Weekly reminders.
- **Why it hurts:** The page doesn't explain when staff should record consent, and "Never opted in" shows next to "No reminder sent yet", which reads as a problem.
- **Screenshot:** `audit/admin-guardians-detail-desktop.png`

#### Chats

**O27 — High — Flagged chats aren't prioritised, and the flag reason isn't actionable.**
- **Where:** Chats list.
- **Why it hurts:** The list is ordered by time, so a "Stuck" chat 5 hours old sits below newer routine ones. "Flagged only" is an unchecked box by default. The thread has no link to the Guardian or Child, so resolving "change the address for Diya" means leaving the chat.
- **Screenshots:** `audit/admin-chats-desktop.png`, `audit/admin-chat-flagged-desktop.png`

**O28 — Medium — Thread actions are scattered.**
- **Where:** Chat thread.
- **Why it hurts:** "Mark handled" and Language sit in the header. "Take over" is at the bottom of the thread. "Hand back to bot" and "Transfer to me" sit in a bar above the messages. Each state moves the main action.
- **Screenshots:** `audit/admin-chat-flagged-desktop.png`, `audit/admin-chat-takeover-dialog-desktop.png`, `audit/admin-chats-detail-desktop.png`

**O29 — Medium — Status badges read as system internals.**
- **Where:** Chats list.
- **Why it hurts:** "Bot" (green, so it looks like good news) and "Human" (grey), plus a name, plus a flag badge. Office has to translate "Human · Marco Manager" into "Marco has taken this over".
- **Screenshot:** `audit/admin-chats-desktop.png`

**O30 — Low — Desktop split view shows "Back to chats" and the list together.**
- **Where:** Chat thread on desktop.
- **Why it hurts:** The back link is redundant next to the visible list. The selected-row highlight is clipped short of the row width. The thread pane doesn't fill the viewport height.
- **Screenshot:** `audit/admin-chats-detail-desktop.png`

**O31 — Low — System lines are vague.**
- **Where:** Chat thread.
- **Why it hurts:** "Staff joined the chat · delivered" doesn't say who joined. The failed-send line "Takeover notice not delivered · Retry" is good.
- **Screenshots:** `audit/admin-chats-detail-desktop.png`, `audit/admin-chat-takeover-dialog-desktop.png`

**O32 — Low — Phone: chat filters crowd the right edge.**
- **Where:** Chats on phone.
- **Why it hurts:** "Flagged only" runs into the 16px gutter, and the filters take a third of the first screen.
- **Screenshot:** `audit/admin-chats-viewport-phone.png`

#### Reminders

**O33 — Medium — The empty preview doesn't say why.**
- **Where:** Reminders.
- **Why it hurts:** "No Guardians are due this week." In fact no Guardian has opted in, and reminders are paused because no template is approved. That fact is only on Settings. The page header gives the schedule but not the paused state.
- **Screenshots:** `audit/admin-reminders-desktop.png`, `audit/admin-settings-email-desktop.png`

**O34 — Low — Week navigator next arrow is disabled with no explanation.**
- **Where:** Reminders.
- **Why it hurts:** It sits top right, away from the content, and gives no reason it is disabled.
- **Screenshot:** `audit/admin-reminders-desktop.png`

#### Users (Admin only)

**O35 — High — "Add user" defaults Role to Admin.**
- **Where:** Add user slide-over.
- **Why it hurts:** The most privileged role is preselected, so a hurried Admin can grant full access by accident. The phone and bio fields that a Tutor needs are hidden until the role changes.
- **Screenshot:** `audit/admin-users-add-desktop.png`

**O36 — Medium — Users and Tutors overlap.**
- **Where:** Users vs Tutors.
- **Why it hurts:** Tutors and Managers are listed in both places. Deactivate exists in both. The Invite and "No login" state is only in Users, and profile, subjects and availability only in Tutors. Users rows aren't clickable to see a person's profile.
- **Screenshots:** `audit/admin-users-desktop.png`, `audit/admin-tutors-desktop.png`

**O37 — Low — Phone: Users cards stack two outline buttons per row.**
- **Where:** Users on phone.
- **Why it hurts:** The cards get long, and "Deactivate" carries the same weight as "Send reset link".
- **Screenshot:** `audit/admin-users-viewport-phone.png`

#### Settings (Admin only)

**O38 — High — Settings is a flat list of 18 raw configuration keys.**
- **Where:** Settings → first card.
- **Why it hurts:** The keys are alphabetical, ungrouped, and shown with their snake_case names. Business rules (session length, gap, lead time, cancellation cutoff) are mixed with security internals (8 rate-limit fields) and ops values (retention purge hour UTC). Units are only in the names. An Admin can't find what to change and can easily break login rate limits.
- **Screenshots:** `audit/admin-settings-desktop.png`, `audit/admin-settings-viewport-phone.png`

**O39 — Medium — Three separate Save/Discard bars on one page.**
- **Where:** Settings.
- **Why it hurts:** Each card saves on its own, but the bars look identical. Users can't tell whether "Save changes" at the bottom also saves the card above.
- **Screenshot:** `audit/admin-settings-desktop.png`

**O40 — Low — The email template editor is heavy for a rare task.**
- **Where:** Settings → Email templates.
- **Why it hurts:** Two subject/body editors with tall previews make Settings about 4,400px long. The "Reminders are paused" notice, which affects a weekly job, is buried mid-page.
- **Screenshots:** `audit/admin-settings-desktop.png`, `audit/admin-settings-email-desktop.png`

#### My profile

**O41 — Low — My profile edits only the Display name.**
- **Where:** My profile dialog.
- **Why it hurts:** The dialog is fine. But a Manager who is also a Tutor cannot see or change their own phone, bio or password here.
- **Screenshots:** `audit/admin-my-profile-desktop.png`, `audit/admin-my-profile-phone.png`

### 2.3 Manager-specific

**M1 — High — Managers have no view of their own teaching.**
- **Where:** Nav and `/sessions`.
- **Why it hurts:** A Manager teaches, but `/sessions`, `/schedule` and `/time-off` redirect to Dashboard. Their own week means filtering Bookings by their name every visit. The filter opens on oldest first, and the selection isn't kept.
- **Screenshots:** `audit/manager-sessions-redirect-desktop.png`, `audit/manager-bookings-own-filter-desktop.png`

**M2 — High — Managers cannot request time off.**
- **Where:** App-wide.
- **Why it hurts:** There is no Time Off page for the role. The only path is another Office member adding an Exception on the Manager's Tutor page. A Manager can probably approve their own request there too, which is an unclear rule either way.
- **Screenshot:** `audit/manager-dashboard-desktop.png`

**M3 — Medium — Managers can deactivate Tutors but can't add or invite them.**
- **Where:** Tutor detail.
- **Why it hurts:** Users is Admin-only, so the asymmetry surprises people. The Manager sees a red Deactivate button but no route to bring someone on.
- **Screenshots:** `audit/manager-tutor-detail-viewport-desktop.png`, `audit/manager-tutors-desktop.png`

**M4 — Low — Manager nav simply drops Users and Settings.**
- **Where:** Sidebar.
- **Why it hurts:** This is fine in itself. But nothing in the Manager's UI acknowledges that they are also staff who teach (see M1).
- **Screenshot:** `audit/manager-dashboard-phone.png`

### 2.4 Tutor

**T1 — High — The Tutor lands on availability, not sessions.**
- **Where:** `/schedule` (the default landing).
- **Why it hurts:** "My Schedule" shows weekly availability slots with no bookings on them. A Tutor opening the app wants to know "where am I going next", which needs a second tap to My Sessions. The names "Schedule" and "Sessions" don't tell the two apart.
- **Screenshots:** `audit/tutor-schedule-desktop.png`, `audit/tutor-schedule-phone.png`

**T2 — High — Phone: My Sessions puts the filter card above the sessions.**
- **Where:** My Sessions on phone.
- **Why it hurts:** From, To and "Search this page by child name" fill the first screen. The first session starts at the fold. This is the Tutor's main phone screen.
- **Screenshot:** `audit/tutor-sessions-viewport-phone.png`

**T3 — Medium — Session rows hide what a Tutor needs on the way.**
- **Where:** My Sessions.
- **Why it hurts:** Rows show Location as just "Home" or "In office". The address, the access code (behind an extra "Show access code" tap) and child notes appear only in the detail slide-over. There is no Guardian contact for running late, and no "today" grouping.
- **Screenshots:** `audit/tutor-sessions-desktop.png`, `audit/tutor-session-row-click-desktop.png`

**T4 — Medium — Calendar is better on phone but not the default, and repeats the Tutor's own name.**
- **Where:** My Sessions → Calendar.
- **Why it hurts:** The agenda layout groups by day (good), but every card says "Tara Tutor · Home · Reading". Showing your own name back to you is noise.
- **Screenshots:** `audit/tutor-sessions-calendar-viewport-phone.png`, `audit/tutor-sessions-calendar-desktop.png`

**T5 — Medium — Availability can't be changed or even requested.**
- **Where:** My Schedule.
- **Why it hurts:** The copy says "availability changes are an admin action". The Tutor has no request path, so changes happen outside the app.
- **Screenshot:** `audit/tutor-schedule-desktop.png`

**T6 — Medium — The time-off form explains hours in a confusing way.**
- **Where:** Request Time Off.
- **Why it hurts:** "Hours blocked on each of those days. Leave both empty to block every day in full. Set both to block only those hours on each day in the range." A plain "All day" toggle would remove the explanation. The disabled "Send request" shows its reason as small grey text at the bottom.
- **Screenshots:** `audit/tutor-time-off-request-phone.png`, `audit/tutor-time-off-request-desktop.png`

**T7 — Low — "Search this page by child name" is a confusing scope.**
- **Where:** My Sessions.
- **Why it hurts:** A search that only filters the visible page, with a note saying so, will miss results the user expects.
- **Screenshot:** `audit/tutor-sessions-desktop.png`

**T8 — Low — The phone availability strip scrolls sideways with no cue.**
- **Where:** My Schedule on phone.
- **Why it hurts:** Thursday to Sunday are cut off at the right edge, and nothing shows that the strip scrolls.
- **Screenshot:** `audit/tutor-schedule-phone.png`

**T9 — Low — Header icons are unlabeled on phone.**
- **Where:** Tutor phone header.
- **Why it hurts:** The person icon (profile) and arrow icon (logout) have no text. Logout is one tap with no confirmation.
- **Screenshots:** `audit/tutor-schedule-phone.png`, `audit/tutor-my-profile-phone.png`

### 2.5 Auth pages (all roles)

**A1 — Medium — Login copy is Office-centric and uses an avoided term.**
- **Where:** `/login`.
- **Why it hurts:** "Sign in to manage tutors, clients, and bookings" is wrong for Tutors and uses "clients". "Trouble signing in? Contact your administrator" is vague.
- **Screenshot:** `audit/auth-login-phone.png`

**A2 — Low — "Log in" and "sign in" are mixed.**
- **Where:** Login, Set password, Forgot password.
- **Why it hurts:** The button says "Log in" while the links say "Back to sign in".
- **Screenshots:** `audit/auth-login-desktop.png`, `audit/auth-set-password-desktop.png`

**A3 — Low — An invalid Set password link shows a form heading with no form.**
- **Where:** `/set-password` without a valid token.
- **Why it hurts:** The page keeps "Set your password · Choose a password of at least 8 characters" above the error. The recovery copy itself ("Request a new reset link or ask an Admin for a new invite") is good.
- **Screenshot:** `audit/auth-set-password-desktop.png`

---

## 3. What works and should be kept

- **Loading skeletons** match each table's shape. See `audit/admin-bookings-loading-desktop.png`.
- **Error states** include Try again.
- **Search empty state** is clear. See `audit/admin-children-empty-search-desktop.png`.
- **Phone Bookings filters** open as a full sheet with a live "Show 106 bookings" button. See `audit/admin-bookings-filters-phone.png`.
- **The agenda-style Calendar on phone** is the strongest phone layout in the app.
- **Takeover** is one tap, and a failed send shows an inline Retry.
- **The Session detail slide-over** for Tutors shows address, access code and child notes together.
- **No horizontal page overflow** at 390px on any page. Only the availability strips scroll sideways inside their card.

## 4. Not covered or limits

- **Outbound messaging:** Twilio and SMTP were not configured, so delivered or failed message states, test emails, invites and reset emails were seen only in their failure form.
- **Live updates:** chat streaming over WebSocket was not exercised with a live inbound message.
- **Developer role:** not audited. It is outside the Office/Tutor scope.
- **Not submitted end to end:** Add guardian, Add home, Manage subjects and the Evaluation-marking flow were opened but not completed. Step counts for those jobs come from the form fields seen.
- **Accessibility:** keyboard and screen-reader use were not audited. This is a visual and heuristic pass.
- **Seeded data:** the data is synthetic, so some combinations, like a grade 1 child at a high school, are artefacts of the seed and not findings.
