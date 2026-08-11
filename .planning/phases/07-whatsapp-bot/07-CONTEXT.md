# Phase 7 — WhatsApp bot · Context (stub)

Not yet planned. Depends on Phase 4 — the bot exists to drive the slot query and create
bookings. Independent of Phases 5 and 6.

**Goal:** the Twilio webhook, signature validation, the Redis conversation state machine,
and the intake and booking flows from `Readme.md`.

**Requirements:** REQ-070 … REQ-076.

**Must be settled before planning:**
- Free-text parsing versus numbered-menu replies. Numbered menus are strongly recommended:
  deterministic, testable, no NLP dependency, and they match the "return at most 5 slots"
  design in `docs/api-design.md`.
- What happens on an unrecognised reply, and how many retries before the bot bails out.
- Whether a returning parent can be recognised by phone number alone, given WhatsApp
  numbers can be reassigned.
- Cancellation and reschedule windows — is there a cutoff before the session.
- Twilio delivers at-least-once. Decide the idempotency key for a repeated webhook delivery
  so a retry cannot create a duplicate booking.

**Known trap:** the constitution requires signature validation before any side effect, and
`docs/api-design.md` requires a TwiML response. Both are testable without Twilio.
