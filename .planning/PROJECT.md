# TutorLink — Project

## Vision

A WhatsApp-first scheduling system for a small tutoring business. Parents book tutoring
sessions for their children by messaging a Twilio WhatsApp number; a conversational bot
runs intake and matching and writes confirmed bookings. Admins run the roster, the weekly
availability, exceptions, and bookings from a web dashboard. Tutors get a read-only view
of their own schedule and sessions.

Source specs (authoritative, do not edit to match code):
- `/Users/franklin.filho/Docs/Freelance/MsHelpingHands/TutorLink/Readme.md`
- `/Users/franklin.filho/Docs/Freelance/MsHelpingHands/TutorLink/docs/erd.md`
- `/Users/franklin.filho/Docs/Freelance/MsHelpingHands/TutorLink/docs/api-design.md`
- `/Users/franklin.filho/Docs/Freelance/MsHelpingHands/TutorLink/docs/admin-dashboard-design.md`

## What "the base" means in this milestone

Phase 1 delivers a **walking skeleton, not broad scaffolding**. The bar is: a developer
clones the repo, copies `.env.example`, runs `docker compose up`, applies one migration,
and has four live services where the browser can reach a rendered dashboard and the
dashboard's HTTP path to the API is proven working.

Concretely in scope for Phase 1:
- One FastAPI service that boots from environment config and exposes liveness plus a
  readiness probe that actually round-trips PostgreSQL and Redis.
- The **complete ERD** as SQLAlchemy models plus a single initial Alembic migration.
  The schema is the most stable artifact in the design docs and it is the widest unblock
  for every later phase, so it is worth doing once, now, in full.
- A Vite + React + TypeScript dashboard that boots with routing, data-fetching, state, and
  an HTTP client wired, plus the responsive app shell and login screen presentation.
- `docker-compose.yml`, `docker/` Dockerfiles, `.env.example`, root `.gitignore`.
- `Readme.md` corrected so its documented layout matches the repository.

Explicitly **not** in Phase 1:
- No authentication, no JWT issuing, no route guards with real tokens.
- No business endpoints — no tutors, clients, bookings, subjects, availability, slots.
- No Twilio webhook, no conversation state machine, no bot logic.
- No real dashboard data views, no tables bound to an API.
- No CI pipeline, no AWS deployment assets.

Rationale for the split: everything above the data layer is where design judgment and
rework live. Everything at or below it is fully specified by `docs/erd.md`. Build the
specified part completely and defer the judgment-heavy part until the foundation is
validated by the user.

## Constraints

- Single developer / freelance engagement. Optimise for a small number of moving parts
  over architectural sophistication.
- One FastAPI process serves both the Twilio webhook and the dashboard REST API. The bot
  calls its own service layer in-process, not over HTTP.
- Everything must run locally with `docker compose up`. No cloud dependency to develop.
- Twilio sandbox in dev; ngrok tunnels the webhook.
- Production target is a single EC2 box running Compose, migrating to RDS + ElastiCache
  later. Do not design for ECS/Kubernetes now.
- Expected volume is small: low hundreds of bookings and a handful of concurrent
  dashboard users. Sync SQLAlchemy is adequate and is chosen deliberately.

## Success metrics

- A parent can complete a booking end-to-end over WhatsApp without human intervention.
- The three-step availability query never returns a slot that is exceptioned or already
  booked, and the database makes a double-booking structurally impossible.
- An admin can add a tutor, set their weekly availability, add a vacation, and see the
  resulting booking within the dashboard on both desktop and iPhone.
- A tutor logging in can see their own schedule and sessions, and can see nothing
  belonging to another tutor.

## Non-goals

- No payments, invoicing, or pricing.
- No tutor self-service time-off requests (admin-managed only; flagged as a future
  decision in `docs/admin-dashboard-design.md`).
- No SMS/email channel, no push notifications, no calendar (iCal/Google) sync.
- No multi-tenant support — one tutoring business per deployment.
- No i18n, no timezone-per-user handling. One business timezone.
- No recurring/series bookings. Each booking is a single dated session.
- No public-facing marketing site.
