# Phase 1 — Foundation · Summary

**Goal:** a runnable walking skeleton — four services up via Compose, the full schema
migrated, the dashboard shell rendering.

**Status:** gate run and passing, **one requirement outstanding**. `verifier` returned PASS
over the combined result. REQ-010 could not be verified because it is browser-only and
`qa-visual` is blocked on a user action. The phase is substantially, not fully, closed.

**Commit:** none. `HEAD` is still `2ae9bcc` and the entire phase sits uncommitted in the
working tree, deliberately, pending user authorisation.

---

## What shipped

### Backend — `api/`

- `app/config.py` — pydantic-settings `Settings` with `database_url`, `redis_url`,
  `secret_key`, `debug`, and the three optional Twilio fields; `get_settings()` is
  `lru_cache`d. No fallback defaults for the three required fields, so a missing variable
  fails at construction naming the field.
- `app/db.py` — the single `Base(DeclarativeBase)`, one engine with `pool_pre_ping`,
  `SessionLocal`, the `get_db()` generator dependency, and `check_database()`.
- `app/redis_client.py` — one module-level client and `check_redis()`.
- `app/routers/health.py` — `GET /health` (dependency-free liveness) and `GET /health/ready`
  (round-trips Postgres and Redis, 503 with the failing dependency named).
- `app/main.py` — the FastAPI app. Carries `# No CORS middleware by design (D-012)` at
  line 7; that comment is now backed by a confirmed user decision rather than a default.
- `app/models/` — all nine ERD tables as SQLAlchemy 2.0 models, with both native enums.
- `alembic/versions/0001_initial_schema.py` — one migration building the entire schema from
  empty, including `CREATE EXTENSION pgcrypto` and explicit enum create/drop.
- `tests/` — 8 tests, metadata-level and TestClient-level; no live database required.

### Frontend — `dashboard/`

Vite + React 19 + TypeScript, React Router, TanStack Query, Zustand, Tailwind, shadcn/ui.
One Axios instance in `src/lib/api.ts` with `withCredentials: true` and a same-origin empty
`baseURL`; no `localStorage` or `sessionStorage` anywhere. The responsive shell
(`AdminSidebar`, `TutorNav`, `AppShell`) and the styled login card, with full light and dark
token sets.

### Infrastructure

Root `docker-compose.yml` with exactly four services; `docker/api.Dockerfile` and
`docker/dashboard.Dockerfile`; `.env.example`, `.gitignore`, and three `.dockerignore` files.
The dashboard service carries the anonymous `/app/node_modules` volume that keeps the bind
mount from shadowing installed dependencies. `Readme.md` corrected to match the real tree.

---

## Requirements closed

| REQ | Status | Evidence |
|---|---|---|
| REQ-001 layout | Satisfied | `api/`, `dashboard/`, `docker/` + root config only |
| REQ-002 env config | Satisfied (amended) | Missing `DATABASE_URL` → pydantic `1 validation error for Settings / database_url / Field required`; `/docs` → 200. See amendment below |
| REQ-003 Postgres + sessions | Satisfied | single `Base`, `get_db` closes in `finally` |
| REQ-004 Redis | Satisfied | `PING` succeeds against the compose Redis |
| REQ-005 health probes | Satisfied | 200/200 healthy; redis down → 503 `{"database":"ok","redis":"error"}`; postgres down → 503 `{"database":"error","redis":"ok"}`; `/health` stays 200 throughout |
| REQ-006 full ERD | Satisfied | all 9 tables; every ERD column, type, nullability, FK, unique constraint and index present |
| REQ-007 initial migration | Satisfied | up → 9 tables + 2 enums; `alembic check` clean; down → only `alembic_version`, enums dropped; re-up works; third up is a no-op |
| REQ-008 no double-booking | Satisfied | duplicate live slot raises on `uq_booking_live_slot`; succeeds after cancelling the first |
| REQ-009 dashboard scaffold | Satisfied | `tsc -b` / lint / build clean; single Axios instance; no web storage |
| REQ-010 responsive shell | **NOT VERIFIED** | browser-only; `qa-visual` blocked on extension site permission |
| REQ-011 Compose stack | Satisfied | 4 services, healthcheck ordering honoured, `node_modules` intact, volume persistence, hot reload |
| REQ-012 env hygiene | Satisfied | `.env` ignored at `.gitignore:2`; no credentials in `.env.example`; no build output in `git status` |
| REQ-013 accurate Readme | Satisfied, **partially proven** | content verified in place; the clean-clone smoke cannot run until there is a commit to clone |

---

## Deviations from plan

