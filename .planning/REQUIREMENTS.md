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

### REQ-008 — Double-booking is structurally impossible `[A]`
The schema prevents two live bookings occupying the same tutor slot.

Acceptance:
- A partial unique index on `bookings (tutor_id, scheduled_date, start_time)` restricted to
  `status IN ('pending','confirmed')` exists after migration.
- Inserting a second `confirmed` booking with the same tutor/date/start time raises a
  database integrity error; inserting one where the first is `cancelled` succeeds.
- Priority: must · Depends: REQ-007 · Phase: 1
- Assumption: this index is an addition to `docs/erd.md`, not something it specifies.

### REQ-009 — Dashboard application boots with its full runtime wiring
Acceptance:
- `dashboard/` is a Vite + React + TypeScript project; `npm run build` and `tsc --noEmit`
  both succeed.
- React Router v6 serves `/login`, `/dashboard`, `/schedule` and redirects unknown paths.
- A TanStack Query `QueryClientProvider` wraps the app; a Zustand store holds auth and UI
  state (shape defined, values still placeholder).
- A single Axios instance is the only HTTP entry point; its base URL comes from
  `VITE_API_BASE_URL` and defaults to same-origin.
- The Vite dev server proxies `/api` and `/auth` to the API service, so browser requests
  are same-origin. `[A]`
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

- **REQ-020** `POST /auth/token` — OAuth2 password flow returns `access_token`,
  `refresh_token`, `token_type: bearer` for valid credentials; 401 otherwise.
- **REQ-021** `POST /auth/refresh` — exchanges a valid refresh token for a fresh access
  token; rejects expired or malformed tokens with 401. `[A]` transport (cookie vs body).
- **REQ-022** JWT payload carries `sub`, `role`, `tutor_id` (null for admins), `exp`.
- **REQ-023** A reusable auth dependency protects every `/api/*` route; missing or invalid
  bearer token returns 401.
- **REQ-024** RBAC matrix from `docs/api-design.md` is enforced: tutors are read-only and
  scoped to their own `tutor_id`; cross-tutor or admin-only access returns 403.
- **REQ-025** Passwords are bcrypt-hashed; plaintext never persists or appears in logs.
- **REQ-026** A seed command creates the first admin account so the system is loginable.
- **REQ-027** Dashboard login: access token held in memory, refresh token in an HttpOnly
  cookie, silent refresh on 401, redirect to `/dashboard` (admin) or `/schedule` (tutor).
- **REQ-028** Dashboard route guards: unauthenticated → `/login`; tutor on an admin route
  → `/schedule`.
- **REQ-029** Uniform error envelope `{"detail": ...}` with the documented status codes.

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
| 2 — Auth & RBAC | REQ-020 … REQ-029 |
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
