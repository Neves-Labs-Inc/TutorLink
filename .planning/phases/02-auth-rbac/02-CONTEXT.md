# Phase 2 — Authentication and RBAC · Context

Repository root: `/Users/franklin.filho/orca/workspaces/TutorLink/boxfish`. All paths below
are relative to it. Phase 1 is committed at `684a015`; the tree is clean.

Read `.planning/CONSTITUTION.md` and the Decisions section of `.planning/STATE.md`
(**D-012** and **D-013** are directly binding) before starting any task in this phase.

---

## Goal

A real login, end to end. `POST /auth/token` issues a JWT pair for a seeded admin;
`POST /auth/refresh` rotates it; `POST /auth/logout` kills it server-side; a reusable
FastAPI dependency turns a bearer token into a typed principal; a tutor-scoping helper makes
the constitution's `tutor_id` rule mechanical for Phase 3; and the dashboard logs in, stays
logged in across a page reload, guards its routes, and logs out.

## Scope boundary

**In:**

- Backend: password hashing, JWT issue/verify, the refresh-token revocation store and its
  migration, `/auth/token`, `/auth/refresh`, `/auth/logout`, the auth dependency, the
  tutor-scoping helpers, the uniform error envelope, the first-admin seed command.
- Frontend: an auth client (login, silent refresh, bootstrap-on-load, logout), the login
  page wired to the API, route guards, logout affordances, and removal of the D-013 bypass.
- A live-PostgreSQL pytest harness, because rotation, revocation, and reuse detection are
  database behaviour and cannot be honestly tested against metadata alone.

**Out, and deliberately so:**

- **Every `/api/*` endpoint.** There are still none. Phase 2 ships the *mechanism* that
  Phase 3's first router will consume; it does not ship a route to demonstrate it on.
  Do not add `GET /api/me`, `GET /api/users`, or any other probe route — the RBAC dependency
  is exercised by probe routers that live inside the test module and are never mounted on
  `app`. See the REQ-024 amendment in `REQUIREMENTS.md`.
- Password reset, email verification, "remember me", MFA, account lockout, and login rate
  limiting (see OQ-7 — deferred with a stated default, not forgotten).
- Any user-management UI or endpoint. Creating the second user is REQ-030, Phase 3.
- Any change to `docs/`. Divergences are reported (A-6), never patched.
- Any new environment variable, and therefore any change to `.env.example`,
  `docker-compose.yml`, or `Readme.md`. See D-016. **No Phase 2 task owns a root-level file.**

**Deferred, not dropped:** login rate limiting (OQ-7, Phase 8), a frontend test runner
(D-026, revisit in Phase 5), case-insensitive email at the database level (D-028 handles it
at the boundary; a `citext` column or functional unique index would be a schema change).

## Definition of done for the phase

1. `docker compose run --rm api alembic upgrade head` applies migration `0002` from an empty
   database and `alembic downgrade base` reverses it cleanly.
2. `docker compose run --rm api python -m app.cli seed-admin` creates an admin; running it a
   second time changes nothing and exits 0.
3. `curl -s -X POST localhost:8000/auth/token -d 'username=…&password=…'` returns an access
   token, a refresh token, and a `Set-Cookie: refresh_token=…; HttpOnly; SameSite=Lax; Path=/auth`.
4. `POST /auth/refresh` with that cookie returns a **new** pair; replaying the **old** refresh
   token returns 401 and kills the whole family, so the new one stops working too.
5. `POST /auth/logout` makes the current refresh token unusable immediately.
6. Bad credentials → 401. A tutor principal reaching for another tutor's id → 403, never an
   empty 200. No bearer token → 401.
7. `docker compose run --rm api pytest -q` and `ruff check .` clean.
8. `npx tsc -b`, `npm run lint`, `npm run build` clean in `dashboard/`.
9. `grep -rn "import.meta.env.DEV" dashboard/src` returns nothing (D-013 discharged).

## Decisions settled by the user before planning — do not re-open