**T2.3 was added mid-phase.** The plan gap recorded in `STATE.md` — `RouteGuard` redirecting
every protected route to `/login` because `role` is always null in Phase 1, making the shell
unreachable and REQ-010 unverifiable — was resolved by the user as a dev-only bypass (D-013).
`planner` amended `01-02-PLAN.md` with T2.3; `coder-jr` implemented it in
`dashboard/src/components/layout/RouteGuard.tsx` and `AppShell.tsx`, gated on
`import.meta.env.DEV && accessToken === null`, with `AppShell` deriving the chrome from the
route so `/schedule` exercises `TutorNav`. **Phase 2 must remove or narrow this** — the
obligation is recorded in D-013 and must appear in Phase 2's `CONTEXT.md`.

**Two repairs no plan asked for.** Both were composition defects invisible to the individual
tasks that caused them, and both are recorded in `STATE.md`'s Position section: the
`Readme.md` environment-variable block that would not have booted if followed literally, and
**B-1**, the `src/ui/` displacement that left the dashboard unable to compile or mount at
all. B-1 also exposed that `npx tsc --noEmit` type-checks zero files in this project, which
is why the breakage was reported as "verified clean" at the pause.

---

## Code review

The dispatched `/code-review` agent died three times without reading a file. The review below
was run inline instead — findings verified against the live database and the frozen specs.
None are blocking. Per assumption A-6, ERD divergence is reported, never silently patched.

**F-1 — Four indexes are redundant, and `docs/erd.md` is what mandates them.** *(low)*
Confirmed against `pg_indexes`:

| Table | Redundant index | Subsumed by |
|---|---|---|
| `parents` | `ix_parents_phone_number` | `parents_phone_number_key` — exact duplicate |
| `tutor_subjects` | `ix_tutor_subjects_tutor_id_subject_id` | `uq_tutor_subjects_tutor_subject` — exact duplicate |
| `tutor_availability` | `ix_tutor_availability_tutor_id_day_of_week` | `uq_tutor_availability_slot` — strict leftmost prefix |
| `users` | `ix_users_email_role` | `users_email_key`; `email` is unique, so adding `role` buys almost nothing |

`docs/erd.md` lines 25, 43, 108 and 126 each specify a `UNIQUE` constraint *and* an `INDEX`
over the same columns, not accounting for the index PostgreSQL already creates for the
constraint. The implementation followed the ERD faithfully and is not at fault. **D-011 set
the precedent** for correcting exactly this literalism (it did so for `bookings` and `tutors`)
but did not extend to these four. Cost of keeping: write amplification on every insert, no
correctness impact. Cost of removing: four lines in `0001`, no data to migrate (A-7).

**F-2 — `LIVE_BOOKING_STATUSES` is dead and its literal is duplicated three times.** *(low)*
`api/app/models/booking.py:22` defines it; nothing reads it. The partial index at
`booking.py:38` hardcodes `status IN ('pending', 'confirmed')`, and
`alembic/versions/0001_initial_schema.py:159` hardcodes it again. Editing the tuple silently
changes nothing. Phase 4 will want this constant when translating the integrity error into
D-014's promised 409 — worth wiring together before then.

**F-3 — `pgcrypto` is unnecessary on PostgreSQL 13+.** *(low)*
`0001_initial_schema.py:31` creates the extension for `gen_random_uuid()`, which has been in
core since PG13; the stack pins `postgres:17-alpine`. Harmless locally, but `CREATE EXTENSION`
carries a privilege requirement worth removing before REQ-081's "no code change" RDS migration
is tested.

**F-4 — `updated_at` only advances through the ORM.** *(informational)*
Models set `onupdate=func.now()` (client-side SQLAlchemy); the migration sets only
`server_default=now()`, with no trigger. Raw-SQL or bulk updates in Phase 3/4 will leave it
stale.

**F-5 — Time-ordering checks are missing, inconsistent with D-011.** *(informational)*
D-011 deliberately added `day_of_week BETWEEN 0 AND 6`, but nothing enforces
`end_time > start_time` on `tutor_availability` or `bookings`, nor `end_date >= start_date` on
`tutor_availability_exceptions`. Natural Phase 4 work.

---

## Outstanding

1. **REQ-010 browser QA.** Needs `localhost:5173` site permission granted in the
   Claude-in-Chrome extension — a user action. Until then the responsive behaviour and the
   WCAG AA contrast claims are unproven; the existing contrast figures are computed from
   token values, not measured.
2. **The commit.** The phase is uncommitted by choice.
3. **The clean-clone smoke** for REQ-013, which needs a commit to clone.

## Carried into Phase 2

- Discharge the D-013 dev-bypass removal obligation.
- The constitution's frontend gate says `tsc --noEmit`, which is a no-op here. Correct it to
  `tsc -b` at the next constitution revision.
