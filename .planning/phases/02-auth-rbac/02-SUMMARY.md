# Phase 2 — Authentication and RBAC · Summary

**Status:** verified. **Merged SHA:** recorded in `STATE.md` Position.
**Closed:** 2026-08-12.

Eleven tasks across five plans, executed by seven agents in three dispatch blocks.
`verifier` returned PASS over the combined result; `qa-visual` returned PASS across two
browser passes; an independent security review returned no critical and no high findings.

## What shipped

### Backend — `api/`
| Surface | File |
|---|---|
| bcrypt hashing, JWT mint/decode, `typ` enforcement | `app/security.py` |
| JWT settings (15 min access, 7 day refresh) + `SECRET_KEY` validator | `app/config.py` |
| `TokenPair`, `RefreshRequest` | `app/schemas/auth.py` |
| `refresh_tokens` model — 7 columns, 2 FKs, no token or hash stored | `app/models/refresh_token.py` |
| Migration `0002` | `alembic/versions/0002_refresh_tokens.py` |
| Credential check, token issue, rotation, family revocation | `app/services/auth_service.py` |
| **Reusable auth dependency + tutor-scoping helper** | `app/dependencies.py` |
| `/auth/token`, `/auth/refresh`, `/auth/logout`, cookie helper | `app/routers/auth.py` |
| Router mount + 422→400 handler | `app/main.py` |
| Idempotent first-admin seed | `app/cli.py` |

Tests: `test_security.py`, `test_refresh_token_model.py`, `test_auth_service.py`,
`test_dependencies.py`, `test_cli_seed.py`, `test_auth_routes.py`, `test_config.py`,
plus the live-PostgreSQL harness in `conftest.py`. **110 passing.**

### Frontend — `dashboard/src/`
`lib/auth.ts`, `lib/api.ts` (axios interceptors, single-flight refresh), `stores/authStore.ts`,
`hooks/useAuth.ts`, `components/auth/AuthProvider.tsx`, `App.tsx`, `pages/Login.tsx`,
`components/layout/RouteGuard.tsx`, `AppShell.tsx`, `AdminSidebar.tsx`, `TutorNav.tsx`.

## REQ IDs closed

REQ-020, REQ-021, REQ-022, REQ-023, REQ-024, REQ-025, REQ-026, REQ-027, REQ-028, REQ-029,
and **REQ-02A** (new this phase). `verifier` mapped every one to evidence; no requirement
drifted and nothing shipped that no REQ covers.

REQ-024 is scope-clarified rather than fully exercised: Phase 2 mounts **zero `/api/*`
routes** by design, so the RBAC matrix is proven on probe routes inside the test module.
Applying it to real endpoints is a standing obligation on Phases 3, 4 and 6, with REQ-063
as the end-to-end proof.

## Decisions discharged

**D-013 — discharged by deletion.** The dev-only `import.meta.env.DEV` auth bypass in
`RouteGuard`/`AppShell` is gone. Proven absent from source, from the built bundle, and from
the Vite dev server's transformed modules. A seeded admin now exists, so the real flow is
locally exercisable and no second auth path survives.

## Deviations from plan, and why

1. **`SELECT ... FOR UPDATE` on the presented refresh row** (`auth_service.py:111`) — not in
   the plan. Without it two concurrent refreshes both rotate, the family ends with two live
   tokens, and replay is never detected. The security review proved the fix works: eight
   simultaneous refreshes of one token produced exactly **one 200 and seven 401s**.
2. **`db.commit()` inside the `except RefreshTokenReused` handler** (`routers/auth.py:70`).
   The service may not commit and `get_db` never commits, so without this the family
   revocation was rolled back and the entire revocation feature was silently inert. The
   plan's own test could not catch it — the shared `api` fixture uses one long-lived session,
   which hides a missing commit. A second harness reading through a **separate session** was
   added, and proven load-bearing by deleting the commit and watching only that test fail.
3. **`api/tests/test_models.py`** — a Phase 1 test asserted exactly nine tables and broke on
   REQ-02A's tenth. Repaired by the orchestrator (it was owned by no task): the ERD nine are
   still asserted exactly, with `refresh_tokens` declared in a separate `NON_ERD_TABLES` set
   so the ERD invariant still holds.
4. **`SECRET_KEY` hardening** — added after the security review, not planned. See amendments.

## Spec drift — reported, never patched into `docs/`

1. `POST /auth/logout` does not exist in `docs/api-design.md`. Introduced by REQ-02A.
2. `POST /auth/refresh` returns `refresh_token` in its body, beyond the documented fields.
3. `POST /auth/token` is form-encoded, not JSON — the documented OAuth2 password flow *is*
   form-encoded.
4. The JWT carries `typ`, `jti`, `iat` beyond the four documented claims. `typ` is
   load-bearing: without it a 7-day refresh token is a valid access token.
