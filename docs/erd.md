# TutorLink — Entity Relationship Diagram

## Overview

TutorLink uses a PostgreSQL relational database as the single source of truth for all business data. Conversation state is handled separately in Redis and is not persisted long-term.

---

## Tables

### `users`
Login accounts for the admin dashboard. Supports two roles: `admin` (full access) and `tutor` (own schedule only). Tutor accounts are linked to a row in the `tutors` table.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| email | VARCHAR | Unique — used as login username |
| hashed_password | VARCHAR | Bcrypt hashed |
| role | ENUM | admin, tutor |
| tutor_id | UUID | FK → tutors.id — null for admin accounts |
| is_active | BOOLEAN | Soft delete flag |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

Constraints: `UNIQUE (email)` · `INDEX (email, role)`

---

### `guardians`
**Identity only.** Who the client is and how the bot reaches them. Identified by phone number, which is used to recognise returning clients.

Called a *guardian* rather than a parent because the person engaging the service may be a grandparent, a step-parent, or a legal guardian. The API keeps calling them a **client**, which is the business relationship rather than the relationship to the child; both are accurate on their own axis.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| phone_number | VARCHAR | Unique — used to identify returning clients |
| name | VARCHAR | Guardian's full name |
| is_active | BOOLEAN | Soft delete flag |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

Constraints: `UNIQUE (phone_number)` · `INDEX (phone_number)`

Address and access code are **not here** — they belong to a `home`. A child with separated guardians has two homes, either guardian may book into either, and siblings share the pair. A single fused row could express none of that.

---

### `homes`
Where tutoring happens. Separated from guardian identity so a child can have more than one.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| label | VARCHAR | Optional short name — "Mum's", "Dad's". The bot asks "which home?" and reading two full addresses over WhatsApp is a poor prompt |
| address | TEXT | Address where tutoring takes place |
| access_code | VARCHAR | Neighbourhood or building access code |
| is_active | BOOLEAN | Soft delete flag |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

---

### `child_guardians`
Which guardians a child has. Many-to-many: siblings share guardians, and a child with separated guardians has two.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| child_id | UUID | FK → children.id |
| guardian_id | UUID | FK → guardians.id |

Constraints: `UNIQUE (child_id, guardian_id)` · `INDEX (guardian_id)`

---

### `child_homes`
Which homes a child is tutored at. Many-to-many, which is what accommodates siblings sharing a home and one child having two.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| child_id | UUID | FK → children.id |
| home_id | UUID | FK → homes.id |

Constraints: `UNIQUE (child_id, home_id)` · `INDEX (home_id)`

---

### `guardian_homes`
Which homes belong to a guardian. Explicit rather than derived through children: a couple sharing one home before separation cannot be expressed by a single owner column, a tutor at an address needs to know which guardian to call, and intake collects the address before any child row exists.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| guardian_id | UUID | FK → guardians.id |
| home_id | UUID | FK → homes.id |

Constraints: `UNIQUE (guardian_id, home_id)` · `INDEX (home_id)`

**All three junctions are hard-delete** — no `is_active`, matching `tutor_subjects`. A junction is a link rather than an entity, so the soft-delete rule does not apply to it. Unlinking after a custody change is a DELETE and takes effect immediately.

---

### `children`
A child belongs to one or more guardians, through `child_guardians`, and is tutored at one or more homes, through `child_homes`. Neither is derivable from the other. The bot collects child info during intake and loops until all children are registered.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| name | VARCHAR | Child's full name |
| age | INT | Age at time of registration |
| grade_level | INT | The child's grade, as a number — 7, not "Grade 7" |
| school_name | VARCHAR | School the child attends |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

Constraints: none beyond the primary key — the guardian and home links live in their own tables

---

### `subjects`
Canonical list of subjects managed by the admin. Normalised to prevent duplicates like "Math" vs "Mathematics".

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| name | VARCHAR | e.g. Math, English, Science |
| description | TEXT | Optional description |
| is_active | BOOLEAN | Soft delete flag |
| created_at | TIMESTAMPTZ | |

Constraints: `UNIQUE (name)`

---

### `tutors`
Tutor profiles managed by the admin via the dashboard.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| name | VARCHAR | Tutor's full name |
| phone_number | VARCHAR | Unique |
| email | VARCHAR | Unique |
| bio | TEXT | Optional tutor biography |
| is_active | BOOLEAN | Soft delete flag |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

Constraints: `UNIQUE (email, phone_number)`

---

