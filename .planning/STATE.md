# TutorLink — State

## Position

_Owned by the orchestrator. Planner must not write below this line until the next heading._

- **Current phase:** 02 — Authentication and RBAC
- **Status:** `verified` as of 2026-08-12. All of REQ-020 … REQ-029 plus the new REQ-02A are
  proven. `verifier` returned PASS over the combined result of all eleven tasks; `qa-visual`
  returned PASS on two browser passes (admin shell, then tutor shell); an independent
  security review returned **no critical and no high findings**. D-013's dev-bypass removal
  obligation is discharged by deletion. Phase 1 remains `verified` (all thirteen).
- **Last verified SHA:** `phase-2-auth-rbac` branch — `feat: Phase 2 — authentication and
  RBAC` merged with `main`'s Phase 1 close-out (`af9089a`), plus the close-out commit. **On a
  branch, not on `main`, and not pushed.** This workspace was sitting on detached HEAD at
  `684a015` while `main` had already advanced to `af9089a`; the two were reconciled by
  merging `main` into the branch. Only `.planning/ROADMAP.md` conflicted and was resolved by
  hand. The merged tree was re-verified as a whole: **110 backend tests**, ruff clean,
  `tsc -b` / lint / build clean, live login 200, `/health/ready` 200.
  **Merging this branch to `main` is the next git action and has not been done.**
- **Next action:** Phase 3 — Core CRUD API (REQ-030 … REQ-036), the first phase to mount
  `/api/*` routes. Before its first router is written, harden the ergonomics of
  `resolve_tutor_scope` (`api/app/dependencies.py:132-156`) — see the carry-forward in
  `phases/02-auth-rbac/02-SUMMARY.md`. Its behaviour is correct and fully tested, but a
  router that discards its return value leaks every tutor's rows to a tutor who passes no
  `tutor_id`, and Phases 3, 4 and 6 call it on every route.

### Dev database state (local only, not fixtures)

The shared `tutorlink` dev database holds two real accounts, both with password
`change-me-please`: `admin@tutorlink.test` (admin, created by the seed CLI) and
`tutor@tutorlink.test` (tutor, with a matching `tutors` row, created by the orchestrator so
`qa-visual` could reach the tutor shell at all — the tutor half of REQ-010 and REQ-028 had
never been exercised in a browser). Neither is a fixture and neither is committed. Phase 3
should replace the tutor row with one created through `POST /api/tutors` once that exists.

### Phase 1 record below

The sections that follow document Phase 1 and are kept as history. See
`phases/02-auth-rbac/02-SUMMARY.md` for what Phase 2 shipped, its REQ-by-REQ close-out, its
deviations, and the seven items of spec drift it reported.

### Clean-clone smoke — RUN AND PASSED 2026-08-11 (REQ-013 closed)

Run by `verifier` against a fresh `git clone` of `dae0e55` into `/tmp/tutorlink-smoke`,
following `Readme.md`'s Local Development steps literally. All functional criteria passed:

- No undocumented step was needed. The Readme alone brought the stack up.
- Four services started; `postgres` and `redis` `(healthy)`; `api` started only after both.
- `alembic upgrade head` → `Running upgrade -> 0001, initial schema`. `\dt` → the 9 business
  tables plus `alembic_version`; `\dT` → `booking_status` and `user_role`.
- `/health` → 200 `{"status":"ok"}`; `/health/ready` → 200 `{"database":"ok","redis":"ok"}`.
- `GET /login` → 200, serving genuine Vite dev-server SPA HTML (`/@vite/client`,
  `/@react-refresh`, `<div id="root">`, `/src/main.tsx`) — **not** an error page. This proves
  the dev server serves the app; it does **not** prove React Router rendered a login form.
  That distinction is REQ-010's, and REQ-010 is still unproven.
- `Readme.md`'s Environment Variables block and `.env.example` list the same 12 variables in
  the same order.
- `git status --porcelain` empty after a full build — no generated file escapes `.gitignore`.
- Teardown clean: `docker compose down -v`, clone removed, all four host ports freed.

