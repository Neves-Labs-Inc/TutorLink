# TutorLink — Requirements

IDs are stable. Phase 1 requirements carry full acceptance criteria because they are being
built now. Later-phase requirements carry a single observable criterion each and will be
expanded when that phase is planned.

`[A]` marks a requirement that rests on an unconfirmed assumption — see `STATE.md`.

---

## Phase 1 — Foundation (walking skeleton)

### REQ-001 — Authoritative repository layout
The repository uses `api/` (FastAPI service), `dashboard/` (React app), `docker/`
(Dockerfiles only), with `docker-compose.yml` and `.env.example` at the root.

Acceptance:
- `api/`, `dashboard/`, `docker/` all exist and contain the artifacts named in REQ-002…011.
- No source file exists outside those three directories and root-level config files.
- Priority: must · Depends: none · Phase: 1

### REQ-002 — FastAPI service boots from environment configuration
The API reads all configuration from environment variables through a single typed
`Settings` object; no configuration value is hardcoded.

Acceptance:
- `Settings` exposes at minimum `database_url`, `redis_url`, `secret_key`, `debug`,
  `twilio_account_sid`, `twilio_auth_token`, `twilio_whatsapp_number`.
- Starting the service with a required variable missing fails at startup with a message
  naming the missing variable, rather than failing later at first use.
- `GET /docs` serves the OpenAPI UI.
- Priority: must · Depends: none · Phase: 1
- **Amended 2026-08-10:** `cors_origins` was removed from the field list above. The
  original criterion read "… `twilio_whatsapp_number`, `cors_origins`." Same-origin
  browser→API traffic is now a confirmed user decision (D-012, OQ-3 resolved), so no CORS
  middleware will ever be configured and the setting would be dead. `01-01-PLAN.md`
  already omitted it and the shipped `api/app/config.py` has no such field; this amendment
  makes the requirement agree with both.

### REQ-003 — PostgreSQL connectivity and request-scoped sessions
The API owns one SQLAlchemy engine and hands out one session per request.

Acceptance:
- A `get_db` FastAPI dependency yields a session and closes it on both success and
  exception paths.
- A declarative `Base` is exported from a single module and is the only declarative base
  in the codebase.
- Priority: must · Depends: REQ-002 · Phase: 1

### REQ-004 — Redis connectivity
The API owns one Redis client, configured from `REDIS_URL`.

Acceptance:
- A module-level client is importable and `PING` succeeds against the compose Redis.
- Priority: must · Depends: REQ-002 · Phase: 1

### REQ-005 — Liveness and readiness endpoints
Acceptance:
- `GET /health` returns 200 `{"status": "ok"}` without touching any dependency.
- `GET /health/ready` executes `SELECT 1` against PostgreSQL and `PING` against Redis and
  returns 200 `{"database": "ok", "redis": "ok"}` when both succeed.
- With Redis stopped, `GET /health/ready` returns 503 and the body names the failing
  dependency. `GET /health` still returns 200.
- Priority: must · Depends: REQ-003, REQ-004 · Phase: 1

### REQ-006 — Full ERD expressed as SQLAlchemy models
All nine tables from `docs/erd.md` exist as SQLAlchemy 2.0 declarative models: `users`,
`parents`, `children`, `subjects`, `tutors`, `tutor_subjects`, `tutor_availability`,
`tutor_availability_exceptions`, `bookings`.

Acceptance:
- Every column, type, nullability, foreign key, unique constraint, and index named in
  `docs/erd.md` is present.
- `user_role` (`admin`, `tutor`) and `booking_status` (`pending`, `confirmed`,
  `cancelled`, `completed`) are native PostgreSQL enums.
- `tutor_subjects.grade_levels` is a PostgreSQL `VARCHAR[]`.
- Relationships are navigable in both directions where the ERD shows a link.
- Priority: must · Depends: REQ-003 · Phase: 1

### REQ-007 — Initial Alembic migration
A single migration creates the entire schema from an empty database.

Acceptance:
- `alembic upgrade head` against an empty database creates all nine tables plus enums,
  constraints, and indexes; `alembic downgrade base` removes them cleanly.
- Running `alembic upgrade head` twice is a no-op the second time.
- `alembic check` (autogenerate diff) reports no pending changes after upgrade — models
  and migration agree.
- Priority: must · Depends: REQ-006 · Phase: 1