| # | Settled |
|---|---|
| OQ-4 | `/auth/token` sets the refresh token as an HttpOnly cookie **and** returns it in the body. `/auth/refresh` reads the cookie first, falls back to the JSON body. Both frozen docs stay accurate. → **D-015**, A-4 promoted to settled |
| Lifetimes | Access **15 minutes**, refresh **7 days**, configurable via `Settings`. → **D-016** |
| Rotation | **Rotate on use, plus a server-side revocation table.** Reuse of a rotated token revokes the entire family and returns 401. This is a **scope addition** — see **REQ-02A**. → **D-017** |
| First admin | **CLI seed command only**, idempotent, credentials from env or an interactive prompt. **No public setup endpoint, ever.** → **D-018** |

## Inherited obligations

**D-013 — the dev-only route bypass must be discharged in this phase.**
`dashboard/src/components/layout/RouteGuard.tsx:17-26` and `AppShell.tsx:16-20` carry
branches gated on `import.meta.env.DEV`. Phase 2 **deletes both** (D-019). Task `P2-T5.1`
owns this and its acceptance criteria include the grep that proves it. A Phase 2 that closes
with either branch still present is drift.

**Phase 1 REQ-010 is still unproven** and blocks Phase 1's closure, not this phase. Phase 2
edits `Login.tsx`, `AdminSidebar.tsx`, and `TutorNav.tsx`, so whenever the browser tooling
returns, REQ-010's browser QA should be re-run against the Phase 2 tree rather than the
Phase 1 tree. Phase 2 introduces no new responsive layout of its own.

---

## Frozen interfaces

These are contracts. They are fixed **here**, before any task starts, precisely so that tasks
which consume them do not have to wait for the tasks that produce them. A task that finds a
contract below unworkable must **stop and report**, not improvise a different one.

### `api/app/config.py` — new `Settings` fields (produced by `P2-T1.1`)

| Field | Type | Default |
|---|---|---|
| `jwt_algorithm` | `str` | `"HS256"` |
| `access_token_expire_minutes` | `int` | `15` |
| `refresh_token_expire_days` | `int` | `7` |

All three have defaults, so **no new environment variable is required** and `.env.example`,
`docker-compose.yml`, and `Readme.md` are untouched (D-016). `secret_key` already exists and
is the signing key.

### `api/app/security.py` — pure functions, no database (produced by `P2-T1.1`)

```python
ACCESS_TOKEN_TYPE = "access"
REFRESH_TOKEN_TYPE = "refresh"
MAX_PASSWORD_BYTES = 72          # bcrypt truncates beyond this; we reject instead

class TokenError(Exception): ...          # malformed, bad signature, expired, or wrong `typ`

@dataclass(frozen=True)
class TokenClaims:
    subject: uuid.UUID                    # `sub`
    token_type: str                       # `typ`
    jti: uuid.UUID
    expires_at: datetime                  # tz-aware UTC
    role: UserRole | None = None          # access tokens only
    tutor_id: uuid.UUID | None = None     # access tokens only
    family_id: uuid.UUID | None = None    # refresh tokens only, claim `fid`

def hash_password(plain: str) -> str
def verify_password(plain: str, hashed: str) -> bool     # False on any malformed hash
def password_is_encodable(plain: str) -> bool            # len(plain.encode()) <= 72

def create_access_token(*, user_id, role: UserRole, tutor_id: uuid.UUID | None) -> str
def create_refresh_token(*, user_id, jti: uuid.UUID, family_id: uuid.UUID) -> tuple[str, datetime]
def decode_token(token: str, *, expected_type: str) -> TokenClaims    # raises TokenError
```

`create_refresh_token` returns the token **and** its absolute expiry, because both the
revocation row and the cookie `Max-Age` need it and neither should re-derive it.

### JWT claim set

Access: `sub`, `role`, `tutor_id`, `exp`, `iat`, `typ="access"`, `jti`.
Refresh: `sub`, `exp`, `iat`, `typ="refresh"`, `jti`, `fid`.

