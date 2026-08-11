# Phase 8 — Deployment · Context (stub)

Not yet planned. Deliberately thin — it deploys whatever exists.

**Goal:** a production Compose overlay on a single EC2 instance, an HTTPS webhook endpoint,
and a documented path to RDS and ElastiCache.

**Requirements:** REQ-080 … REQ-082.

**Must be settled before planning:**
- TLS terminator: Caddy (automatic certificates, least configuration) versus nginx plus
  certbot. Caddy is recommended for a single-box deployment.
- Domain name and who owns DNS.
- Where production secrets live — EC2 environment file, AWS SSM Parameter Store, or
  Secrets Manager.
- Backup policy for PostgreSQL before the RDS migration, and after.
- How migrations are run on deploy, given D-009 forbids running them on startup.

**Known trap:** OQ-3's same-origin decision means production needs the reverse proxy in
front of both the dashboard and the API, not just in front of the API.
