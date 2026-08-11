# TutorLink — State

## Position

_Owned by the orchestrator. Planner must not write below this line until the next heading._

- **Current phase:** 01 — Foundation
- **Status:** Gate RUN and PASSING on the composed stack as of 2026-08-11. The plan gap is
  resolved (D-013, T2.3). One acceptance criterion remains unproven: REQ-010's browser QA at
  375px/1280px, blocked on a user action (see Outstanding below). Phase is not yet closed.
- **Last verified SHA:** none. `HEAD` is still `2ae9bcc`; all Phase 1 work remains uncommitted
  in the working tree. The user has not authorized a commit, so nothing has been committed.
- **Next action:** run `qa-visual` once the Claude-in-Chrome site permission for
  `localhost:5173` is granted, then — with user authorization — commit and record the SHA here.

### Task status

| Task | Agent | State |
|---|---|---|
| T1.1 backend skeleton, config, health probes | `coder-sr` | Complete, self-verified |
| T1.2 nine ERD models + initial migration | `coder-jr` | Complete, self-verified against a throwaway Postgres 17 |
| T2.1 Vite + React + TS scaffold | `coder-jr` | Complete, self-verified |
| T2.2 responsive shell + login presentation | `designer` | Code complete; **browser verification still outstanding — see REQ-010 below** |
| T2.3 dev-only `RouteGuard`/`AppShell` bypass (D-013) | `coder-jr` | Complete; verified absent from the production bundle |
| T3.1 Dockerfiles, Compose, env hygiene | `coder-sr` | Complete; full-stack smoke now done at the gate |
| T3.2 correct `Readme.md` | `coder-jr` | Complete, plus an orchestrator fix (see below) |

### Verified at the gate — first real run of the composed system

All of the following ran against the live Compose stack on 2026-08-11.

- Four services up. `postgres` and `redis` healthy; `api` starts only after both, honouring
  `depends_on: condition: service_healthy`.
- In-container: `ruff check .` clean; `pytest -q` → 8 passed.
- `alembic upgrade head` → 9 tables + both enums. `alembic check` → "No new upgrade
  operations detected". `alembic downgrade base` → leaves only `alembic_version`, and `\dT`
  confirms both enum types are dropped. Re-upgrade works; a third upgrade is a no-op.
- Every column, type, nullability, FK, unique constraint and index in `docs/erd.md` is
  present — including all six ERD indexes and the three replacement `bookings` indexes (D-011).
- REQ-008 proven live: a second `confirmed` booking on the same
  `(tutor_id, scheduled_date, start_time)` raises `duplicate key value violates unique
  constraint "uq_booking_live_slot"`; cancelling the first then re-inserting succeeds. The
  `day_of_week BETWEEN 0 AND 6` check constraint also fires.
- `/health` → 200 `{"status":"ok"}`; `/health/ready` → 200 both `ok`; `/docs` → 200. With
  `redis` stopped → 503 `{"database":"ok","redis":"error"}` while `/health` stays 200; with
  `postgres` stopped → 503 `{"database":"error","redis":"ok"}`.
