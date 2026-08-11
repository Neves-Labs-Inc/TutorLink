# Phase 6 — Tutor dashboard views · Context (stub)

Not yet planned. Depends on Phases 3 and 4. Independent of Phase 5.

**Goal:** `/schedule`, `/sessions`, `/time-off`, and proof that tutor scoping holds at the
network layer, not only in the UI.

**Requirements:** REQ-060 … REQ-063.

**Must be settled before planning:**
- Which week `/schedule` opens on and whether the tutor can page forward.
- Whether "past sessions" is bounded or unbounded.
- Confirm tutors remain unable to request time off (`docs/admin-dashboard-design.md` flags
  this as a future decision). If that changes, it adds endpoints to Phase 4, not this one.

**Known trap:** REQ-063 must be verified by calling the API directly with a tutor token,
not by checking that the UI hides things.