### `tutor_subjects`
Junction table linking tutors to the subjects they can teach, with the highest grade level they cover per subject.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| tutor_id | UUID | FK → tutors.id |
| subject_id | UUID | FK → subjects.id |
| max_grade_level | INT | Ceiling, not an enumeration — 8 covers grades 1–8 |

The ceiling is per subject because a tutor may handle grade 12 maths but only grade 8 French. Matching asks `max_grade_level >= child.grade_level`, so a tutor is offered for every grade at or below their ceiling rather than only those explicitly listed.

Constraints: `UNIQUE (tutor_id, subject_id)` · `INDEX (tutor_id, subject_id)`

---

### `tutor_availability`
Defines a tutor's recurring weekly schedule. Each row represents one recurring time slot on a given day of the week.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| tutor_id | UUID | FK → tutors.id |
| day_of_week | SMALLINT | 0 = Monday … 6 = Sunday |
| start_time | TIME | Slot start time |
| end_time | TIME | Slot end time |
| is_active | BOOLEAN | Soft delete flag |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

Constraints: `UNIQUE (tutor_id, day_of_week, start_time)` · `INDEX (tutor_id, day_of_week)`

---

### `tutor_availability_exceptions`
Overrides the recurring schedule for specific dates or date ranges. Handles single days off and multi-day absences like vacations.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| tutor_id | UUID | FK → tutors.id |
| start_date | DATE | First day of exception |
| end_date | DATE | Last day of exception (equals start_date for a single day off) |
| start_time | TIME | Nullable. NULL means the exception blocks the whole day |
| end_time | TIME | Nullable. NULL means the exception blocks the whole day |
| reason | VARCHAR | vacation, personal, sick, other |
| notes | TEXT | Optional admin notes |
| status | ENUM `exception_status` | `pending`, `approved`, `rejected`. NOT NULL, default `approved` |
| created_at | TIMESTAMPTZ | |

A set time window applies to **every** day in the `start_date`–`end_date` range, not as one continuous
absence across it — the row cannot express "Monday 09:00 straight through to Wednesday 17:00", and the
`end_time > start_time` check makes that reading unrepresentable anyway.