`docs/api-design.md:70-78` documents only `sub`, `role`, `tutor_id`, `exp`. The three extra
claims are additive (D-022). `typ` is not optional: without it a refresh token is a valid
access token. A refresh token deliberately carries **no** role, so a role change takes effect
on the next refresh rather than persisting for seven days.

### `api/app/schemas/auth.py` (produced by `P2-T1.1`)

```python
class TokenPair(BaseModel):        # response of BOTH /auth/token and /auth/refresh
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"

class RefreshRequest(BaseModel):   # optional JSON body of /auth/refresh
    refresh_token: str | None = None
```

### `api/app/models/refresh_token.py` (produced by `P2-T1.2`)

```
refresh_tokens
  id             UUID   PK, server_default gen_random_uuid()   -- this IS the JWT `jti`
  user_id        UUID   FK users.id, NOT NULL, indexed
  family_id      UUID   NOT NULL, indexed
  issued_at      TIMESTAMPTZ NOT NULL default now()
  expires_at     TIMESTAMPTZ NOT NULL
  revoked_at     TIMESTAMPTZ NULL
  replaced_by_id UUID   FK refresh_tokens.id, NULL  -- rotation audit trail
```

**No token string and no hash of one is ever stored.** Possession is proven by the JWT
signature; the row exists only to answer "is this jti still live?". A leaked database
therefore leaks no usable credential.

### `api/app/services/auth_service.py` (produced by `P2-T2.1`)

```python
class AuthError(Exception): ...
class InvalidCredentials(AuthError): ...
class InvalidRefreshToken(AuthError): ...
class RefreshTokenReused(InvalidRefreshToken): ...

@dataclass(frozen=True)
class IssuedTokens:
    access_token: str
    refresh_token: str
    refresh_expires_at: datetime      # tz-aware UTC; the router uses it for cookie Max-Age

def authenticate_user(db: Session, *, email: str, password: str) -> User
def issue_token_pair(db: Session, *, user: User) -> IssuedTokens        # starts a new family
def rotate_refresh_token(db: Session, *, presented: str) -> IssuedTokens
def revoke_family_for_token(db: Session, *, presented: str) -> None      # logout; never raises
```

### `api/app/dependencies.py` (produced by `P2-T2.2`)

```python
@dataclass(frozen=True)
class CurrentUser:
    id: uuid.UUID
    email: str
    role: UserRole
    tutor_id: uuid.UUID | None

def get_current_user(...) -> CurrentUser          # 401 on missing/invalid/expired/inactive
def require_admin(...) -> CurrentUser             # 403 when role is not admin

Principal = Annotated[CurrentUser, Depends(get_current_user)]
AdminPrincipal = Annotated[CurrentUser, Depends(require_admin)]

def resolve_tutor_scope(user: CurrentUser, requested_tutor_id: uuid.UUID | None) -> uuid.UUID | None
def assert_can_access_tutor(user: CurrentUser, owner_tutor_id: uuid.UUID | None) -> None
```

`resolve_tutor_scope` is the whole point of the phase for Phase 3. Its contract:

| principal | `requested_tutor_id` | result |
|---|---|---|
| admin | `None` | `None` — meaning "no filter, all tutors" |
| admin | any UUID | that UUID, unchanged |
| tutor with `tutor_id` set | `None` | the principal's own `tutor_id` — scoping is **forced**, never optional |
| tutor with `tutor_id` set | equal to own | own `tutor_id` |
| tutor with `tutor_id` set | different UUID | **raises 403** |
| tutor with `tutor_id` **None** | anything | **raises 403** — an unlinked tutor account can read nothing |

`assert_can_access_tutor` is the row-level companion for "load by id, then check the owner":
admins always pass; a tutor passes only when `owner_tutor_id == user.tutor_id`, otherwise
**403 — never 404, never an empty 200** (constitution, `CONSTITUTION.md:15`).

### `api/tests/conftest.py` — fixtures (produced by `P2-T1.3`)

