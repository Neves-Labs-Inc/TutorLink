# TutorLink — Entity Relationship Diagram

## Overview

TutorLink uses a PostgreSQL relational database as the single source of truth for all business data.

---

## Tables

### `users`
Login accounts for the admin dashboard. Supports three roles: `developer` (everything an admin has, plus developer-only settings fields), `admin` (full access) and `tutor` (own schedule only). Tutor accounts are linked to a row in the `tutors` table.

`developer` is a superset of `admin` rather than a parallel role — every gate asks "admin or above" rather than "is admin". An admin may not create a `developer` nor promote anyone to one, including themselves, so the first account is created by a CLI command rather than over HTTP.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| email | VARCHAR | Unique — used as login username |
| hashed_password | VARCHAR | Bcrypt hashed |
| role | ENUM | developer, admin, tutor |
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
A child belongs to one or more guardians, through `child_guardians`, and is tutored at one or more homes, through `child_homes`. Neither is derivable from the other. The bot collects child info during intake — name, date of birth, grade, school and optional notes — and loops until all children are registered. The admin dashboard collects the same fields.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| name | VARCHAR | Child's full name |
| date_of_birth | DATE | nullable — required on every write; NULL only on rows registered before age was replaced (migration 0015) |
| grade_level | INT | The child's grade, as a number — 7, not "Grade 7" |
| school_name | VARCHAR | School the child attends |
| notes | TEXT | nullable — learning needs, allergies, anything the office should know. Admins, and the assigned tutor on the session detail |
| is_active | BOOLEAN | Soft delete flag — default true (migration 0016) |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

Constraints: none beyond the primary key — the guardian and home links live in their own tables

`age` was dropped in favour of `date_of_birth` because an age at registration is wrong a year
later. It could not be converted: rows registered before the change keep a NULL
`date_of_birth` rather than an invented one, and an admin fills it in. A child's current age is
derived for display and never stored.

`notes` is visible to admins and, on the session detail only, to the tutor assigned to that
session. No other response a tutor can reach carries it, and none carries `date_of_birth`. It is
never sent back to the model that parses WhatsApp messages once it has been collected.

A child who stops tutoring is deactivated, not deleted: its `child_guardians`, `child_homes` and
bookings stay. Deactivating a child cancels its upcoming `pending`/`confirmed` sessions in the
same change, and nobody is notified. An inactive child cannot be booked; the dashboard
reactivates it first. An inactive child is not offered for booking by the bot; a guardian can ask
for it to be reactivated, and an admin decides.

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

Constraints: `CHECK ((start_time IS NULL) = (end_time IS NULL))` · `CHECK (start_time IS NULL OR end_time > start_time)` · `CHECK (end_date >= start_date)` · `INDEX (tutor_id, start_date, end_date)`

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

Constraints: `CHECK (end_time > start_time)` (`ck_bookings_time_order`) · `EXCLUDE USING gist excl_bookings_live_overlap (tutor_id WITH =, tsrange(scheduled_date + start_time, scheduled_date + end_time) WITH &&) WHERE (status IN (pending, confirmed))` · `INDEX (child_id, tutor_id, subject_id, scheduled_date, status)` · `INDEX (home_id)`

`ck_bookings_time_order` is what makes the exclusion constraint sound and is not redundant with it. An empty or inverted `tsrange` overlaps nothing, so without the check an inverted booking is invisible to `excl_bookings_live_overlap` and double-books the tutor silently. A schema reproduced from this table without it is not equivalent.

---

### `conversations`
One row per WhatsApp identity, created on the first inbound message. Holds who is answering the client right now — the bot, or an admin who has taken over.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| phone_number | VARCHAR | Unique — the WhatsApp identity |
| guardian_id | UUID | FK → guardians.id, nullable — linked once intake creates the guardian |
| status | ENUM `conversation_status` | `bot`, `human`. NOT NULL, default `bot` — who is answering right now |
| taken_over_by_user_id | UUID | FK → users.id, nullable |
| taken_over_at | TIMESTAMPTZ | nullable |
| last_message_at | TIMESTAMPTZ | Ordering the conversation list |
| last_read_at | TIMESTAMPTZ | nullable — shared admin-side read watermark |
| flag_reason | ENUM `flag_reason` | nullable — `stuck`, `parse_error`, `guardian_link_request`, `reactivation_request` |
| flagged_at | TIMESTAMPTZ | nullable |
| reactivation_child_id | UUID | FK → children.id, nullable |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

