# Phase 1 — Foundation · Context

## Goal

A walking skeleton. From a clean clone: `cp .env.example .env`, `docker compose up`,
`docker compose run --rm api alembic upgrade head`, then `http://localhost:5173` renders a
styled dashboard shell and `http://localhost:8000/health/ready` reports both PostgreSQL and
Redis healthy.

Nothing in this phase implements a feature. It implements the ground everything else
stands on, plus the complete database schema.

## Scope boundary

**In:** repository layout, FastAPI app + typed settings + DB session + Redis client +
health probes, all nine ERD tables as models, one Alembic migration, Vite + React +
TypeScript dashboard with routing/query/state/HTTP wired, responsive app shell and login
presentation, Dockerfiles, `docker-compose.yml`, `.env.example`, root `.gitignore`,
corrected `Readme.md`.

**Out, and deliberately so:**
- Auth of any kind. `/login` submits nothing. Route guards read a placeholder store value.
- Every `/api/*` endpoint. There are none in this phase — only `/health` and `/health/ready`.
- Twilio, webhooks, TwiML, conversation state. Redis is connected but unused.
- Data-bound dashboard views, tables, forms, slide-overs.
- Seed data. The database is empty after migration, on purpose.
- CI, GitHub Actions, deployment assets.

**Deferred, not dropped:** seeding the first admin (Phase 2), the production Compose
overlay (Phase 8), CI (unscheduled — raise with the user after Phase 2).

## Definition of done for the phase

1. `docker compose up` reports four services; `postgres` and `redis` pass their
   healthchecks and `api` starts only after they do.
2. `docker compose run --rm api alembic upgrade head` creates nine tables from empty, and
   `alembic downgrade base` reverses it cleanly.
3. `curl localhost:8000/health` → 200. `curl localhost:8000/health/ready` → 200 with both
   dependencies `ok`. With `docker compose stop redis`, `/health/ready` → 503 and `/health`
   still → 200.
4. `http://localhost:5173/login` renders the styled login form; the admin shell shows a
   sidebar at desktop width and a hamburger at 375px with no horizontal scroll.
5. `docker compose run --rm dashboard npm run build` and `npx tsc --noEmit` are clean.
6. `git status` is clean afterwards — no build output, no `.env`, no `node_modules`.

## Decisions carried into this phase

From `STATE.md`: D-001 (layout), D-002/OQ-1 (TypeScript), D-003 (walking skeleton with a
complete data layer), D-005 (sync SQLAlchemy), D-006 (Python 3.12 / Node 22 in containers),
D-007 (uv), D-008 (two health endpoints), D-009 (no migrate-on-boot), D-010 (native enums),
D-011 (ERD constraints implemented as intended), D-012/OQ-3 (Vite proxy, same-origin).

## Open questions affecting this phase

- **OQ-1 (TypeScript vs JavaScript)** — blocks T2.1 and T2.2 if the user disagrees with the
  default. Planned as TypeScript.
- **OQ-2 (double-booking index)** — blocks T1.2 only in the sense that the index is either
  in the initial migration or not. Planned as included.
- **OQ-3 (proxy vs CORS)** — shapes `vite.config.ts` in T2.1 and the compose networking in
  T3.1. Planned as proxy.

All three ship with defaults applied. Execution proceeds; if the user overrides one, the
affected task is small and re-runnable.

## Interfaces frozen by this phase

These are contracts other Phase 1 tasks are written against without waiting:

- `api/app/config.py` exports `Settings` (pydantic-settings `BaseSettings`) and a cached
  `get_settings()`.
- `api/app/db.py` exports `Base` (the single `DeclarativeBase` subclass), `engine`,
  `SessionLocal`, and a `get_db()` generator dependency.
- `api/app/redis_client.py` exports `redis_client` and `check_redis() -> bool`.
- The API image installs dependencies with `uv sync --frozen` from `api/pyproject.toml` +
  `api/uv.lock`; its entrypoint is `uvicorn app.main:app --host 0.0.0.0 --port 8000`.
- The dashboard image installs with `npm ci` from `dashboard/package.json` +
  `dashboard/package-lock.json`; its dev command is `npm run dev -- --host 0.0.0.0`.
- Compose service names are exactly `postgres`, `redis`, `api`, `dashboard`. The dev proxy
  target is `http://api:8000`.
- Environment variable names are exactly: `DATABASE_URL`, `REDIS_URL`, `SECRET_KEY`,
  `DEBUG`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`,
  `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `VITE_API_BASE_URL`,
  `VITE_API_PROXY_TARGET`.

Because these are fixed here, T1.1, T2.1, T3.1, and T3.2 can all start at the same time.