- Missing `DATABASE_URL` fails at construction with pydantic's `1 validation error for
  Settings / database_url / Field required` — naming the field, as REQ-002 requires.
- `docker compose down` then `up` preserves database contents. API hot reload fires on a
  source touch. `node_modules` survives the bind mount (342 entries in-container).
- `.env` is git-ignored (`.gitignore:2`); no credential-shaped string in `.env.example`; no
  build output in `git status`. `Readme.md`'s Environment Variables block matches
  `.env.example` name-for-name and value-for-value, in order.
- `verifier` returned **PASS** over the combined result of all seven tasks.

### Two defects found and repaired during the gate

**B-1 — the dashboard did not compile at all.** `App.tsx`, `index.css`, `components/` and
`pages/` had been displaced into `dashboard/src/ui/` without their imports being updated,
while `@/*` maps to `./src/*` and `main.tsx` imports `./App.tsx`. `npx tsc -b` failed with 12
errors and the Vite dev server logged `Failed to resolve import "./App.tsx" from
"src/main.tsx"` — **the app never mounted in a browser**. Repaired by moving everything back
to the canonical `src/` layout. Found by `planner`; repaired by `coder-jr`.

**The earlier "typecheck clean" claim was false, and structurally so.** The root
`dashboard/tsconfig.json` is a solution file with `"files": []`, so `npx tsc --noEmit`
type-checks **zero files** and exits 0 unconditionally. Every previous "typecheck clean"
claim came from that command. The real gate is `npx tsc -b` (or `npm run build`, which runs
`tsc -b && vite build`). `01-02-PLAN.md`'s Verification section now says so. **The
constitution still says `tsc --noEmit` in "Testing and done" and should be corrected to
`tsc -b` at the next revision** — as written it instructs every future frontend task to use a
no-op as its correctness gate.

### NOT verified — outstanding before the phase is fully closed

1. **REQ-010, entirely.** 375px/1280px layout for both shells, hamburger and slide-in panel
   behaviour, bottom tab bar, focus rings, no-horizontal-scroll, login's four visual states,
   and measured light/dark contrast. `qa-visual` was dispatched and returned blocked: the
   Claude-in-Chrome extension has no site permission for `localhost:5173`, which only the
   user can grant. Headless CDP was ruled out by the user. The existing contrast figures
   remain **computed from token values, never browser-measured**: light lowest pair
   `--border` on `--muted` 3.15:1, lowest body text 6.13:1; dark 3.15:1 and 6.36:1.
2. **The clean-clone smoke** (`01-03-PLAN.md`'s real gate for REQ-013). It clones the repo,
   so it cannot run until Phase 1 is committed. Everything it would exercise has been
   verified in place; only the from-scratch path is unproven.
3. **The commit itself.** The tree is uncommitted, awaiting user authorisation.

### Orchestrator decision on a leftover open question

The `eslint-disable-next-line react-refresh/only-export-components` at
`dashboard/src/components/ui/button.tsx:67` is **accepted as-is for Phase 1**. It is one
narrowly-scoped, documented disable on shadcn's canonical generated output, and leaving it
avoids weakening the rule project-wide for a single file. Revisit in Phase 5 (REQ-057), when
many more shadcn components land, by adding a `src/components/ui/**` override to
`eslint.config.js` rather than accumulating per-file disables.

### Orchestrator repair applied during the phase

`Readme.md`'s Environment Variables block disagreed with `.env.example` on values (not names):
it carried `postgresql://user:password@…`, which SQLAlchemy 2.0 resolves to psycopg2 — not in
the dependency set — and empty Postgres credentials. Following the Readme literally would not
have booted. Corrected in place to match `.env.example` byte-for-byte. This was a composition
defect between two concurrently-executed tasks, invisible to either one.

### Resume checklist

Two user actions gate everything that is left. Neither can be done by an agent.

1. **Grant `localhost:5173` site permission in the Claude-in-Chrome extension**, then run
   `qa-visual` against the dev server for REQ-010 (both shells at 375px and 1280px, both
   themes, measured contrast). This is the only unproven Phase 1 requirement.
2. **Authorise the commit.** The whole phase is uncommitted. Once committed, record the SHA
   in "Last verified SHA" above and run the clean-clone smoke from `01-03-PLAN.md`, which
   needs a clonable commit to exist.
3. Then, and only then, mark Phase 1 `verified` in `ROADMAP.md` and start Phase 2.

Do not re-dispatch T2.2 to `designer` — its code is complete and now compiles and mounts.
Phase 2 must discharge the D-013 removal obligation for the dev-only route bypass.

See `phases/01-foundation/01-SUMMARY.md` for what shipped and the REQ-by-REQ close-out.

---

## Decisions

Owned by the planner. Each entry is settled unless an Open Question supersedes it.

**D-001 — Directory layout is `api/` + `dashboard/` + `docker/`.**
`Readme.md` proposes `bot/` and `dashboard/`, but the repository already contains empty
`api/` and `docker/` directories, created deliberately after the docs were written. The
later signal wins. `api/` is also the more accurate name: the service is not only a bot —
it serves the dashboard REST surface too, and `docs/api-design.md` treats the bot as an
in-process consumer. `docker/` holds Dockerfiles; `docker-compose.yml` stays at the repo
root because `Readme.md` step 3 promises a bare `docker compose up`.
Consequence: `Readme.md` is now wrong and is corrected by task T3.2. `docs/` is untouched.

**D-002 — TypeScript for the dashboard. CONFIRMED BY THE USER 2026-08-10.**
No longer a default. OQ-1 is resolved as TypeScript, matching what is already built — the
tree needs no change. The `.jsx` filenames in `docs/admin-dashboard-design.md` and
`Readme.md` are informal shorthand and are read as `.tsx`; that is not spec drift and
`docs/` stays untouched. The constitution's frontend "done" bar (`tsc` + lint + build) is
therefore permanent. Supersedes assumption A-1.

**D-003 — Phase 1 is a walking skeleton, not full scaffolding.**
Runnable beats broad. The one deliberate exception is the data layer: the entire ERD ships
in Phase 1 as models plus one migration, because `docs/erd.md` is fully specified and
stable, and it is the single widest unblock for Phases 2–7. Everything above the data layer
(auth, routers, services, bot, data-bound views) is deferred.

**D-004 — One FastAPI process serves both the Twilio webhook and the dashboard API.**
`Readme.md` architecture and `docs/api-design.md` both describe the bot calling endpoints
"internally within the FastAPI service". The bot will call the service layer directly in
Python, never over HTTP to itself.

**D-005 — Sync SQLAlchemy 2.0 with `psycopg` v3, not async.**
Expected load is a handful of concurrent dashboard users and a low message rate. Sync
endpoints run in FastAPI's threadpool, Alembic needs no async harness, and the hardest code
in the project (the three-step availability query) stays readable. Revisit only if
measured latency demands it; the service layer boundary makes the swap mechanical.

**D-006 — Python is pinned to 3.12 in the container.**
The host runs Python 3.14.6, which is ahead of reliable C-extension wheel coverage for
`psycopg[binary]` and friends. All backend commands — including pytest and alembic — run
inside the container, so the host version is irrelevant. Node is pinned to 22 LTS in the
container for the same reason (host is Node 25, non-LTS).

**D-007 — Dependency management is `uv` with `pyproject.toml` + `uv.lock`.**
Reproducible, fast to layer-cache in Docker, and the current default in the Python
ecosystem. Reversible to `requirements.txt` with one export command if it causes friction.

**D-008 — Two health endpoints, not one.**
`GET /health` is a dependency-free liveness probe; `GET /health/ready` round-trips
PostgreSQL and Redis. A single endpoint that touches dependencies makes a container
restart loop on a transient database blip; a single endpoint that does not touch them
proves nothing about the walking skeleton.

**D-009 — Migrations are never applied on application startup.**
Applied by an explicit `alembic upgrade head` command. Auto-migrating on boot races when
more than one container starts, and makes rollback ambiguous.

**D-010 — Enum columns are native PostgreSQL enums.**
`docs/erd.md` specifies `ENUM` for `users.role` and `bookings.status`. Native enums are
used, and each is created and dropped explicitly in the migration.

**D-011 — ERD constraints are implemented as intended, not as literally written.**
`tutors` lists `UNIQUE (email, phone_number)`, but the column notes say each is unique;
this ships as two separate unique constraints. `bookings` lists one five-column index that
serves none of the documented query patterns; this ships as targeted indexes on
`(tutor_id, scheduled_date, status)`, `(child_id, scheduled_date)`, and
`(scheduled_date, status)`. Additionally, `tutor_availability.day_of_week` ships with a
check constraint `day_of_week BETWEEN 0 AND 6` (T1.2), which `docs/erd.md` does not list;
it enforces the encoding the ERD states in prose and is an intentional addition, not drift.
All three are recorded here as deliberate spec interpretation.

**D-012 — Same-origin everywhere. There will never be CORS. CONFIRMED BY THE USER
2026-08-10.** No longer a default. OQ-3 is resolved as option (a), matching what is already
built. The dashboard and the API share one origin: the Vite dev-server proxy forwards
`/api` and `/auth` to `http://api:8000` in development, and a reverse proxy does the same in
production. The API still listens on `:8000` directly for ngrok and the Twilio webhook,
which is not a browser origin.

Consequences, all binding:
- No CORS middleware is ever added to the API. `api/app/main.py:7`'s
  `# No CORS middleware by design (D-012)` comment is now permanently true.
- `Settings` has no `cors_origins` field and never gains one. REQ-002's acceptance criteria
  were amended on 2026-08-10 to drop it (see `REQUIREMENTS.md` REQ-002).
- **Inherited by Phase 2:** REQ-027's HttpOnly refresh cookie is a first-party cookie. It
  needs no `SameSite=None`, no `Secure`-plus-`None` pairing to work in dev, and no `Domain`
  attribute. Set `HttpOnly; SameSite=Lax; Path=/auth; Secure` (the last in production only).
  It carries no third-party-cookie risk and is unaffected by browser third-party-cookie
  deprecation. Do not plan Phase 2 around cross-origin cookie mechanics.
- Supersedes assumption A-3.

**D-013 — The Phase 1 shell is reachable in dev via a bypass inside `RouteGuard`, gated on
`import.meta.env.DEV`. CONFIRMED BY THE USER 2026-08-10.** This resolves the plan gap
recorded in the Position section above: `RouteGuard` redirects to `/login` whenever `role`
is `null`, `role` is always `null` in Phase 1, so the shell T2.2 built could not be reached
in a browser and REQ-010 could not be verified by anyone.

`RouteGuard` returns its children instead of redirecting when `import.meta.env.DEV` is true
and no session exists (`accessToken === null`). `AppShell` picks its chrome from the route
while `role` is `null`, under the same `import.meta.env.DEV` guard, so `/dashboard` renders
the admin shell and `/schedule` renders the tutor shell.

Why this and not the alternatives: `import.meta.env.DEV` is statically replaced with
`false` by `vite build`, so both branches are dead-code-eliminated and the production
bundle contains no bypass at all — zero production surface, provable by grepping `dist/`.
A seeded placeholder role was rejected (it writes pretend-auth into the store Phase 2 must
then unpick, and makes the two shells stick to whichever loaded first); deferring shell
verification to Phase 2 was rejected (it would ship an unverified REQ-010). No environment
variable is introduced: a runtime flag would survive into the production bundle, which is
exactly the property being avoided.

Planned as task **T2.3** in `01-02-PLAN.md`, `coder-jr`, owning exactly
`RouteGuard.tsx` and `AppShell.tsx`.

**Removal obligation.** This is temporary scaffolding. Phase 2 must either delete both
branches once a seeded admin exists to log in as (the expected outcome), or narrow the gate
to an explicit opt-in that is off by default — and record which, here, with a new decision
ID. Phase 2's `CONTEXT.md` must carry this as a task input. A Phase 2 that closes without
discharging it is drift.

**D-014 — Double-booking is prevented by a partial unique index. CONFIRMED BY THE USER
2026-08-10.** OQ-2 is resolved as option (a), matching what T1.2 already shipped: a partial
unique index on `bookings (tutor_id, scheduled_date, start_time)` restricted to
`status IN ('pending','confirmed')`. The tree needs no change.

This is an addition to `docs/erd.md`, not something it specifies — recorded as deliberate
spec interpretation alongside D-011, and reported as such rather than patched into `docs/`.
It is what makes `docs/api-design.md`'s promised `409 Conflict — slot already booked`
truthful under concurrent WhatsApp and dashboard submissions, where a read-then-write check
in the service layer would race. Phase 4 must therefore handle the integrity error and
translate it to a 409, not rely on a pre-check alone. If the business later wants
overlapping sessions, dropping the index is a two-line follow-up migration. Supersedes
assumption A-2, and REQ-008's `[A]` marker is now stale.

---

## Assumptions

IDs are never reused. Rows promoted to confirmed decisions stay listed so that requirements
citing them remain traceable.

| ID | Assumption | Requirements at risk if wrong |
|---|---|---|
| ~~A-1~~ | **CONFIRMED 2026-08-10 → D-002.** The dashboard is TypeScript. No longer an assumption. | — |
| ~~A-2~~ | **CONFIRMED 2026-08-10 → D-014.** Partial unique index prevents double-booking. No longer an assumption; REQ-008's `[A]` marker is stale and should be dropped at the next `REQUIREMENTS.md` pass. | — |
| ~~A-3~~ | **CONFIRMED 2026-08-10 → D-012.** Browser→API traffic is same-origin, dev and prod. No longer an assumption; the `[A]` marker on REQ-009's proxy criterion is stale. | — |
| A-4 | The refresh token is transported as an HttpOnly cookie, and `/auth/refresh` reads it from the cookie rather than the request body. Still open — see OQ-4. D-012 settles the cookie's *attributes* (first-party, `SameSite=Lax`), not the *transport contract*. | REQ-021, REQ-027 |
| A-5 | One business timezone; no per-user timezone handling anywhere. | REQ-042, REQ-044, REQ-060 |
| A-6 | `docs/*.md` are frozen specs. Divergence is reported, never silently patched. | all |
| A-7 | There is no production data anywhere yet, so the initial migration needs no backfill or data-preserving path. | REQ-007 |
| A-8 | The deleted `UI/` scaffold is not returning; `dashboard/` is built fresh. | REQ-009 |
| A-9 | One business-wide session length subdivides availability ranges into slots. | REQ-042, REQ-043, REQ-044, REQ-074 |

---

## Open Questions

### Architecture-level — a wrong answer costs rework

**OQ-1 — RESOLVED 2026-08-10: TypeScript.** _(was: blocks T2.1, T2.2)_
The user confirmed TypeScript, which is what was built — no change to the tree, no rework.
Recorded as **D-002**. The JavaScript fallback described below is now closed off; it is kept
only as the record of what was weighed.

_Original question, retained for audit:_

**OQ-1 — TypeScript or JavaScript for the dashboard?** _(blocked T2.1, T2.2)_
- Evidence for JS: every filename in `docs/admin-dashboard-design.md` and `Readme.md` is
  `.jsx` / `.js`.
- Evidence for TS: the scaffold the user actually built and then deleted (commit `90f8e1a`)
  was TypeScript — `main.tsx`, `App.tsx`, `tsconfig.app.json`, `tsconfig.node.json`,
  `vite.config.ts`, `typescript ~6.0.2`. shadcn/ui's canonical generator output is `.tsx`.
  The API surface is large and entity-heavy, which is exactly where typed clients pay off.
- **Recommended default: TypeScript.** The `.jsx` extensions in the design docs read as
  informal shorthand, whereas the deleted scaffold was a deliberate act of setup.
- If the user picks JavaScript: drop `tsconfig.*` and `typescript`, rename every `.tsx` to
  `.jsx`, replace typed API models with JSDoc or nothing, and change the constitution's
  frontend "done" bar from `tsc --noEmit` to lint-only. Cheap now (T2.1 is the only
  affected task); expensive after Phase 5.

**OQ-2 — RESOLVED 2026-08-10: option (a), the partial unique index.** _(was: blocks T1.2)_
The user confirmed option (a), which is what T1.2 shipped — no change to the tree, no
migration to write. Recorded as **D-014**. Options (b) and (c) are closed; in particular the
`docs/erd.md` amendment that (c) would have required does not happen.

_Original question, retained for audit:_

**OQ-2 — Should the schema prevent double-booking, given the ERD does not?** _(blocked T1.2)_
- `docs/api-design.md` promises `409 Conflict — e.g. slot already booked`, but
  `docs/erd.md` defines no constraint that makes it impossible. A read-then-write check in
  the service layer races under concurrent WhatsApp and dashboard submissions.
- Options: (a) partial unique index on `bookings (tutor_id, scheduled_date, start_time)
  WHERE status IN ('pending','confirmed')`; (b) application-level check only;
  (c) exclusion constraint over a time range, which handles overlapping — not just
  identical — slots but requires `btree_gist` and a range column not in the ERD.
- **Recommended default: (a).** It is one line in the migration, it makes the documented
  409 truthful, and it costs nothing if the business later wants overlapping sessions —
  removing it is a two-line follow-up migration.
- If the user picks (b): remove the index from the initial migration and add a REQ in
  Phase 4 for optimistic-locking or `SELECT … FOR UPDATE` in the booking service instead.
- If the user picks (c): the ERD gains a `tstzrange` or `timerange` column on `bookings`,
  which is a spec amendment to `docs/erd.md` and should be raised with the user first.

**OQ-3 — RESOLVED 2026-08-10: option (a), same-origin everywhere.** _(was: affects T2.1,
T3.1)_ The user confirmed option (a), which is what T2.1 and T3.1 shipped — no change to the
tree. Recorded as **D-012**, including the Phase 2 consequence that REQ-027's refresh cookie
is first-party and needs no `SameSite=None` and no `Domain`. Option (b) is closed: no CORS
middleware, ever. `Readme.md`'s description of the browser calling `:8000` directly is
superseded by the proxy; it was already corrected by T3.2.

**Deferred out of OQ-3, explicitly NOT decided — see OQ-6** (production hosting specifics:
instance choice, TLS terminator, domain). Resolving OQ-3 did not resolve those.

_Original question, retained for audit:_

**OQ-3 — Same-origin proxy, or direct cross-origin calls with CORS?** _(affected T2.1, T3.1)_
- `Readme.md` describes the dashboard on `:5173` calling the API on `:8000` directly, which
  is cross-origin. `docs/admin-dashboard-design.md` requires the refresh token in an
  HttpOnly cookie — and cross-origin cookies need `SameSite=None; Secure` plus
  `allow_credentials` with an explicit origin allowlist, which does not work over plain
  HTTP on localhost in current browsers.
- Options: (a) Vite dev-server proxy forwards `/api` and `/auth` to the API, making the
  browser see one origin; a reverse proxy does the same in production. (b) Direct
  cross-origin with a fully configured CORS policy and cookie attributes.
- **Recommended default: (a).** It removes an entire class of cookie and preflight bugs and
  makes dev behave like production. The API still listens on `:8000` for ngrok and Twilio.
- If the user picks (b): `vite.config.ts` loses its proxy block, Axios gets an absolute
  base URL from `VITE_API_BASE_URL`, the API needs a real CORS middleware config, and
  Phase 2's cookie work becomes materially harder. Phase 8 also needs a TLS terminator
  in front of the API regardless.

**OQ-4 — `/auth/refresh` contract: cookie or request body?** _(does not block Phase 1)_
- `docs/api-design.md` shows `POST /auth/refresh` with `{"refresh_token": "<jwt>"}` in the
  body. `docs/admin-dashboard-design.md` says the refresh token lives in an HttpOnly
  cookie. These contradict: JavaScript cannot read an HttpOnly cookie to put it in a body.
- **Recommended default:** `/auth/token` sets the refresh token as an HttpOnly cookie
  **and** returns it in the body; `/auth/refresh` reads the cookie first and falls back to
  the body for non-browser clients. Both docs stay honest and nothing has to be amended.
- If the user prefers cookie-only, `docs/api-design.md` needs a spec amendment. Surfaced
  now because it changes Phase 2's shape, not Phase 1's.

**OQ-5 — What is a "slot"? How long is a session?** _(blocks nothing in Phase 1; blocks all
of Phase 4)_
- `tutor_availability` stores a *range* — e.g. Monday 09:00–12:00. But
  `GET /api/slots/available` returns discrete offers with a `start_time` and `end_time`
  (the example shows 09:00–10:00), and `bookings` stores a single start/end pair. Nothing
  in any design doc states the session length that subdivides a range, nor whether it is
  fixed per business, per subject, or chosen by the parent.
- **Recommended default:** a single business-wide session length of 60 minutes, configured
  as `SESSION_LENGTH_MINUTES` in `Settings`, with availability ranges subdivided into
  back-to-back slots on the hour from `start_time`.
- If the user wants per-subject or per-tutor session lengths, that is a new column on
  `subjects` or `tutor_subjects` and therefore a second migration plus a spec amendment to
  `docs/erd.md`. Raised now because it is the largest unknown in the project after Phase 1,
  and because knowing the answer early may change how Phase 4 is decomposed.
- Phase 1 is unaffected either way: the schema is identical under all these options.

**OQ-6 — What actually hosts production, and what terminates TLS?** _(scoped to Phase 8;
blocks nothing before it)_ Deferred deliberately by the user on 2026-08-10 when OQ-3 was
resolved. D-012 fixes the *topology* — one origin, a reverse proxy in front of both the
dashboard and the API — but not the machine, the proxy software, or the name.

- **Instance:** AWS Lightsail or EC2. Not decided. Lightsail is simpler and flat-priced;
  EC2 is what REQ-080 currently names.
- **TLS terminator:** Caddy is the **recommendation, not a decision** — automatic Let's
  Encrypt, and its reverse-proxy config for "serve the built dashboard, forward `/api` and
  `/auth` to the API" is a handful of lines. Nginx plus certbot is the alternative.
  Whichever is chosen must reproduce the same single origin the Vite proxy provides in dev,
  or D-012's cookie consequences stop holding.
- **Domain name:** not chosen. Required before REQ-082 (the Twilio webhook must be
  registered against a stable HTTPS URL).
- **Noted, not acted on:** REQ-080 currently reads "a single EC2 instance". If Lightsail is
  chosen, that is a spec amendment to REQ-080 and must be surfaced to the user as one.
  REQ-080 is deliberately left unamended today — the decision has not been made, and
  pre-emptively softening the wording would hide the choice rather than record it.

### Detail-level — defaults applied, execution is not blocked

- **Dashboard package manager:** npm with a committed `package-lock.json`, matching the
  deleted scaffold.
- **PostgreSQL and Redis versions:** `postgres:17-alpine`, `redis:7-alpine`.
- **Seeding the first admin user:** deferred to Phase 2 alongside password hashing. Phase 1
  ships an empty database on purpose.
- **`day_of_week` encoding:** `0 = Monday … 6 = Sunday`, exactly as `docs/erd.md` states.
  This matches Python's `date.weekday()`. Never use `isoweekday()` (Monday=1) or
  PostgreSQL's `EXTRACT(DOW)` (Sunday=0) to derive it.
- **Bind-mount hot reload:** on for both services in dev; the production overlay in Phase 8
  removes it.
- **Backend test runner location:** all pytest and alembic invocations run inside the `api`
  container, never on the host interpreter.

---

## Blockers

**B-1 — The dashboard does not compile. Found by `planner` 2026-08-10; not previously
recorded, and it contradicts "Verified at pause" above.** Blocks T2.3, blocks the Phase 1
gate, blocks any browser verification of REQ-010.

`dashboard/src/App.tsx`, `dashboard/src/index.css`, `dashboard/src/components/` and
`dashboard/src/pages/` have been displaced into `dashboard/src/ui/` without their imports
being updated. Nothing in the tree supports that layout: `tsconfig.app.json` and
`vite.config.ts` both map `@/*` → `./src/*`, and `src/main.tsx` imports `./App.tsx` and
`./index.css`. Filesystem mtimes put the move at 17:20, after the rest of T2.2's files
(16:14–16:26), so it happened at or after the pause.

Reproduce from `dashboard/`:

- `npx tsc -b` → **13 errors**, all `TS2307 Cannot find module` plus two knock-on `TS7006`
  in `Login.tsx`. `npm run build` fails with the same.
- `npm run lint` → **passes**. ESLint does not resolve TypeScript path aliases, so it is no
  evidence here.
- `npx tsc --noEmit` → **passes, and is worthless**. The root `tsconfig.json` is a solution
  file with `"files": []` and two project references, so bare `tsc --noEmit` type-checks
  zero files and exits 0 no matter what the code says. Every "typecheck clean" claim in the
  Position section above was produced by this command and proves nothing. `tsc -b` is the
  real gate; `01-02-PLAN.md`'s Verification section has been amended to use it, and the
  constitution's `tsc --noEmit` wording should be corrected to `tsc -b` at the next
  constitution revision.

Remedy: restore the canonical layout — move `App.tsx`, `index.css`, `components/`, `pages/`
from `src/ui/` back to `src/` — and confirm with `npx tsc -b`. This is a repair of
unattributed drift, not a task any plan asked for; it overlaps the writable sets of both
T2.1 and T2.2 and so is orchestrator work, in the same category as the `Readme.md` repair
already applied. **`planner` did not fix it: source files are outside planner's write
scope.** If `src/ui/` was in fact a deliberate restructure, the alternative remedy is to
update `main.tsx`'s two relative imports and re-point the `@` alias in both
`vite.config.ts` and `tsconfig.app.json` to `./src/ui` — but that breaks
`@/lib/*` and `@/stores/*`, which stay under `src/`, so it is the worse of the two.

**Not blockers, but still unanswered** (they sit in the Position section's "T2.2's open
questions" and need a human answer, not a planning decision): whether to approve a
headless-Chrome CDP smoke check or verify 375px/1280px manually, and whether the
`eslint-disable-next-line react-refresh/only-export-components` in generated `button.tsx`
is acceptable versus a one-line `eslint.config.js` change.

Every open question now has either a confirmed answer (OQ-1, OQ-2, OQ-3) or a stated
default (OQ-4, OQ-5, OQ-6). No planning decision is outstanding.