**Orchestrator resolution of a plan-internal contradiction (REQ-013).** `verifier` returned
BLOCKED on exactly one item: `01-03-PLAN.md:190` lists "`Readme.md` contains no reference to
`bot/`" as an acceptance criterion, and `Readme.md:86` contains the string. That line is
**verbatim what `01-03-PLAN.md:168-170` instructed T3.2 to write**: "Add one sentence noting
that the service is named `api/` rather than `bot/` because it serves both the Twilio webhook
and the dashboard REST API from one process." The plan mandates the sentence in its build
section and forbids the substring in its acceptance section. The requirement of record,
`REQUIREMENTS.md:149-150`, says the *Project Structure section* must not show the obsolete
`bot/` **tree** — and it does not; the tree shows `api/`, `dashboard/`, `docker/`. **REQ-013
is satisfied. No change to `Readme.md`.** `verifier` was correct to refuse to downgrade a
criterion handed to it as a hard gate; resolving the contradiction is an orchestrator call,
recorded here as one. `01-03-PLAN.md`'s acceptance bullet should be narrowed to "no reference
to a `bot/` *directory*" at the next planner pass — planner owns that file, so it was not
edited here.

### REQ-010 — VERIFIED IN A BROWSER 2026-08-12, with one defect found and fixed

The extension was connected on 2026-08-12 and `qa-visual` ran for the first time with real
browser tooling. Both shells were exercised at 375px and 1280px in both themes. Chrome was
the only engine used — headless CDP, Playwright and Puppeteer stayed ruled out and were not
substituted.

**Structural criteria — all pass, with browser evidence.** Admin shell: persistent sidebar
at ≥768px, hamburger + slide-in panel below it, dismissible by backdrop *and* Escape with
focus returning to the trigger; the six nav items match `docs/admin-dashboard-design.md:51-58`
verbatim. Tutor shell: sidebar at ≥768px, three-item bottom tab bar below, no content
overlap. Login: label, focus, error (`role="alert"`) and disabled states all driven; zero
`/auth` requests fired, confirming it does not authenticate. No horizontal scroll at 375px on
any route; no FOUC. Console clean on all three routes in both themes — zero errors, zero
warnings.

**The computed contrast figures were wrong in method, and measuring caught a real defect.**
The recorded dark `--border` on `--muted` did measure 3.15:1, but that pair is not what
renders. `dashboard/src/components/ui/input.tsx` carried `dark:bg-input/30` — shadcn's stock
`Input`, which fills the field with the *border token itself at 30% opacity*. Composited over
the card `rgb(23,26,32)` that yields a fill of `rgb(48,51,59)`, against which the border
`rgb(105,110,121)` measures **2.47:1** — below the 3:1 WCAG AA floor for UI component
boundaries. Light theme was never affected: it used plain `bg-transparent` and measured
3.47:1.

**Fixed 2026-08-12** by removing `dark:bg-input/30`, so dark matches light's transparent
fill. Re-measured in the browser: **3.41:1, passes.** `tsc -b` exit 0 and lint clean after the
change. `dark:disabled:bg-input/80` was deliberately kept — disabled controls are exempt from
WCAG contrast requirements.

This defect was **not** introduced by `designer`; it is upstream shadcn default styling, the
same category as the `button.tsx` eslint-disable accepted below. The user chose the
narrow component-level fix over widening the `--border` token, which would have repainted
every bordered surface and invalidated all other dark-theme measurements.

**Measured contrast now on record** (rendered DOM, not token arithmetic). Dark: foreground on
background 17.33:1; muted-foreground on card 8.17:1; input border on fill 3.41:1; error text
6.35–6.9:1; button text on primary 7.31:1; sidebar text 16.62:1; sidebar border 3.58:1.
Light: card title 17.6:1; description 6.82:1; footer 6.47:1; error 6.9:1; input border
3.47:1; button text 7.52:1. Nothing measured falls below its AA threshold.

**Not covered, and still unproven.** Hover-state contrast (`:hover` cannot be held open
across a `getComputedStyle` call with this tooling); an exhaustive lowest-text-pair sweep of
every route — the recorded 6.13:1 light / 6.36:1 dark were not reproduced pair-for-pair,
though every pair sampled cleared 4.5:1; and iOS Safari specifics (`safe-area-inset`,
`100dvh`), since this was desktop Chrome only. Routes beyond `/login`, `/dashboard` and
`/schedule` are out of REQ-010's scope and were not exercised.

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