Constraints: `UNIQUE (phone_number)` · `CHECK ((status = 'human') = (taken_over_by_user_id IS NOT NULL))` · `INDEX (guardian_id)` · `INDEX (last_message_at DESC)`

The row is keyed on `phone_number` rather than on `guardian_id` because the bot is already talking
before a guardian exists — intake collects the name several messages in. A conversation that could not
exist until intake succeeded would lose exactly the conversations an admin most wants to read: the ones
that stalled part-way through it. `guardian_id` is backfilled when the guardian row is created and stays
NULL otherwise, which is why the conversation list has to be able to render a bare phone number.

A thread follows the guardian who owns it (#126, reversing D-L / #55's "never rewritten"). When an admin
changes a guardian's number from N to M on the client screen, the guardian's thread at N is re-keyed to M
with all its state, and a Staff-only `number_change_note` message ("Number changed from N to M by <Staff>")
records where the earlier messages went; it is never sent. N is left with no thread, so whoever writes from
N next opens a fresh one and is recognised by the number alone — a thread left behind at N would hand its
`guardian_id` to the number's next holder. WhatsApp's 24-hour window counts only client messages after the
latest `number_change_note`. A thread already at M (unlinked, or linked to this guardian) gives its messages
to the guardian's thread and is deleted; the guardian's thread keeps all its own state. With no thread at N,
the one at M becomes the guardian's. A thread at M linked to another guardian (only data from before this
rule) refuses the change with 409. Creating a guardian links an unlinked thread already at their number.
`INDEX (guardian_id)` is still not unique: threads from before this rule can share a guardian.

`last_read_at` is a single watermark shared by every admin rather than one per admin. This is a shared
inbox for a small team, and a takeover is already a shared act — one admin claims a conversation and any
other can see it is claimed. A per-admin junction table would buy per-person unread counts that nobody
has asked for, at the cost of a second table on the read path of the list screen.

The CHECK ties the two halves of the takeover state together, so `human` with no holder, and a holder
with the bot still running, are both unrepresentable rather than merely discouraged. This is the same
reasoning as the paired NULL check on `tutor_availability_exceptions`: a state that has no coherent
meaning should be rejected by the database, not left for the application to remember to avoid.

`flag_reason` and `flagged_at` are set when the bot gives up rather than when it hands off — `status`
already says who is answering, and `flag_reason` says why an admin needs to look, which is a different
question with a different answer. `stuck` is two failed re-prompts in a row with no usable reply from
the client; `parse_error` is the parser itself failing rather than the client's message being unclear,
flagged immediately rather than burning a re-prompt on an outage that is not the client's fault; and
`guardian_link_request` is not a failure at all — the bot worked, understood a second guardian asking to
be linked to an existing child, and stopped because phone-alone identity cannot tell a real second
guardian from anyone who knows a child's name. Keeping `flag_reason` off `status` rather than merging the
two preserves a distinction an admin needs: a `bot` conversation can be flagged and unattended, and a
`human` conversation someone has already taken over can carry a flag from before the takeover. Collapsing
them into one column would lose whichever half is not currently true. There is no flag value for a
reschedule or cancellation declined inside `cancellation_cutoff_hours` — that is a policy refusal, not a
bot failure, and flagging it would bury the flags that mean the bot needs help.

A pending reactivation request is the `reactivation_child_id` column, not the flag: a later flag
cannot erase it. Approve/Deny clear the column and clear the flag only if it is still
`reactivation_request`. An admin clears a flag by marking the conversation handled, and only if the
flag is still the one they saw — the request carries its `flagged_at`, which every new flag
re-stamps. A `reactivation_request` flag is ended only by approving or denying the request.
`reactivation_child_id` is never set on an unflagged conversation: clearing another reason while a
request is pending puts the flag back to `reactivation_request`.

---

### `messages`
Every message in a conversation — what the client sent, what the bot replied, and what an admin typed while holding the conversation.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| conversation_id | UUID | FK → conversations.id |
| author_kind | ENUM `message_author` | `client`, `bot`, `admin` |
| author_user_id | UUID | FK → users.id, nullable — set only when `author_kind = 'admin'` |
| body | TEXT | Message text as sent or received |
| twilio_sid | VARCHAR | nullable, unique — Twilio's message SID |
| status | ENUM `message_status` | `received`, `queued`, `sent`, `delivered`, `failed` |
| error_code | VARCHAR | nullable — Twilio's error code on `failed` |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | Moves only when the delivery callback advances `status` |

Constraints: `UNIQUE (twilio_sid)` · `CHECK ((author_kind = 'admin') = (author_user_id IS NOT NULL))` · `INDEX (conversation_id, created_at)`