5. Validation errors return 400, not FastAPI's 422 — the doc's error table lists 400 only.
6. Tutor logout has no affordance in `docs/admin-dashboard-design.md`'s three-item tutor nav.
   Placed in the desktop sidebar footer and the mobile top bar; the documented three-tab
   bottom bar is untouched.
7. `/docs` has no Authorize button in this phase — FastAPI emits `securitySchemes` only when
   a mounted route depends on the scheme, and Phase 2 mounts no `/api/*` route. It appears
   automatically when Phase 3 mounts its first. The plan's criterion was unsatisfiable
   without inventing a route, which is forbidden.

## Verification evidence

- Backend: **110 passed**, `ruff check .` clean.
- Frontend: `npx tsc -b --force`, `npm run lint`, `npm run build` all clean, in-container.
  (`tsc --noEmit` remains a no-op here and was never accepted as evidence.)
- Migration chain proven from an **empty scratch database**: `base → 0001 → 0002`,
  `alembic check` clean, `downgrade base` leaves only `alembic_version`.
- Rotation and revocation proven live over HTTP with durability confirmed through a
  **separate `psql` connection**: replaying a consumed token 401s, the whole family is
  revoked, and the successor token stops working.
- Browser (two `qa-visual` passes, admin and tutor): login, wrong-password error, logged-out
  redirect, logout for both roles, tutor-on-admin-route → `/schedule`, and — the phase's
  highest risk — **exactly one `POST /auth/refresh` per reload** for both roles.
- Security review: no critical, no high. Claim injection neutralised (a validly-signed token
  claiming `role=admin` was served as `tutor`, because role is read from the DB row);
  `alg:none`, wrong-key, algorithm-substitution, missing `exp`/`typ`, and refresh-as-access
  all rejected; login enumeration indistinguishable by body, status, and timing
  (174.9 ms vs 174.6 ms median).

## Carried into Phase 3 — read before writing the first router

**Security finding M1 is FIXED, and it changed the contract.** `resolve_tutor_scope` no
longer exists. It used to return a `uuid.UUID | None` that a router could silently discard —
correct for an admin, correct for a cross-tutor reach, and a full cross-tutor leak for a
tutor who passed no `tutor_id`. The user directed that the failure mode be made impossible
rather than merely tested against.

The replacement, in `api/app/dependencies.py`:

- **`get_tutor_scope` (`:248`), exposed as `TutorScope` (`:273`)** — the decision table now
  runs as a FastAPI dependency, so there is no return value to drop. The requested
  `tutor_id` binds from the path or query string automatically.
- **`ResolvedTutorScope` (`:160`)** — an object whose `tutor_id` property must be *read*;
  reading it is what marks the scope applied.
- **`_guard_unapplied_scope` (`:227`)**, a `do_orm_execute` listener installed at `:266` and
  removed at `:270` — while the scope is unread, the request's `Session` refuses ORM
  SELECT/UPDATE/DELETE against any tutor-owned table, raising before the statement reaches
  PostgreSQL. "Tutor-owned" is decided by shape (`_is_tutor_owned`, `:219`): any mapper whose
  table carries `tutor_id`, plus `tutors`. A table added in Phase 4 is guarded the day it
  gains the column.

The decision table itself is byte-identical, moved to `_decide_tutor_scope` (`:192-216`).
Cross-tutor is still **403 with `{"detail": ...}`**, raised during dependency resolution, so
it still beats the tripwire.

**How a Phase 3 router uses it — one line, one dependency:**

```python
@router.get("/api/bookings", response_model=list[BookingRead])
def list_bookings(scope: TutorScope, db: DbSession):
    return booking_service.list_bookings(db, tutor_id=scope.tutor_id)   # None means "all"
```

The rule has exactly one branch: **list routes** take `TutorScope` and pass `scope.tutor_id`
into the service; **load-one-row-by-id routes** take `Principal`, load, then call
`assert_can_access_tutor` on the row's owner — that pattern must query before it can know the
owner, so it deliberately does not arm the guard. Picking the wrong one fails loudly and the
exception text names the right one.

**What the guard does not catch**, stated plainly: it catches *forgetting*, not *sabotage*.
`_ = scope.tutor_id` followed by an unfiltered query disarms it, and it does not fire on raw
`db.execute(text(...))` or on a session obtained outside `Depends(get_db)`. Those are
deliberate acts, not the accident the finding described.

**Stale references:** `02-CONTEXT.md:214,218,299` and `02-02-PLAN.md:213,220,237` still
describe the superseded `resolve_tutor_scope` contract. They are planner-owned and were left
unedited; this summary is the record of what actually shipped. `docs/` never mentioned it.

Also open: **M3** — the refresh cookie's `Secure` flag is keyed off `DEBUG`, which
`.env.example` ships as `true`; a deployment that copies it serves a 7-day session cookie
without `Secure`. Fix belongs with Phase 8's environment work. **OQ-7** (login rate limiting)
remains deliberately deferred to Phase 8.
