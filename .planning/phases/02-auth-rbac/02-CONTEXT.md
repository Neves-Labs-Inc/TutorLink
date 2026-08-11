# Phase 2 — Authentication and RBAC · Context (stub)

Not yet planned. Do not expand into tasks until Phase 1 is verified.

**Goal:** a real login end to end. JWT issue and refresh, bcrypt password storage, a
reusable auth dependency, the RBAC matrix from `docs/api-design.md` enforced server-side,
dashboard login with in-memory access token plus HttpOnly refresh cookie, and route guards.

**Requirements:** REQ-020 … REQ-029.

**Must be settled before planning:**
- OQ-4 in `STATE.md` — `/auth/refresh` reads the token from a cookie or from the body.
  `docs/api-design.md` and `docs/admin-dashboard-design.md` contradict each other here.
- Access and refresh token lifetimes. Suggested default: 15 minutes and 7 days.
- Whether refresh tokens rotate on use and whether they are revocable. Suggested default:
  rotate, and store nothing server-side in this phase (revocation is a later REQ if needed).
- How the first admin account is created — REQ-026 currently says a seed command.

**Known trap:** the auth dependency and the tutor-scoping helper must exist before Phase 3
writes its first router, or the scoping rule gets retrofitted across every endpoint.