**Nothing remains. All three items are done.**

1. ~~REQ-010.~~ **DONE 2026-08-12** — browser-verified, one contrast defect found and fixed.
2. ~~The clean-clone smoke.~~ **DONE 2026-08-11** against `dae0e55` — passed. REQ-013 closed.
3. ~~The commit.~~ **DONE 2026-08-11** — `dae0e55`, local only, not pushed. The REQ-010
   contrast fix sits uncommitted on top of it and still needs its own commit.

The only carried caveats are the three "Not covered" items listed under REQ-010 above:
hover-state contrast, the exhaustive lowest-text-pair sweep, and iOS Safari rendering.

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

**Nothing gates the phase. Phase 1 is `verified` in `ROADMAP.md`.**

1. Commit the REQ-010 contrast fix (`dashboard/src/components/ui/input.tsx`, one class
   removed) together with this planning update. `dae0e55` and `684a015` are still local and
   unpushed.
2. Begin Phase 2. It must discharge the D-013 dev-bypass removal obligation, and should
   correct the constitution's frontend gate from `tsc --noEmit` to `tsc -b`.
3. Optional follow-up, not a gate: the three uncovered items under REQ-010 (hover-state
   contrast, exhaustive text-pair sweep, iOS Safari). Phase 5 is the natural place for the
   first two, when many more shadcn components land.

To bring the stack back up after the clean-clone smoke: `docker compose up -d` from the repo
root (the smoke required the main stack be taken down to free ports 5432/6379/8000/5173; its
named volume was preserved — `down`, never `down -v`).

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
assumption A-2, and REQ-008's `[A]` marker is now stale. _(Marker dropped 2026-08-12.)_

---

### Phase 2 decisions — recorded 2026-08-12 when the phase was planned

**D-015 — `/auth/refresh` transport is COOKIE FIRST, BODY FALLBACK. CONFIRMED BY THE USER
2026-08-12.** OQ-4 is resolved and **A-4 is settled**. `POST /auth/token` sets the refresh
token as an HttpOnly cookie **and** returns it in the response body. `POST /auth/refresh`
reads the cookie first and falls back to a JSON body `{"refresh_token": "..."}` for
non-browser clients; neither present is a 401.

Both frozen documents therefore stay accurate and **neither is amended**:
`docs/api-design.md:46-63` (body) describes the fallback path, and
`docs/admin-dashboard-design.md:24,34` (HttpOnly cookie) describes the browser path. The
contradiction OQ-4 identified was real; serving both contracts is what dissolves it.
Cookie attributes are fixed by D-012 and are not re-litigated here:
`HttpOnly; SameSite=Lax; Path=/auth; Secure` — the last in production only, see D-027.

**D-016 — Token lifetimes: access 15 minutes, refresh 7 days. CONFIRMED BY THE USER
2026-08-12.** Configurable through `Settings` as `access_token_expire_minutes = 15` and
`refresh_token_expire_days = 7`, alongside `jwt_algorithm = "HS256"`.

All three carry defaults, so **Phase 2 introduces no new environment variable.**
`.env.example`, `docker-compose.yml`, and `Readme.md` are untouched, which keeps REQ-012 and
REQ-013 undisturbed and means **no Phase 2 task owns a root-level file** — a meaningful
reduction in cross-task collisions. If a deployment ever needs different lifetimes, the env
vars already work through pydantic-settings; they simply are not documented as required.

**D-017 — Refresh tokens ROTATE ON USE and are backed by a SERVER-SIDE REVOCATION TABLE.
CONFIRMED BY THE USER 2026-08-12.** The user deliberately chose the stronger option over the
stateless default `02-CONTEXT.md`'s stub proposed. Each refresh issues a new token and
invalidates the presented one; every issued token is tracked in a `refresh_tokens` row so
that logout and forced session termination take effect immediately instead of after seven
days.

