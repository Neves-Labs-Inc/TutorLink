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

### `parents`
Stores parent/guardian information. Identified by phone number, which is used by the bot to recognise returning clients.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| phone_number | VARCHAR | Unique — used to identify returning clients |
| name | VARCHAR | Parent/guardian full name |
| address | TEXT | Home address where tutoring takes place |
| access_code | VARCHAR | Neighbourhood or building access code |
| is_active | BOOLEAN | Soft delete flag |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

Constraints: `UNIQUE (phone_number)` · `INDEX (phone_number)`

---

### `children`
Each parent can have one or more children. The bot collects child info during intake and loops until all children are registered.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| parent_id | UUID | FK → parents.id |
| name | VARCHAR | Child's full name |
| age | INT | Age at time of registration |
| grade_level | VARCHAR | e.g. Grade 7, High School Year 2 |
| school_name | VARCHAR | School the child attends |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

Constraints: `INDEX (parent_id)`

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
Junction table linking tutors to the subjects they can teach, with the grade levels they cover per subject.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| tutor_id | UUID | FK → tutors.id |
| subject_id | UUID | FK → subjects.id |
| grade_levels | VARCHAR[] | Array of grade levels, e.g. ["Grade 6", "Grade 7"] |

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
| reason | VARCHAR | vacation, personal, sick, other |
| notes | TEXT | Optional admin notes |
| created_at | TIMESTAMPTZ | |

Constraints: `INDEX (tutor_id, start_date, end_date)`

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
| scheduled_date | DATE | The actual date of the session |
| start_time | TIME | Session start time |
| end_time | TIME | Session end time |
| status | ENUM | pending, confirmed, cancelled, completed |
| notes | TEXT | Optional notes from client or admin |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

Constraints: `INDEX (child_id, tutor_id, subject_id, scheduled_date, status)`

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
parents ──────────< children >──────────< bookings
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

1. Fetch recurring slots from `tutor_availability` matching the requested day of week
2. Subtract any slots where the requested date falls within a `tutor_availability_exceptions` range (`start_date <= requested_date <= end_date`)
3. Subtract slots already taken in `bookings` where `scheduled_date = requested_date` and `status IN (pending, confirmed)`
4. Return remaining open slots to the client

---

## Redis — Conversation State

Not part of the relational schema. Redis stores temporary per-user conversation state during an active bot session.

| Key | Value | TTL |
|---|---|---|
| `phone_number` | `{ step, collected_data }` | 30 minutes |

The state is discarded automatically when the TTL expires. If a client goes idle mid-conversation, they start fresh next time they message.