### REQ-008 — Double-booking is structurally impossible
The schema prevents two live bookings occupying the same tutor slot.

Acceptance:
- A partial unique index on `bookings (tutor_id, scheduled_date, start_time)` restricted to
  `status IN ('pending','confirmed')` exists after migration.
- Inserting a second `confirmed` booking with the same tutor/date/start time raises a
  database integrity error; inserting one where the first is `cancelled` succeeds.
- Priority: must · Depends: REQ-007 · Phase: 1
- **`[A]` marker dropped 2026-08-12.** Confirmed by the user as D-014 on 2026-08-10; A-2 has
  been a settled decision since then. The index remains a deliberate addition to
  `docs/erd.md`, recorded as spec interpretation — that is a note, not an open assumption.

### REQ-009 — Dashboard application boots with its full runtime wiring
Acceptance:
- `dashboard/` is a Vite + React + TypeScript project; `npm run build` and `npx tsc -b`
  both succeed. **Amended 2026-08-12:** the criterion originally said `tsc --noEmit`. The
  root `dashboard/tsconfig.json` is a solution file with `"files": []`, so `tsc --noEmit`
  type-checks zero files and exits 0 unconditionally — it was satisfied by a tree that did
  not compile at all (`STATE.md` → Blockers → B-1). `tsc -b` is the real gate. The
  constitution's "Testing and done" line was corrected in the same pass.
- React Router v6 serves `/login`, `/dashboard`, `/schedule` and redirects unknown paths.
- A TanStack Query `QueryClientProvider` wraps the app; a Zustand store holds auth and UI
  state (shape defined, values still placeholder).
- A single Axios instance is the only HTTP entry point; its base URL comes from
  `VITE_API_BASE_URL` and defaults to same-origin.
- The Vite dev server proxies `/api` and `/auth` to the API service, so browser requests
  are same-origin. _(`[A]` marker dropped 2026-08-12 — confirmed as D-012 on 2026-08-10.)_
- Priority: must · Depends: none · Phase: 1

### REQ-010 — Responsive app shell and login presentation
Acceptance:
- Tailwind and shadcn/ui are installed and a shared theme token set is defined.
- Admin shell renders a persistent left sidebar at ≥768px and a slide-in hamburger menu
  below it, with the six admin items from `docs/admin-dashboard-design.md`.
- Tutor shell renders a left sidebar at ≥768px and a three-item bottom tab bar below it.
- `/login` renders an email + password form with visible label, focus, disabled, and
  error states. It does not authenticate.
- No horizontal page scroll at 375px width; no unstyled flash of the shell.
- Priority: must · Depends: REQ-009 · Phase: 1

### REQ-011 — One-command local environment
Acceptance:
- `docker compose up` from a clean clone starts `postgres`, `redis`, `api` (port 8000),
  and `dashboard` (port 5173).
- `postgres` and `redis` declare healthchecks; `api` waits for both to be healthy.
- PostgreSQL data survives `docker compose down` (named volume) and is destroyed by
  `docker compose down -v`.
- Backend and frontend source are bind-mounted with hot reload; the dashboard's
  `node_modules` is not shadowed by the bind mount.
- `docker compose run --rm api alembic upgrade head` applies the schema.
- Priority: must · Depends: REQ-005, REQ-007, REQ-009 · Phase: 1

### REQ-012 — Secrets and environment hygiene
Acceptance:
- `.env.example` lists every variable `Settings` requires, with safe placeholder values
  and no real credentials.
- Root `.gitignore` excludes `.env`, `__pycache__/`, `.venv/`, `node_modules/`, `dist/`,
  and `.pytest_cache/`.
- `git status` is clean after a full `docker compose up` and a dashboard build.
- Priority: must · Depends: REQ-002 · Phase: 1

### REQ-013 — Readme matches the repository
Acceptance:
- The "Project Structure" section of `Readme.md` shows `api/`, `dashboard/`, `docker/`,
  `docker-compose.yml`, `.env.example` — not the obsolete `bot/` tree.
- "Local Development" documents the migration command and the ngrok webhook path.
- "Environment Variables" matches `.env.example` exactly.
- No content in `docs/` is modified.
- Priority: should · Depends: REQ-001 · Phase: 1

---

## Phase 2 — Authentication and RBAC