There is deliberately no `direction` column. Inbound and outbound are already derivable from
`author_kind` — `client` is inbound, `bot` and `admin` are outbound — and storing both would create two
facts that can disagree, with nothing in the schema to say which one is right.

`twilio_sid` is unique because Twilio retries a webhook whose delivery it believes failed, and the same
message can therefore arrive more than once. The insert is the idempotency key: a retry of an
already-recorded message conflicts on the unique index and is discarded, rather than appearing twice in
the thread an admin is reading.

An inbound message is written `received` and never changes state again — it has already arrived, and
there is nothing further to report about it. An outbound message sent through Twilio's REST API — an
admin's reply, typed on the socket — starts `queued` and is advanced by Twilio's delivery status
callback, which is also what records `error_code` when the send ultimately fails. A bot reply is
outbound too, but it is returned as TwiML in the webhook's own response rather than sent through the
REST API, and Twilio does not mint a `MessageSid` for it until after it has read that response — so at
the moment the row is written there is no SID for a later callback to match against. A bot reply is
therefore recorded `status = 'sent'` with `twilio_sid` NULL: it has already left, and there is nothing
`POST /webhook/whatsapp/status` could advance it to.

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
| chat_retention_days | 365 | no |
| login_rate_limit_ip_max_attempts | 20 | no |
| login_rate_limit_ip_window_seconds | 900 | no |
| login_rate_limit_email_max_attempts | 5 | no |
| login_rate_limit_email_window_seconds | 900 | no |
| retention_purge_hour_utc | 3 | no |

`chat_retention_days` is how long a message is kept. A nightly job deletes `messages` older than the
window, and a `conversations` row left with no surviving messages goes with them rather than lingering as
an empty thread in the list. A value of `0` means never purge, which is the setting a client on a
records-retention obligation will want.

`retention_purge_hour_utc` is the UTC hour, 0–23, at which that nightly job runs. The job runs inside
the API process, ticks at the top of every hour, and reads this row at each tick, so a changed hour
takes effect the same day without a restart. When more than one API task is running, a PostgreSQL
advisory lock lets exactly one of them purge; the others log that they skipped. The same run reaps
expired `bot_flow_state` and `login_attempts` rows.

It is a setting rather than a constant for the same reason `session_gap_minutes` is: the answer is a
business policy, it differs from one client to the next, and it changes for reasons that have nothing to
do with a release. Hard-coding it would make a legal or contractual decision into a deploy.

