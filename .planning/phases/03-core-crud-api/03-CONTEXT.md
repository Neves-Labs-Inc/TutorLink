# Phase 3 — Core CRUD API · Context (stub)

Not yet planned. Depends on Phase 2's auth dependency and tutor-scoping helper.

**Goal:** users, subjects, clients, children, tutors, and tutor-subject assignments,
readable and writable exactly as `docs/api-design.md` specifies.

**Requirements:** REQ-030 … REQ-036.

**Must be settled before planning:**
- Pagination. `docs/api-design.md` returns bare arrays with no envelope. At the stated
  scale that is fine; decide explicitly whether to keep it or introduce a page envelope now
  rather than breaking the dashboard later.
- Whether `POST /api/clients` with an existing `phone_number` upserts or 409s — the bot
  will hit this on every returning-client intake.
- Soft-delete read semantics: does `GET /api/tutors` ever return inactive rows, or only
  behind `?is_active=false`.

**Decomposition note:** users/subjects, clients/children, and tutors/tutor-subjects touch
disjoint tables and routers. Plan them as three concurrent tracks sharing only the service
layer pattern established by whichever lands first — freeze that pattern in the plan so
none of them has to wait.