Expanded 2026-08-12 when the phase was planned. The one-line statements are unchanged except
where an amendment is called out; acceptance criteria were added beneath them.

### REQ-020 — `POST /auth/token`
OAuth2 password flow returns `access_token`, `refresh_token`, `token_type: bearer` for valid
credentials; 401 otherwise.

Acceptance:
- Valid credentials → 200 with all three fields, plus a `Set-Cookie` for `refresh_token`
  carrying `HttpOnly`, `SameSite=Lax`, and `Path=/auth`.
- A wrong password, an unknown email, and a deactivated (`is_active = false`) account all
  return 401 with the **same** body and `WWW-Authenticate: Bearer`. The response never
  distinguishes them.
- The request is `application/x-www-form-urlencoded` with `username` and `password` (D-021).
- Priority: must · Depends: REQ-025, REQ-026 · Phase: 2

### REQ-021 — `POST /auth/refresh`
Exchanges a valid refresh token for a fresh access token; rejects expired or malformed tokens
with 401.

Acceptance:
- Reads the token from the `refresh_token` cookie first and falls back to a JSON body
  `{"refresh_token": "..."}` for non-browser clients (D-015). Neither present → 401.
- Success returns a new access token **and a new refresh token** (rotation, D-017), sets a
  fresh cookie, and revokes the presented token.
- An expired, malformed, wrong-type, or unknown token → 401 `{"detail": "Invalid refresh token"}`.
- Priority: must · Depends: REQ-020 · Phase: 2 · _(REQ-02A extends this requirement's
  rotation clause with the revocation store; the dependency runs that way, not both ways)_
- **`[A]` transport marker dropped 2026-08-12.** OQ-4 is resolved and A-4 is settled: cookie
  first, body fallback, both frozen documents remain accurate and neither is amended (D-015).

### REQ-022 — JWT payload
Carries `sub`, `role`, `tutor_id` (null for admins), `exp`.

Acceptance:
- An access token round-trips all four claims, including `tutor_id: null` for an admin.
- **Amended 2026-08-12 (additive):** the token additionally carries `iat`, `jti`, and
  `typ` (`"access"` or `"refresh"`). `typ` is load-bearing — without it a seven-day refresh
  token is a valid access token. Refresh tokens carry `jti`, `fid`, and no `role`, so a role
  change takes effect on the next refresh rather than persisting for the token's life.
  `docs/api-design.md:70-78` shows only the original four; the addition is reported as spec
  interpretation (D-022) and `docs/` is not edited.
- Priority: must · Depends: none · Phase: 2

### REQ-023 — Reusable auth dependency
A reusable auth dependency protects every `/api/*` route; missing or invalid bearer token
returns 401.

Acceptance:
- A single importable dependency turns a bearer token into a typed principal
  (`id`, `email`, `role`, `tutor_id`) and never hands an ORM object to a route.
- Missing, malformed, expired, wrong-`typ`, unknown-user, and inactive-user requests all
  return 401 with one message and `WWW-Authenticate: Bearer`.
- Priority: must · Depends: REQ-022 · Phase: 2

### REQ-024 — RBAC matrix enforced
The matrix at `docs/api-design.md:95-107` is enforced: tutors are read-only and scoped to
their own `tutor_id`; cross-tutor or admin-only access returns 403.

Acceptance:
- An admin-only dependency returns 403 for a tutor principal and 401 (not 403) when no token
  is present.
- A scoping helper resolves a requested `tutor_id` against the principal: an admin passes
  through unchanged; a tutor supplying nothing is **forced** to their own id; a tutor
  supplying another tutor's id gets **403 — never 404 and never an empty 200**; a tutor whose
  `users.tutor_id` is null gets 403.
- Priority: must · Depends: REQ-023 · Phase: 2
- **Scope clarified 2026-08-12.** Phase 2 contains **zero `/api/*` endpoints** — Phase 1
  shipped none and Phase 2 adds none — so "enforced" cannot be observed on a real route in
  this phase. Phase 2's obligation is to deliver and prove the enforcement **primitives**,
  exercised end-to-end through probe routes that live inside the test module and are never
  mounted on the application. Applying them to real endpoints is a standing obligation on
  Phases 3, 4, and 6, and REQ-063 is the end-to-end network-layer proof. The original
  sentence stands unchanged; this note records what satisfying it means in Phase 2.

### REQ-025 — Password storage
Passwords are bcrypt-hashed; plaintext never persists or appears in logs.