**This is a scope addition.** REQ-020 … REQ-029 do not cover a revocation store, so it is
recorded as the new **REQ-02A**, mapped to Phase 2, and it ships an Alembic migration
(`0002`) for the new table. The Phase 2 decade was fully allocated; `REQ-02A` extends the
block without renumbering any existing stable ID.

**Reuse policy — decided, not deferred:** presenting an already-rotated refresh token
**revokes the entire family** (every live row sharing that `family_id`) and returns 401. The
reasoning: either the legitimate holder replayed an old token or an attacker stole one and
the holder has since rotated past it, and the two are indistinguishable from the server's
position — so the safe action is to burn the chain and force a fresh login. This is the
standard OAuth 2.0 BCP response and it is the entire reason the table exists; without it,
rotation detects nothing. The 401 is byte-identical to any other invalid-token 401, because
telling an attacker their stolen token was detected as a replay tells them the family is
burned. Two independent logins are two independent families, so logging out on a phone does
not log out a laptop.

Consequence, reported as spec drift and **not** patched into `docs/` (A-6): `POST /auth/logout`
does not exist in `docs/api-design.md` and is introduced by REQ-02A, and `POST /auth/refresh`
returns `refresh_token` in its body in addition to the documented `access_token` and
`token_type`. Both additions are additive and break no documented client.

**D-018 — The first admin is created by a CLI seed command, and by nothing else. CONFIRMED
BY THE USER 2026-08-12.** `docker compose run --rm api python -m app.cli seed-admin`, reading
`TUTORLINK_ADMIN_EMAIL` / `TUTORLINK_ADMIN_PASSWORD` from the environment or prompting
interactively, bcrypt-hashing the password, and behaving **idempotently**: a second run
creates no duplicate and does **not** reset the password.

**There is no public setup endpoint, no registration route, and no "create an admin if none
exists" startup hook — not now, not ever.** A bootstrap endpoint is an unauthenticated
privilege-escalation surface that is trivially forgotten in production. The two variables are
command inputs, not `Settings` fields, and are deliberately absent from `.env.example`: a
committed example file is the wrong place for the shape of a real admin credential.
`argparse` is used rather than `typer` or `click` — one subcommand does not justify a runtime
dependency.

**D-019 — D-013 is discharged by DELETION.** Both `import.meta.env.DEV` branches — the
`devNoAuth` short-circuit in `RouteGuard.tsx:17-26` and the route-derived chrome selection in
`AppShell.tsx:18-20` — are removed in full by task `P2-T5.1`, not narrowed and not left
behind a flag.

D-013 offered deletion or a narrowed opt-in. Deletion wins because the bypass's entire
justification was that Phase 1 had nobody to log in as, and `P2-T3.2` now seeds an admin: the
genuine login flow is available locally and is strictly better to exercise than a bypass. A
narrowed opt-in would be a second, permanently-maintained authentication path whose only user
is a developer who could instead type a password. The discharge is gated by
`grep -rn "import.meta.env.DEV" dashboard/src` returning empty in `P2-T5.1`'s acceptance
criteria; a Phase 2 that closes with either branch present is drift.

**D-020 — Three new backend runtime dependencies, recorded as the constitution requires.**

| Package | Chosen over | Why |
|---|---|---|
| `pyjwt>=2.9` | `python-jose` | Actively maintained, fewer transitive dependencies, and what FastAPI's own security documentation now uses |
| `bcrypt>=4.2` used **directly** | `passlib[bcrypt]` | `passlib` is unmaintained and its bcrypt backend raises `AttributeError: module 'bcrypt' has no attribute '__about__'` against `bcrypt>=4.1`. The direct wrapper is four lines and has no such trap |
| `python-multipart>=0.0.9` | — | Required by FastAPI to parse `OAuth2PasswordRequestForm`; without it `/auth/token` fails at import |

`api/pyproject.toml` and `api/uv.lock` are owned exclusively by `P2-T1.1`; every other Phase 2
task is instructed to stop and report rather than add a dependency.

Also recorded: bcrypt silently truncates a password past **72 bytes**, which would make two
different long passwords interchangeable. Passwords are therefore **rejected** above that
length rather than truncated, at both the login boundary and the seed command.

