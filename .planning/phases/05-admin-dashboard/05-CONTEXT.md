# Phase 5 — Admin dashboard views · Context (stub)

Not yet planned. Depends on Phases 3 and 4 for the endpoints it renders. Independent of
Phase 6 — dispatch the two together.

**Goal:** the six admin views from `docs/admin-dashboard-design.md` bound to live data,
plus the shared component set.

**Requirements:** REQ-050 … REQ-058.

**Must be settled before planning:**
- `/dashboard` widgets need counts and "this week" aggregates that no endpoint in
  `docs/api-design.md` provides. Either add a `GET /api/stats/overview` requirement or
  compose the widgets from existing list endpoints and accept the extra round trips.
- `/subjects` shows "number of tutors teaching it", which `GET /api/subjects` does not
  return. Same choice.
- Whether the weekly availability grid on `/tutors/{id}` edits in place or through a form.

**Decomposition note:** the shared components (REQ-057) are the only real dependency
between views. Build them in the opening task, then the six views are six independent
tracks with no shared writable file.