```python
client   # UNCHANGED from Phase 1: TestClient(app), no database. test_health.py depends on it.
db       # Session bound to a transaction that is rolled back after every test
api      # TestClient(app) with get_db overridden to yield `db`
```

### HTTP contract — frozen so the dashboard can be built before the API exists

| | |
|---|---|
| `POST /auth/token` | **`application/x-www-form-urlencoded`** with `username` + `password` (D-021). → 200 `TokenPair` + `Set-Cookie`. 401 `{"detail": "Incorrect email or password"}` with `WWW-Authenticate: Bearer` |
| `POST /auth/refresh` | Cookie `refresh_token` first; JSON `{"refresh_token": "…"}` fallback. → 200 `TokenPair` + a **new** `Set-Cookie`. 401 `{"detail": "Invalid refresh token"}` |
| `POST /auth/logout` | Cookie first, JSON fallback. → **204** always, with a cookie-clearing `Set-Cookie`. Never reveals whether the token was valid |
| Cookie | `refresh_token=<jwt>; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=<refresh lifetime>` and `Secure` only when `settings.debug` is false (D-012, D-027) |
| Errors | Always `{"detail": "<string>"}`. 400 validation · 401 auth · 403 forbidden · 404 missing · 409 conflict. FastAPI's default 422 is remapped to 400 (D-024) |

`Path=/auth` plus `SameSite=Lax` is what makes `/auth/refresh` and `/auth/logout` immune to
CSRF: Lax withholds the cookie on cross-site POSTs. **Do not change `SameSite` to `None`** —
D-012 makes everything same-origin, so there is no reason to and doing so re-opens CSRF.

### Dashboard contracts (produced by `P2-T4.1`)

```ts
// src/stores/authStore.ts
type AuthStatus = 'loading' | 'authenticated' | 'anonymous'
interface AuthState {
  status: AuthStatus            // starts 'loading' — the bootstrap refresh is in flight
  accessToken: string | null
  role: 'admin' | 'tutor' | null
  tutorId: string | null
  setSession(s: { accessToken: string }): void   // role/tutorId are decoded from the token
  clearSession(): void
}

// src/hooks/useAuth.ts
useAuth(): { status, role, tutorId, login(email, password), logout(), isLoggingIn, loginError }
```

`status` exists because the access token lives in memory only and dies on page reload, while
the refresh cookie survives. On mount the app attempts `/auth/refresh` exactly once; until it
settles, `RouteGuard` must render a neutral placeholder rather than redirecting to `/login` —
otherwise every reload bounces a logged-in user out (D-025).

---

## Open questions affecting this phase

Both have stated defaults; **neither blocks execution.**

**OQ-7 — brute-force protection on `POST /auth/token`.** No requirement asks for it, so per
the constitution none is being invented. Redis is already connected and a per-IP or per-email
sliding window would be a small service. **Default: defer to Phase 8** and record it as a
known gap; a public login endpoint with no throttle is the most likely real-world abuse
vector in this system. If the user wants it now, it is one new REQ and one new task.

**OQ-8 — where does a tutor log out?** `docs/admin-dashboard-design.md:52-64` shows Logout in
the admin sidebar and a strictly three-item tutor nav with none. A tutor with no way to log
out is broken. **Default: add Logout to the tutor desktop sidebar footer (same treatment as
admin) and to the tutor mobile top bar, leaving the documented three-tab bottom bar exactly
as specified.** Reported as an addition to the design doc; `docs/` is not edited.

## Carried into Phase 3

- Every `/api/*` router must use `Principal` / `AdminPrincipal` and, wherever a `tutor_id`
  is involved, `resolve_tutor_scope` or `assert_can_access_tutor`. Phase 2 exists so this is
  a one-line import, not a per-endpoint re-derivation.
- `POST /api/users` (REQ-030) must normalise email with `.strip().lower()` and hash with
  `app.security.hash_password`, matching D-028 and the seed command exactly.
- The 400-not-422 validation envelope (D-024) applies to every router written from here on.