**D-021 — `POST /auth/token` is form-encoded, not JSON.** `docs/api-design.md:16,27` states
"standard OAuth2 password flow, implemented natively via FastAPI's `OAuth2PasswordBearer`",
and the standard password flow is `application/x-www-form-urlencoded` with `username` and
`password`. The JSON block at `docs/api-design.md:29-35` is read as naming the fields, not
the media type — the same reading D-002 applied to that document's `.jsx` filenames. This
also makes the `/docs` Authorize button work without a custom shim. Reported as spec
interpretation; `docs/` is not edited. The dashboard must send `URLSearchParams`, since Axios
defaults to JSON — called out explicitly in `P2-T4.1`.

**D-022 — JWT claims beyond the four documented ones.** Access tokens carry
`sub`, `role`, `tutor_id`, `exp` (all documented) plus `iat`, `jti`, and `typ = "access"`.
Refresh tokens carry `sub`, `exp`, `iat`, `jti`, `fid`, and `typ = "refresh"` — and
deliberately **no** `role`, so a role change takes effect on the next refresh rather than
persisting for seven days.

`typ` is not decoration: without it a refresh token is a structurally valid access token, and
a seven-day credential becomes an API key. `decode_token` enforces the expected `typ` and the
auth dependency re-enforces it. Reported as an additive interpretation of
`docs/api-design.md:70-78`.