Acceptance:
- `users.hashed_password` holds a bcrypt hash; two hashes of the same password differ and
  both verify.
- A password whose UTF-8 encoding exceeds 72 bytes is **rejected**, never silently truncated
  (bcrypt truncates, which would make two different long passwords interchangeable).
- No password, hash, or token appears in any log line, error body, or CLI output.
- Priority: must · Depends: none · Phase: 2

### REQ-026 — First admin seed command
A seed command creates the first admin account so the system is loginable.

Acceptance:
- `docker compose run --rm api python -m app.cli seed-admin` creates one admin from
  `TUTORLINK_ADMIN_EMAIL` / `TUTORLINK_ADMIN_PASSWORD`, prompting interactively when either
  is absent and stdin is a TTY.
- **Idempotent:** re-running creates no duplicate, does not reset the password, and exits 0.
- **No public setup, registration, or bootstrap endpoint exists — not now, not ever** (D-018).
- Priority: must · Depends: REQ-025 · Phase: 2

### REQ-027 — Dashboard login
Access token held in memory, refresh token in an HttpOnly cookie, silent refresh on 401,
redirect to `/dashboard` (admin) or `/schedule` (tutor).

Acceptance:
- No token in `localStorage`, `sessionStorage`, or any persisted store.
- A 401 on an `/api/*` call transparently refreshes once and replays the request; a second
  401 clears the session instead of looping.
- Reloading the page keeps the user signed in via exactly **one** `POST /auth/refresh`.
- Logout clears the client session and the query cache, and the refresh token fails
  server-side afterwards.
- Priority: must · Depends: REQ-020, REQ-021 · Phase: 2

### REQ-028 — Dashboard route guards
Unauthenticated → `/login`; tutor on an admin route → `/schedule`.

Acceptance:
- Both hold **in the dev server**, not only in a production build — the Phase 1 dev bypass is
  gone (D-013 / D-019), and `grep -rn "import.meta.env.DEV" dashboard/src` is empty.
- The guard does not redirect while the session bootstrap is still in flight.
- Priority: must · Depends: REQ-027 · Phase: 2

### REQ-029 — Uniform error envelope
`{"detail": ...}` with the documented status codes.

Acceptance:
- Every error body is a JSON object whose `detail` is a **string**.
- Validation failures return **400**, not FastAPI's default 422 — `docs/api-design.md:637-644`
  lists 400 for validation and does not list 422 at all (D-024).
- Status codes are drawn only from 400 · 401 · 403 · 404 · 409.
- Priority: must · Depends: none · Phase: 2

### REQ-02A — Refresh tokens rotate and are revocable server-side
**New 2026-08-12. This is a scope addition beyond REQ-020 … REQ-029, made on an explicit
user decision (D-017) that chose server-side revocation over the stateless default the phase
stub proposed.** Every issued refresh token is tracked in the database; each use rotates it
and invalidates the presented one; logout and forced session termination take effect
immediately rather than after the token's seven-day lifetime.

Acceptance:
- A `refresh_tokens` table exists, created by an Alembic migration, holding one row per
  issued token: its `jti`, owning user, `family_id`, issue and expiry timestamps, a nullable
  `revoked_at`, and a `replaced_by_id` rotation link. **No token string and no hash of one is
  ever stored** — the row answers "is this jti still live?" and nothing else.
- `POST /auth/refresh` with a live token returns a new pair, marks the presented row revoked,
  and links it to its replacement.
- **Reuse of an already-rotated refresh token returns 401 and revokes the entire family**, so
  the token issued by the legitimate rotation also stops working and both parties must log in
  again. The response is byte-identical to any other invalid-token 401; detection is never
  disclosed.
- `POST /auth/logout` revokes the presented token's family and returns 204 in every case,
  including with no token, an expired token, or a garbage token.
- Two independent logins produce two independent families: revoking one leaves the other
  usable.
- Priority: must · Depends: REQ-021 · Phase: 2

**On the ID.** The Phase 2 decade `REQ-020 … REQ-029` was fully allocated, and IDs already in
use are never renumbered. `REQ-02A` extends the Phase 2 block without disturbing a single
existing identifier. It is the only alphanumeric ID in this document; if more Phase 2
requirements ever appear they continue `REQ-02B`, `REQ-02C`.

