# Phase 4 — Scheduling engine · Context (stub)

Not yet planned. Depends on Phase 2 auth; largely parallel with Phase 3.

**Goal:** availability, exceptions, the three-step slot query from `docs/erd.md`, and
bookings with real conflict handling.

**Requirements:** REQ-040 … REQ-045.

**Must be settled before planning:**
- Slot granularity. `tutor_availability` stores a range (e.g. 09:00–12:00) but
  `/api/slots/available` returns discrete slots with a start and end. The session length
  that subdivides a range is not specified anywhere in the docs. This is the single biggest
  open question in the project after Phase 1 and it must be answered before this phase.
- Whether a booking may partially overlap an availability range or must align to a
  generated slot boundary.
- How far ahead `/api/slots/available` may look, and whether a same-day or past date is
  rejected.
- Exception granularity: `tutor_availability_exceptions` is date-range only, so a partial
  day off cannot be expressed. Confirm that is acceptable.

**Known trap:** REQ-045 requires the 409 to hold under concurrency. Rely on REQ-008's
partial unique index and catch `IntegrityError`; a read-then-write check races.