**D-023 — `get_current_user` loads the `User` row on every request.** One indexed
primary-key lookup per request buys the property that deactivating an account
(`is_active = false`, which is how REQ-030's soft delete works) takes effect on the **next
request** rather than up to fifteen minutes later when the access token expires. A
claims-only path would be faster and wrong. The dependency returns a frozen `CurrentUser`
dataclass, never the ORM object — the constitution forbids an ORM instance crossing the HTTP
boundary, and a frozen principal cannot be mutated by a route by accident.

**D-024 — Validation errors return 400, not FastAPI's default 422.**
`docs/api-design.md:637-644` lists 400 for validation and does not list 422 at all, and
REQ-029 requires the documented codes. A `RequestValidationError` handler in `main.py` remaps
the status **and** flattens FastAPI's list-of-error-objects into a single `detail` string, so
every error body in the application is `{"detail": "<string>"}`. Binding on every router
written from Phase 3 onward.

**D-025 — The dashboard decodes the JWT itself, and bootstraps the session on mount.**
`docs/admin-dashboard-design.md:36` says the role is read from the decoded JWT, so a
fifteen-line base64url decode in `dashboard/src/lib/auth.ts` implements the documented
design — **with no new dependency** (no `jwt-decode`, no `jose`). The decode is explicitly not
verification: the signature is never checked in the browser and the role is used only to pick
which chrome to render. Every access decision is the server's.

The access token lives in memory and therefore dies on reload, while the refresh cookie
survives. The app therefore attempts `POST /auth/refresh` **once** on mount and the store
carries a `status: 'loading' | 'authenticated' | 'anonymous'` so `RouteGuard` can wait rather
than redirect. Without this, the HttpOnly cookie has no purpose and every page refresh logs
the user out.

Two guards are mandatory and both are specified in `P2-T4.1`: a module-level single-flight
promise around the refresh call, and a module-level "bootstrap already started" flag.
`main.tsx` renders inside `<React.StrictMode>`, which double-invokes effects in development;
under rotation (D-017) a second refresh presents an already-rotated token, the server reads it
as a replay, the family is revoked, and the developer is logged out on page load by what looks
like a backend bug. The same hazard applies to any two API calls that 401 concurrently.

**D-026 — No frontend test runner in Phase 2.** The stack the constitution pins names no
JavaScript test runner, and adding vitest would be a new dependency for one phase. The
frontend gate stays `npx tsc -b` + `npm run lint` + `npm run build`, plus an explicit live
smoke in each frontend plan's Verification section. Revisit in Phase 5 (REQ-057) when the
shared component set lands and there is materially more client logic to protect; note that
the refresh interceptor is the riskiest untested code in the project as a result.

**D-027 — The refresh cookie's `Secure` flag is derived from `settings.debug`.**
`secure=not get_settings().debug`. `.env.example` ships `DEBUG=true` for local HTTP and
production sets it false, so the signal already exists and no new environment variable is
needed (D-016). One helper sets and deletes the cookie so the attributes cannot drift apart —
a delete whose `Path` or `SameSite` differs does not match, and the browser keeps sending a
revoked token after logout.

Recorded explicitly because it is the kind of thing a later agent "fixes": `SameSite=Lax`
plus `Path=/auth` is what makes `/auth/refresh` and `/auth/logout` CSRF-safe, since Lax
withholds the cookie on cross-site POSTs. **Never change it to `None`.** D-012 makes
everything same-origin, so there is no reason to.

**D-028 — Email is normalised with `.strip().lower()` at every auth boundary.** The
`users.email` unique constraint is case-sensitive, so `Admin@X` and `admin@x` would otherwise
be two accounts. Normalising at the boundary fixes it without a schema change; a `citext`
column or a functional unique index would be a migration and is not warranted. **Carried into
Phase 3: `POST /api/users` (REQ-030) must normalise identically**, or it will create accounts
that cannot log in.

**D-029 — Two constitution corrections, applied 2026-08-12.**
1. "Testing and done" said `tsc --noEmit`. The root `dashboard/tsconfig.json` is a solution
   file with `"files": []`, so that command type-checks **zero files** and exits 0
   unconditionally — it is what let a dashboard that did not compile at all be reported as
   clean (Blockers → B-1). Corrected to `npx tsc -b`, with the trap named inline so it cannot
   quietly return. REQ-009's acceptance criterion was corrected in the same pass.
2. The stack pinned "React Router v6", but `dashboard/package.json` has shipped
   `react-router-dom ^7.18.2` since Phase 1 and the tree builds against it. The APIs actually
   used (`BrowserRouter`, `Routes`, `Route`, `Navigate`, `NavLink`, `useLocation`,
   `useNavigate`) are unchanged between v6 and v7. Corrected to v7 rather than left as a
   knowingly false pin that would misdirect every future frontend task. **Surfaced to the
   user as a spec amendment** — if the intent was genuinely to pin v6, the fix is a
   downgrade in `package.json`, not a doc edit, and that is a code change no requirement has
   asked for.

---

## Assumptions

IDs are never reused. Rows promoted to confirmed decisions stay listed so that requirements
citing them remain traceable.

| ID | Assumption | Requirements at risk if wrong |
|---|---|---|
| ~~A-1~~ | **CONFIRMED 2026-08-10 → D-002.** The dashboard is TypeScript. No longer an assumption. | — |
| ~~A-2~~ | **CONFIRMED 2026-08-10 → D-014.** Partial unique index prevents double-booking. No longer an assumption; REQ-008's `[A]` marker is stale and should be dropped at the next `REQUIREMENTS.md` pass. | — |
| ~~A-3~~ | **CONFIRMED 2026-08-10 → D-012.** Browser→API traffic is same-origin, dev and prod. No longer an assumption; the `[A]` marker on REQ-009's proxy criterion is stale. | — |
| ~~A-4~~ | **CONFIRMED 2026-08-12 → D-015.** No longer an assumption. The settled contract is broader than A-4 stated: the refresh token is transported as an HttpOnly cookie **and** returned in the response body, and `/auth/refresh` reads the cookie first with a body fallback. REQ-021's `[A]` transport marker has been dropped. | — |
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

**OQ-4 — RESOLVED 2026-08-12: the recommended default, cookie first with a body fallback.**
_(was: shapes all of Phase 2)_ The user confirmed the default verbatim. Recorded as **D-015**;
assumption **A-4 is settled**; REQ-021's `[A]` transport marker has been dropped. **Neither
frozen document is amended** — that was the point of the option chosen. The cookie-only
alternative, which would have required a `docs/api-design.md` amendment, is closed.

Resolved alongside it, in the same user decision and recorded as separate entries because
they are separately reversible: token lifetimes (**D-016**), rotation and server-side
revocation (**D-017**, which added **REQ-02A**), and first-admin seeding (**D-018**).

_Original question, retained for audit:_

**OQ-4 — `/auth/refresh` contract: cookie or request body?** _(did not block Phase 1)_
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

**OQ-7 — Is there any brute-force protection on `POST /auth/token`?** _(opened 2026-08-12;
blocks nothing in Phase 2)_
- No requirement asks for one, and the constitution forbids inventing an endpoint or feature
  no REQ requested — so Phase 2 ships none, deliberately rather than by oversight.
- The gap is real: `/auth/token` is the only unauthenticated write surface in the system, it
  is reachable from the public internet in Phase 8, and there is no lockout, no throttle, and
  no CAPTCHA. bcrypt's work factor makes online guessing slow, not impossible.
- Redis is already connected and unused outside Phase 7, so a per-IP and per-email sliding
  window is a small service function, not an architecture change.
- **Recommended default: defer to Phase 8** and record it here as a known gap, so it is
  weighed alongside TLS termination and the public webhook rather than bolted on. Adding it
  now is one new REQ and one new task in Plan 02-03; adding it later costs the same. Nothing
  in Phase 2's shape changes either way, which is why it is deferred rather than blocking.
- If the user wants it now, say so and it becomes REQ-02B.

**OQ-8 — Where does a tutor log out?** _(opened 2026-08-12; default applied, not blocking)_
- `docs/admin-dashboard-design.md:52-64` shows Logout in the admin sidebar and a strictly
  three-item tutor nav — `My Schedule | My Sessions | Time Off` — with no logout anywhere.
  `TutorNav.tsx` faithfully implements exactly that, so a tutor currently has no way to end a
  session, which cannot be the intent once real auth exists.
- **Default applied in `P2-T5.2`:** Logout goes in the tutor **desktop sidebar footer**, with
  the same treatment as the admin sidebar's, and on **mobile** as an icon button in the
  existing top bar. The documented three-tab bottom bar stays at exactly three tabs, because
  REQ-010's acceptance criterion counts them.
- Reported as an addition to `docs/admin-dashboard-design.md`; `docs/` is not edited (A-6).
- If the user prefers a different placement — a fourth tab, an avatar menu, a settings page —
  `P2-T5.2` owns two files and is cheap to re-run.

### Detail-level — defaults applied, execution is not blocked

- **Dashboard package manager:** npm with a committed `package-lock.json`, matching the
  deleted scaffold.
- **PostgreSQL and Redis versions:** `postgres:17-alpine`, `redis:7-alpine`.
- **Seeding the first admin user:** ~~deferred to Phase 2~~ — **settled 2026-08-12 as D-018**,
  a CLI seed command and nothing else. Phase 1 shipped an empty database on purpose.
- **Backend test database (Phase 2):** a separate `<database>_test` database created by a
  session-scoped pytest fixture, built with `Base.metadata.create_all` (explicitly permitted
  in tests by the constitution) and torn down per test by transaction rollback. The migration
  is verified separately by `alembic upgrade/check/downgrade`, not by the fixture. Rejected:
  running Alembic from a fixture (slow, and couples every test to migration state) and a
  shared schema inside the primary database (PostgreSQL enum types are schema-scoped and it
  gets messy fast).
- **Auth module placement (Phase 2):** `api/app/security.py` (pure primitives) and
  `api/app/dependencies.py` (FastAPI principal + RBAC helpers) sit at the application level
  alongside `db.py`, `config.py`, and `redis_client.py`. They are neither routers nor
  services, and the constitution's `routers/ → services/ → models/` layering is about
  business logic, which these contain none of.
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

**Updated 2026-08-12.** Every open question now has either a confirmed answer (OQ-1, OQ-2,
OQ-3, **OQ-4**) or a stated default that does not block execution (OQ-5, OQ-6, OQ-7, OQ-8).
No planning decision is outstanding, and **nothing blocks the dispatch of any Phase 2 task**.

Blocker **B-1 above is historical and resolved** — the `src/ui/` displacement was repaired
during the Phase 1 gate and the dashboard has compiled since (`01-SUMMARY.md`, "Two defects
found and repaired"). It is retained because it is the origin of the `tsc --noEmit` finding
that D-029 acts on. The only live impediment in the project is the browser-tooling gap
recorded in the Position section, which blocks Phase 1's REQ-010 and the browser half of
Phase 2's frontend verification, and which no planning decision can clear.