**Two endpoint-level consequences, both reported as spec drift and neither patched into
`docs/`** (assumption A-6):
- `POST /auth/logout` does not appear in `docs/api-design.md`. It is introduced here, because
  a revocation store no client can trigger is decoration.
- `POST /auth/refresh` returns `refresh_token` in its body in addition to the documented
  `access_token` and `token_type` (`docs/api-design.md:57-63`). Rotation issues a new refresh
  token, and a non-browser client that cannot see the cookie must receive it somewhere. The
  addition is purely additive and breaks no documented client.

## Phase 3 — Core CRUD API

- **REQ-030** Users: `GET/POST /api/users`, `GET/PATCH/DELETE /api/users/{id}`; DELETE is
  a soft delete; admin only.
- **REQ-031** Subjects: `GET/POST /api/subjects`, `PATCH/DELETE /api/subjects/{id}`;
  unique name; soft delete; readable by tutors, writable by admins only.
- **REQ-032** Clients: `GET /api/clients` (with `is_active` filter), `GET /api/clients/{id}`
  (includes children), `POST /api/clients`, `PATCH /api/clients/{id}`.
- **REQ-033** `GET /api/clients/{id}/bookings` with `status` and `from` filters, spanning
  all of that parent's children.
- **REQ-034** Children: `POST /api/children`, `PATCH /api/children/{id}`.
- **REQ-035** Tutors: `GET/POST /api/tutors`, `GET/PATCH/DELETE /api/tutors/{id}`, with
  `subject_id` and `grade_level` filtering and embedded subjects in the response.
- **REQ-036** Tutor subjects: `POST /api/tutors/{id}/subjects`,
  `DELETE /api/tutors/{id}/subjects/{subject_id}`, unique per (tutor, subject).

## Phase 4 — Scheduling engine

- **REQ-040** Availability: `GET/POST /api/tutors/{id}/availability`,
  `PATCH/DELETE /api/availability/{id}`; unique per (tutor, day, start_time).
- **REQ-041** Exceptions: `GET/POST /api/tutors/{id}/exceptions`,
  `DELETE /api/exceptions/{id}`; a single day off has `start_date == end_date`.
- **REQ-042** `GET /api/slots/available` runs the documented three-step query (recurring
  slots for the weekday, minus exception ranges, minus pending/confirmed bookings),
  filtered by `subject_id`, `grade_level`, `date`, optional `tutor_id`. `[A]` slot
  granularity — see OQ-5.
- **REQ-043** `/api/slots/available` returns at most 5 slots, ordered by start time.
- **REQ-044** Bookings: `GET /api/bookings` with `status`/`tutor_id`/`from`/`to` filters,
  `GET /api/bookings/{id}` including parent address, `POST /api/bookings`,
  `PATCH /api/bookings/{id}` for status transitions.