`status` defaults to `approved` because exceptions were admin-managed and immediately blocking before
tutors could create their own — every row that existed before this column was added backfills to
`approved`, the meaning-preserving value that leaves their effect on availability unchanged. A tutor
creating their own exception gets `pending` instead; an admin or developer creating one still gets
`approved` immediately, since making an admin approve their own entry would be a step with no gate value.
Only an `approved` row subtracts from availability — see [Availability Query Logic](#availability-query-logic).

Constraints: `CHECK ((start_time IS NULL) = (end_time IS NULL))` · `CHECK (start_time IS NULL OR end_time > start_time)` · `INDEX (tutor_id, start_date, end_date)`

The two checks are separate rather than one expression: each is null-safe on its own, and a violation names which rule was broken. A half-set pair is rejected outright — NULL only reads as "whole day" if it cannot also mean "the other half was left off".

---

### `bookings`
Confirmed tutoring sessions. Links a child to a tutor for a specific subject on a specific date and time.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| child_id | UUID | FK → children.id |
| tutor_id | UUID | FK → tutors.id |
| subject_id | UUID | FK → subjects.id |
| availability_id | UUID | FK → tutor_availability.id — the recurring slot this booking came from |
| home_id | UUID | FK → homes.id — **where the session happens.** Required, and not derivable once a child has two |
| booked_by_guardian_id | UUID | FK → guardians.id — NULL when an admin created it. Answers "who scheduled this" |
| scheduled_date | DATE | The actual date of the session |
| start_time | TIME | Session start time |
| end_time | TIME | Session end time |
| status | ENUM | pending, confirmed, cancelled, completed |
| notes | TEXT | Optional notes from client or admin |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

Constraints: `EXCLUDE USING gist excl_bookings_live_overlap (tutor_id WITH =, tsrange(scheduled_date + start_time, scheduled_date + end_time) WITH &&) WHERE (status IN (pending, confirmed))` · `INDEX (child_id, tutor_id, subject_id, scheduled_date, status)` · `INDEX (home_id)`

---

### `system_settings`
Runtime-configurable business settings, as typed key/value rows. A row per setting rather than one row per column: the set grows, and adding one should be an INSERT rather than a migration. Read at request time — several of these re-cut the slot grid, so a cached value would silently serve a stale schedule.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| key | VARCHAR | Unique — e.g. `session_length_minutes` |
| value | TEXT | Stored as text; `value_type` says how to read it |
| value_type | VARCHAR | Rendering hint for the settings page. Validators stay in code |
| is_developer_only | BOOLEAN | Defaults **TRUE** — fail closed, so an unflagged setting hides from admins rather than leaking |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

Constraints: `UNIQUE (key)`

Seeded contents. Every row is admin-editable today; the `is_developer_only` gate exists ahead of its first occupant.

| key | default | re-cuts the grid? |
|---|---|---|
| session_length_minutes | 60 | yes |
| session_gap_minutes | 30 | yes |
| booking_lookahead_days | 90 | no |
| min_booking_lead_hours | 0 | no |
| cancellation_cutoff_hours | 24 | no |

---

## Relationships

```
users ──────────────────────────────────── tutors
                                              │
guardians ──< child_guardians >── children >── bookings
    │                                 │        │
    └──< guardian_homes >── homes >── child_homes
                              │       │
                              └───────┴──────< bookings
                                              │
tutors ───────────────────────────────────────┤
  │                                           │
  ├──< tutor_subjects >── subjects ───────────┤
  │
  ├──< tutor_availability
  │         │
  │         └──────────────────────────── bookings
  │
  └──< tutor_availability_exceptions
```

---

## Availability Query Logic

When a client requests a slot, the bot runs three checks in sequence:

1. Fetch recurring ranges from `tutor_availability` matching the requested day of week, and cut each into a grid of candidate slots
2. Subtract slots blocked by a `tutor_availability_exceptions` range with `status = 'approved'` covering the requested date (`start_date <= requested_date <= end_date`) — the whole day when `start_time`/`end_time` are NULL, or by time overlap when they are set. `pending` and `rejected` rows are ignored entirely
3. Subtract slots already taken in `bookings` where `scheduled_date = requested_date` and `status IN (pending, confirmed)`
4. Return remaining open slots to the client

Step 1 strides from the range's `start_time` by `session_length_minutes + session_gap_minutes`. Tutoring
happens at the home (`homes.address`), so the tutor travels between sessions and back-to-back slots were
never realistic. Slot *n* runs from `start_time + n × (length + gap)` for `length` minutes, and is emitted
only while its end lands at or before the range's `end_time`. Whatever remains after the last whole slot
is leftover and is not offered.

```
Availability   09:00 ------------------------------ 12:00
Grid (60+30)   [09:00-10:00] .... [10:30-11:30] ....
Leftover                                  (11:30-12:00)
```

At length 60 and gap 30 the stride is 90 minutes: 09:00 and 10:30 fit, 12:00 would end at 13:00 and is
dropped, leaving 11:30–12:00 unoffered. Both settings are runtime-editable and both re-cut every future
grid, which is why steps 2 and 3 never assume a stored exception or booking lines up with the current
grid.

A slot is also withheld unless it starts after `now + min_booking_lead_hours` (default 0), and the
requested date must fall within `booking_lookahead_days` (default 90) of today.

Step 2 only considers rows with `status = 'approved'`. A tutor-created exception starts `pending` and has
no effect on the grid until an admin approves it — it is visible to both the tutor and admins, but a
pending request that blocked bookings would let a tutor unilaterally freeze their own schedule before
anyone reviewed it. Within the approved set, the exception blocks the whole day when `start_time`/
`end_time` are NULL — the existing, unchanged behavior. When they are set, only the overlapping portion of
the day is subtracted, using the same overlap comparison as step 3: `slot.start_time < exception.end_time
AND slot.end_time > exception.start_time`, applied to any date within the exception's
`start_date`–`end_date` range. A mid-day appointment is routine, and an all-or-nothing day flag forces a
tutor to give up a whole day for a one-hour errand.

Step 3 subtracts by **time overlap**, never by start-time equality. A candidate slot is dropped when
`slot.start_time < booking.end_time AND slot.end_time > booking.start_time`.

This matters because `session_length_minutes` is runtime-editable, so the slot grid is not stable over
time — changing it from 60 to 45 re-cuts every future availability range. Stored bookings keep their own
`start_time`/`end_time` and are unaffected, but they end up misaligned with the new grid: a 60-minute
booking at 10:00 straddles both the 09:45–10:30 and the 10:30–11:15 slots. Matching on equality would
find neither and offer both, double-booking the tutor.

---

## Redis — Conversation State

Not part of the relational schema. Redis stores temporary per-user conversation state during an active bot session.

| Key | Value | TTL |
|---|---|---|
| `phone_number` | `{ step, collected_data }` | 30 minutes |

The state is discarded automatically when the TTL expires. If a client goes idle mid-conversation, they start fresh next time they message.