# TutorLink — Roadmap

Status values: `planned` · `in-progress` · `verified` · `blocked`

| # | Phase | Goal | Requirements | Status |
|---|---|---|---|---|
| 1 | Foundation | A runnable walking skeleton: four services up via Compose, full schema migrated, dashboard shell rendering. | REQ-001 … REQ-013 | verified |
| 2 | Auth & RBAC | Real login end to end: JWT issue/refresh with rotation and server-side revocation, role scoping enforced server-side, dashboard guards, seeded admin. | REQ-020 … REQ-029, REQ-02A | verified |
| 3 | Core CRUD API | Every non-scheduling resource readable and writable: users, subjects, clients, children, tutors, tutor-subjects. | REQ-030 … REQ-036 | planned |
| 4 | Scheduling engine | Availability, exceptions, the three-step slot query, and bookings with conflict handling. | REQ-040 … REQ-045 | planned |
| 5 | Admin dashboard | The six admin views bound to live data, with the shared table/slide-over component set. | REQ-050 … REQ-058 | planned |
| 6 | Tutor dashboard | The three tutor views, plus proof that tutor scoping holds at the network layer. | REQ-060 … REQ-063 | planned |
| 7 | WhatsApp bot | Twilio webhook, signature validation, Redis conversation state machine, intake and booking flows. | REQ-070 … REQ-076 | planned |
| 8 | Deployment | Production Compose overlay on EC2, HTTPS webhook, managed-service migration path. | REQ-080 … REQ-082 | planned |

**Phase 1 is `verified` as of 2026-08-12.** All thirteen requirements are proven. REQ-010,
the last open one, was verified in a real browser on 2026-08-12 once the Claude-in-Chrome
extension was connected — the third attempt, and the first with browser tooling actually
available. Both shells were exercised at 375px and 1280px in both themes, the login card's
four visual states were driven, and contrast was **measured from the rendered DOM** rather
than computed from CSS token values.

That measurement found and fixed one WCAG AA defect: the dark-theme input border sat at
2.47:1 against its own composited fill, below the 3:1 required for UI component boundaries.
Cause was `dark:bg-input/30` in shadcn's stock `Input` — a 30%-opacity fill of the border
token itself, which nearly dissolved the border into its own background. Removed; the border
now measures 3.41:1. Light theme was never affected (it used `bg-transparent`, 3.47:1).

## Ordering rationale

- **1 before everything.** Nothing can be built or verified until the stack boots and the
  schema exists.
- **2 before 3–6.** Every `/api/*` route carries the auth dependency and the RBAC scoping
  rule per the constitution; retrofitting it across finished routers is strictly worse
  than having the dependency available before the first router is written.
- **3 and 4 are largely parallel** once auth lands. They share the service-layer pattern
  but touch disjoint tables and routers. Plan them as concurrent phases if the user wants
  throughput; the only real coupling is that bookings (4) reference tutors and subjects
  (3), which the Phase 1 schema already provides.
- **5 and 6 depend on 3 and 4** for the endpoints they render, but are independent of each
  other and should be dispatched together.
- **7 depends on 4** — the bot's entire purpose is to drive the slot query and create
  bookings. It depends on nothing in 5 or 6.
- **8 last**, and deliberately thin. It is a deployment of whatever exists.

## Phase 1 plans

- `phases/01-foundation/01-01-PLAN.md` — backend service skeleton and data layer
- `phases/01-foundation/01-02-PLAN.md` — dashboard scaffold and app shell
- `phases/01-foundation/01-03-PLAN.md` — container orchestration and repository hygiene

## Phase 2 plans

- `phases/02-auth-rbac/02-01-PLAN.md` — backend auth foundations (security primitives,
  revocation store and migration `0002`, live-database pytest harness)
- `phases/02-auth-rbac/02-02-PLAN.md` — auth service and the RBAC dependency
- `phases/02-auth-rbac/02-03-PLAN.md` — `/auth` endpoints, error envelope, first-admin seed
- `phases/02-auth-rbac/02-04-PLAN.md` — dashboard auth client and login
- `phases/02-auth-rbac/02-05-PLAN.md` — route guards, D-013 discharge, and logout

Eleven tasks across five plans. Four are dispatchable immediately (`P2-T1.1`, `P2-T1.2`,
`P2-T1.3`, `P2-T4.1`); the critical path is three deep,
`P2-T1.1 → P2-T2.1 → P2-T3.1`. Plan 02-04 was deliberately split from the backend plans and
started in the first block: the HTTP contract is frozen in `02-CONTEXT.md`, so the dashboard
does not have to wait for the API to exist in order to be built — only to be smoke-tested.

**Phase 2 started with Phase 1 still `blocked`.** Nothing in Phase 2 depends on REQ-010: the
shell compiles, builds, and is served. Phase 2 does edit `Login.tsx`, `AdminSidebar.tsx`, and
`TutorNav.tsx`, so when browser tooling becomes available, REQ-010's QA should be run against
the Phase 2 tree rather than the Phase 1 tree. Phase 2 introduces no new responsive layout.

Phases 3–8 have a `NN-CONTEXT.md` stub only. Do not expand them into task plans until Phase 2
is verified.