- **REQ-045** A booking request for an already-taken slot returns 409, including under
  concurrent submission (enforced by REQ-008's index, not by a read-then-write check).

## Phase 5 — Admin dashboard views

- **REQ-050** `/dashboard`: today's sessions, upcoming this week, active tutor count,
  active client count, last five bookings.
- **REQ-051** `/tutors` list with name search and subject/status filters, plus an
  "Add Tutor" slide-over form.
- **REQ-052** `/tutors/{id}` detail: profile, subjects, weekly availability grid,
  exceptions, recent bookings, with the four documented forms.
- **REQ-053** `/clients` list with name/phone search and `/clients/{id}` detail showing
  children and cross-child booking history.
- **REQ-054** `/bookings` table with date-range/tutor/subject/status filters, colour-coded
  status badges, a detail slide-over, and manual booking creation.
- **REQ-055** `/subjects` list with tutor counts and add/edit forms.
- **REQ-056** `/users` list with add/edit forms including the conditional tutor link.
- **REQ-057** Shared components: `DataTable`, `SlideOver`, `StatusBadge`, `ConfirmDialog`.
- **REQ-058** Responsive behaviour matches the documented desktop/mobile table: slide-over
  becomes full-screen modal, tables scroll or become cards.

## Phase 6 — Tutor dashboard views

- **REQ-060** `/schedule`: read-only weekly grid with exception dates blocked out.
- **REQ-061** `/sessions`: upcoming and past tabs with child name search, date filter, and
  address plus tap-to-reveal access code on mobile cards.
- **REQ-062** `/time-off`: read-only exception history with the admin-contact prompt.
- **REQ-063** A tutor session can load no data belonging to another tutor, verified at the
  network layer, not only by hidden UI.

## Phase 7 — WhatsApp bot

- **REQ-070** `POST /webhook/whatsapp` accepts Twilio's form-encoded payload and replies
  with TwiML.
- **REQ-071** `X-Twilio-Signature` is validated before any side effect; invalid or missing
  signature returns 403.
- **REQ-072** Conversation state lives in Redis keyed by phone number as
  `{step, collected_data}` with a 30-minute TTL and no long-term persistence.
- **REQ-073** New-client intake: parent name → address + access code → child info, looping
  for multiple children.
- **REQ-074** Per-child booking: subject → tutor → preferred day/time → offered slots →
  confirmation, writing a booking and sending a confirmation message.
- **REQ-075** Returning clients are recognised by phone number and can book, cancel, or
  reschedule.
- **REQ-076** A message arriving after TTL expiry restarts cleanly rather than erroring.

## Phase 8 — Deployment

- **REQ-080** The stack deploys to a single EC2 instance via Compose with a production
  compose overlay (no bind mounts, no `--reload`, built dashboard served statically).
- **REQ-081** Switching `DATABASE_URL`/`REDIS_URL` to RDS and ElastiCache requires no code
  change.
- **REQ-082** The production webhook URL is reachable over HTTPS and registered in Twilio.

---

## Traceability

| Phase | Requirements |
|---|---|
| 1 — Foundation | REQ-001 … REQ-013 |
| 2 — Auth & RBAC | REQ-020 … REQ-029, **REQ-02A** |
| 3 — Core CRUD API | REQ-030 … REQ-036 |
| 4 — Scheduling engine | REQ-040 … REQ-045 |
| 5 — Admin dashboard | REQ-050 … REQ-058 |
| 6 — Tutor dashboard | REQ-060 … REQ-063 |
| 7 — WhatsApp bot | REQ-070 … REQ-076 |
| 8 — Deployment | REQ-080 … REQ-082 |

Phase 1 task coverage:

| REQ | Task |
|---|---|
| REQ-001 | T1.1, T2.1, T3.1 (layout realised by all three) |
| REQ-002 | T1.1 |
| REQ-003 | T1.1 |
| REQ-004 | T1.1 |
| REQ-005 | T1.1 |
| REQ-006 | T1.2 |
| REQ-007 | T1.2 |
| REQ-008 | T1.2 |
| REQ-009 | T2.1 |
| REQ-010 | T2.2 |
| REQ-011 | T3.1 |
| REQ-012 | T3.1 |
| REQ-013 | T3.2 |

Phase 2 task coverage (task IDs are `P2-` prefixed to avoid collision with Phase 1's):

| REQ | Task(s) | Plan |
|---|---|---|
| REQ-020 | P2-T2.1, P2-T3.1 | 02-02, 02-03 |
| REQ-021 | P2-T2.1, P2-T3.1 | 02-02, 02-03 |
| REQ-022 | P2-T1.1 | 02-01 |
| REQ-023 | P2-T2.2 | 02-02 |
| REQ-024 | P2-T2.2 (+ P2-T1.3 harness) | 02-02, 02-01 |
| REQ-025 | P2-T1.1, P2-T2.1, P2-T3.2 | 02-01, 02-02, 02-03 |
| REQ-026 | P2-T3.2 | 02-03 |
| REQ-027 | P2-T4.1, P2-T4.2, P2-T5.2 | 02-04, 02-05 |
| REQ-028 | P2-T5.1 | 02-05 |
| REQ-029 | P2-T3.1 | 02-03 |
| REQ-02A | P2-T1.2, P2-T2.1, P2-T3.1, P2-T5.2 (+ P2-T1.3 harness) | 02-01, 02-02, 02-03, 02-05 |

`P2-T1.3` (the live-database pytest harness) ships no product behaviour. It is cited against
REQ-024 and REQ-02A because their acceptance criteria are database assertions that cannot be
made without it, and it is a separate task because three downstream tasks depend on it.

D-013's removal obligation is discharged by **P2-T5.1** and is gated by an explicit grep in
that task's acceptance criteria. It is not a requirement, so it appears in no row above; a
Phase 2 that closes without it is drift regardless of REQ coverage.