The four `login_rate_limit_*` rows are the thresholds for the brute-force limiter on `POST /auth/token`
(#3, OQ-7): two independent sliding windows, one keyed on the caller's address and one on the submitted
email, each with its own maximum and window. They are rows for the same reason — the right numbers depend
on how a client's staff actually sign in, a shared office address behind one NAT looks like an attacker to
a limit tuned for a home connection, and discovering that during an incident must not require a deploy. A
`max_attempts` of `0` disables that bucket; both at `0` turns the limiter off. That is an integer rather
than a boolean because `integer` is the only `value_type` in use, and adding one to express "off" would be
a schema change to say what `0` already says. `POST /auth/token` is the only reader of these, and the only
reader of `system_settings` at all today — see `docs/api-design.md`.

### `bot_flow_state`
The live flow state of a bot session in progress — which step the bot is on and what it has collected so far. One row per phone number with a flow under way.

| Column | Type | Notes |
|---|---|---|
| phone_number | VARCHAR(32) | Primary key — same type as `conversations.phone_number`; deliberately **no FK** |
| step | TEXT | The flow step the bot is waiting on |
| collected_data | JSONB | Answers gathered so far |
| misses | INTEGER | Consecutive unusable answers in the current step |
| prompt | TEXT | The last question asked, for a re-prompt |
| expires_at | TIMESTAMPTZ | 30 minutes after the last write |

A missing row and an expired row read the same: a fresh start. If a client goes idle mid-conversation,
they start fresh next time they message. Expired rows are reaped by the nightly retention purge; there
is no index on `expires_at` because the table only ever holds live flows.

This table is not the record of the conversation, and the division is worth stating. `bot_flow_state`
answers "where is this client up to in the flow right now", holds nothing once the flow ends, and is
safe to lose — losing it costs a client one restarted intake. [`conversations`](#conversations) and
[`messages`](#messages) answer "what was said, by whom, when, and did it get delivered", are the source
of truth for the admin chat screens, and are retained for `chat_retention_days`. Nothing is written to
both, which is why there is no foreign key between them.

A takeover touches `bot_flow_state` not at all. Flow state keeps its 30-minute expiry and will usually
expire during a handoff of any length, so when the admin releases the conversation the client resumes
from a fresh state — the same behaviour as any other client who went idle. Freezing the expiry for the
duration of a handoff was the alternative, and it is worse: it would restore a half-finished intake
that the admin has by then completed by hand, and the bot would ask again for answers the client has
already given.

### `login_attempts`
The counting store behind the `POST /auth/token` brute-force limiter. One row per reserved attempt per bucket.

| Column | Type | Notes |
|---|---|---|
| bucket_key | TEXT | Primary key part 1 — e.g. `ratelimit:login:ip:203.0.113.7`, `ratelimit:login:email:<email>` |
| attempt_id | UUID | Primary key part 2 — one per request, shared by every bucket that request reserved |
| attempted_at | TIMESTAMPTZ | Written by the application, not defaulted |

Constraints: `PRIMARY KEY (bucket_key, attempt_id)`. Index: `(bucket_key, attempted_at)`.

A bucket's count is its rows inside the window. Rows older than the window are pruned on every touch of
their bucket and reaped by the nightly retention purge. Concurrent attempts on the same bucket are
serialized with a transaction-scoped advisory lock on the bucket key, so the count a request reads is
the count it reserves against. Like `bot_flow_state`, this is not a system of record.

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

guardians ──< conversations ──< messages
                   │                │
users ─────────────┴────────────────┘
```

`users` appears twice: once as the tutor login account, and once against the chat tables, where it names
the admin holding a conversation (`conversations.taken_over_by_user_id`) and the admin who typed a
particular message (`messages.author_user_id`). Both links from `users` are nullable — a conversation the
bot is still handling has no holder, and a client or bot message has no author account.

---

## Availability Query Logic

When a client requests a slot, the bot runs three checks in sequence:

1. Fetch recurring ranges from `tutor_availability` with `is_active = true` matching the requested day of week, and cut each into a grid of candidate slots
2. Subtract slots blocked by a `tutor_availability_exceptions` range with `status = 'approved'` covering the requested date (`start_date <= requested_date <= end_date`) — the whole day when `start_time`/`end_time` are NULL, or by time overlap when they are set. `pending` and `rejected` rows are ignored entirely
3. Subtract slots already taken in `bookings` where `scheduled_date = requested_date` and `status IN (pending, confirmed)`, widening each booking by `session_gap_minutes` on both sides before comparing
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

Step 1 also takes only rows with `is_active = true`. Deactivating a recurring slot is a soft delete, so the
row is still there afterwards, and a query that treated a withdrawn slot as absent would keep cutting a grid
out of it. Rule 1 of `POST /api/bookings` requires an **active** range, so leaving the filter out would have
the bot offering slots the write path refuses — the same trap step 2's `status` filter avoids, for the same
reason: the row existing is not enough.

Step 2 only considers rows with `status = 'approved'`. A tutor-created exception starts `pending` and has
no effect on the grid until an admin approves it — it is visible to both the tutor and admins, but a
pending request that blocked bookings would let a tutor unilaterally freeze their own schedule before
anyone reviewed it. Within the approved set, the exception blocks the whole day when `start_time`/
`end_time` are NULL — the existing, unchanged behavior. When they are set, only the overlapping portion of
the day is subtracted, by bare overlap — `slot.start_time < exception.end_time AND slot.end_time >
exception.start_time`, applied to any date within the exception's `start_date`–`end_date` range. Bare, not
gap-expanded like step 3, because rule 4 of `POST /api/bookings` blocks on bare overlap with an exception
too, and the offer surface must not read the same rows differently from the write path. A mid-day
appointment is routine, and an all-or-nothing day flag forces a tutor to give up a whole day for a one-hour
errand.

Step 3 subtracts by **time overlap**, widened by `session_gap_minutes` on both sides, never by start-time
equality. A candidate slot is dropped when `slot.start_time < booking.end_time + gap AND
slot.end_time + gap > booking.start_time`.

This matters because `session_length_minutes` is runtime-editable, so the slot grid is not stable over
time — changing it from 60 to 45 re-cuts every future availability range. Stored bookings keep their own
`start_time`/`end_time` and are unaffected, but they end up misaligned with the new grid: a 60-minute
booking at 10:00 straddles both the 09:45–10:30 and the 10:30–11:15 slots. Matching on equality would
find neither and offer both, double-booking the tutor.
