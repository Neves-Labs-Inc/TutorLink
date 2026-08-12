# TutorLink Constitution

## Stack — pinned, do not substitute
- Backend: Python 3.12 (`python:3.12-slim`), FastAPI, SQLAlchemy 2.0 **sync** + `psycopg[binary]` v3, Alembic, Pydantic v2 + pydantic-settings, redis-py sync, `uv` for deps (`pyproject.toml` + `uv.lock`), ruff for lint/format, pytest.
- Frontend: Node 22 (`node:22-alpine`), Vite + React 19 + **TypeScript**, React Router v7, TanStack Query v5, Zustand, Tailwind CSS, shadcn/ui, Axios, ESLint.
- Data: PostgreSQL 17, Redis 7. All local dev runs through the root `docker-compose.yml`.

## Layout — authoritative
- `api/` FastAPI service (bot + REST, one process). `dashboard/` React app. `docker/` Dockerfiles only. `docker-compose.yml`, `.env.example` at repo root. `docs/` is spec, not code.
- Backend layering: `routers/` → `services/` → `models/`. Routers do HTTP + auth + `Depends(get_db)` only; all business logic in `services/`. `schemas/` (Pydantic) is the only shape crossing the HTTP boundary — never return an ORM object from a route.

## Rules
- Every schema change ships an Alembic migration in the same task. Never `Base.metadata.create_all` outside tests. Migrations are applied by an explicit command, never on app startup.
- UUID primary keys, `TIMESTAMPTZ` audit columns, soft delete via `is_active`. Never hard-delete a row that has FK children.
- Every `/api/*` route carries the JWT dependency. Tutor-role requests are scoped by `tutor_id` from the token; cross-tutor access returns 403, never an empty 200.
- Errors are `HTTPException` with `{"detail": ...}`. 400 validation · 401 missing/bad JWT · 403 forbidden · 404 missing · 409 conflict.
- Validate `X-Twilio-Signature` before any webhook side effect.
- Secrets come only from env via `Settings`. Never commit `.env`. Never hardcode a key or token. Never log a token, password, Twilio auth token, parent address, or access code.
- Dates/times use `DATE` + `TIME` as the ERD specifies; all `TIMESTAMPTZ` values are UTC.
- Browser talks to the API same-origin through the Vite dev proxy. Do not add CORS wildcards to work around it.

## Testing and done
- Backend: pytest, run in-container. Every service function with a branch gets a test. Frontend: `npx tsc -b`, `npm run lint`, `npm run build` all clean — never `tsc --noEmit`, which checks zero files here.
- Done = the cited REQ's acceptance criteria are observable, the migration applies from an empty database, and `docker compose up` still brings every service healthy.

## Never
- Never write source outside `api/`, `dashboard/`, `docker/`, and root config files.
- Never edit anything in `docs/` to match the code. If code must diverge from the design docs, report it as spec drift.
- Never add a runtime dependency not named above without recording it in `STATE.md` Decisions.
- Never invent an endpoint, column, or view that no REQ asked for.
