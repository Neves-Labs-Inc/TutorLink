# Deployment — what is left to do

Phase 8R: TutorLink on managed AWS, with Redis retired. This is the working checklist that takes the
code from where it is now to a live production deployment. The full specs live in the local
`.planning/phases/08R-managed-aws/` folder. This file is the version that ships with the repository.

Status as of 2026-09-24, branch `franklinnevesfilho/deployment-spec-change`, commit `56b5f9e`.

---

## 1. Target architecture

```
            Browser / Twilio
                   │  HTTPS (ACM certificate)
                   ▼
   Application Load Balancer   (created by ECS Express Mode; WebSockets supported)
                   │
                   ▼
   ECS Express service "tutorlink"   Fargate, ARM64, 0.5 vCPU / 1 GB, min 1 / max 3 tasks (~70% CPU)
   one image: FastAPI API + compiled dashboard (single origin, no CORS)
   public subnets + public IPs → outbound to Twilio / Anthropic with no NAT gateway
                   │  5432, only from the service security group
                   ▼
   RDS PostgreSQL 17   db.t4g.micro, single-AZ, private, encrypted, 7-day backups + PITR

   Secrets Manager "tutorlink/prod" → injected as env vars      ECR "tutorlink-api"
```

Not used, by decision: Redis/ElastiCache, RDS Proxy (it breaks LISTEN/NOTIFY), CloudFront, a separate
frontend host (Lightsail and Amplify were considered and declined), NAT gateway, EventBridge/Lambda,
IaC.

## 2. Decisions approved (2026-09-24)

- **Hosting:** ECS Express Mode (App Runner has no WebSocket support and is closed to new customers).
- **Frontend:** served by the API container. D-012 (no CORS) and the first-party refresh cookie stay.
- **Redis removed everywhere** (prod, dev, CI). Its four jobs move to PostgreSQL:
  - chat broadcast: LISTEN/NOTIFY;
  - login limiter: `login_attempts` table plus an advisory lock;
  - bot flow state: `bot_flow_state` table;
  - duplicate-delivery guard: `UNIQUE(messages.twilio_sid)` only.
- **Retention purge:** runs in-process every hour, fires at `retention_purge_hour_utc` (an
  admin-editable setting, default 3 UTC), and is guarded by `pg_try_advisory_xact_lock(8102, 1)` so
  only one task purges.
- **Login reservation:** committed *before* the password check, or failures are never counted.
- **Migrations:** a one-off ECS task run before the service update. A non-zero exit aborts the deploy.
- **Backups:** RDS automated backups/PITR, plus one PITR restore drill. `backup.sh` and
  `restore-test.sh` are retired.
- **Secrets:** Secrets Manager only. Any SSM `/tutorlink/prod/*` values are migrated, then deleted.
- **API docs** (`/docs`, `/redoc`, `/openapi.json`) are off in production.
- **Health check** is `/health`, not `/health/ready`.
- **Budget alert** at ~$75/mo.
- **Requirement amendments** REQ-080…086 and new REQ-140…145, REQ-P8R: approved.
- **`docs/` amendments** P8R-D1…D8: approved and **applied** (`docs/erd.md`, `docs/api-design.md`).

---

## 3. Code work

Run the API tests from `api/` against a local PostgreSQL:
`DATABASE_URL=postgresql+psycopg://test:test@localhost:5432/test COOKIE_SECURE=false uv run pytest`.

Lint with `uv run ruff check .` and `uv run ruff format --check app tests`. For the dashboard, run
`npm test`, `tsc -b`, `eslint` and `vite build`.

**Rule for every task:** when a task is done, `grep -ni redis` over the files it owns returns nothing.
That includes comments and docstrings, which are rewritten in terms of the new mechanism, not deleted.

### Status

The "done" rows exist in `56b5f9e`. None of them has been through the verification gate yet.

| Task | What | Status | Needs |
|---|---|---|---|
| **M0** | Migration `0018`, `LoginAttempt` + `BotFlowState` models, seed `retention_purge_hour_utc` | done in `56b5f9e` | — |
| **S** | SPA catch-all (`app/spa.py`), `DASHBOARD_DIST_DIR`, `API_DOCS_ENABLED` | done in `56b5f9e` | — |
| **D** | Three-stage `docker/api.Dockerfile`, repo-root context, Caddy files deleted | done in `56b5f9e` (confirm the `.dockerignore` and compose contexts) | — |
| **B1** | Broadcast on LISTEN/NOTIFY; the socket pump rebuilds frames from the DB | **partial**: `broadcast_service.py` is converted; `routers/conversation_stream.py` and its tests still use Redis | — |
| **B2** | Publishers drop Redis; duplicate deliveries handled by the unique constraint only | **partial**: routers and `webhook_service.py` are converted; `tests/test_webhook_routes.py` still uses the Redis double | — |
| **RL** | Login limiter on `login_attempts` | not started | M0 |
| **BS** | Bot flow state on `bot_flow_state` | not started | M0 |
| **P** | In-process hourly retention scheduler | not started | M0, S |
| **X** | Delete Redis from the code, dependencies, compose, CI and Readme | not started | B1, B2, RL, BS, P, S, D (last) |
| **CD** | Deploy workflow for ECR, the migration task and the ECS service | not started | — |
| **RB** | Rewrite `deploy/RUNBOOK.md` | not started | CD |

**Order:**
1. **Now:** finish B1 and B2; start RL, BS and CD.
2. **Then:** P and RB.
3. **Last:** X.

Two tasks editing the same file never run at the same time: `main.py` (S, then P), `config.py`
(S, then X), and `docker-compose.yml` (D, then X).

### B1 — finish the broadcast (remaining part)

- `api/app/routers/conversation_stream.py`
  - Drop the `redis: RedisClient` dependency.
  - Hold one `broadcast_service.listen()` per process.
  - Rebuild each frame from the database: run `_rebuild` through `run_in_threadpool` with a fresh
    `SessionLocal`.
  - Keep the rule "pump death closes every socket".
- `api/tests/test_broadcast_service.py` and `test_conversation_stream.py`:
  - Test against a real `LISTEN` on the test DB.
  - Oversized-body case: a 20 000-character message still arrives, because the notice carries only ids.
  - `listen()` raises when its connection is killed (`pg_terminate_backend`).
- `message_service.py` gains one additive read function; nothing else changes.
- B1 imports `_read`/`_message` from `routers/conversations.py` and must not modify them.

### B2 — finish the publishers (remaining part)

- `api/tests/test_webhook_routes.py`
  - Replace the `WebhookRedis` double.
  - A redelivered `MessageSid` inserts nothing and publishes nothing: the `IntegrityError` on
    `messages.twilio_sid` is the only guard.
  - `claim_delivery()` and `DELIVERY_KEY_PREFIX` no longer exist.

### RL — login limiter on PostgreSQL

Files: `services/rate_limit_service.py`, `routers/auth.py`, `tests/test_auth_rate_limit.py`,
`tests/test_trusted_proxies.py`, `tests/test_auth_routes.py`.

- **Keep these names exactly:** `IP_BUCKET_PREFIX`, `EMAIL_BUCKET_PREFIX`, the four `*_SETTING`
  constants, `load_login_policies`, `RateLimitPolicy`, `LoginRateLimitPolicies`. New:
  `RATE_LIMIT_LOCK_NAMESPACE = 8101`.
- Rename the service dataclass `LoginAttempt` to `LoginReservation`, so it doesn't clash with the model.
- Reserve inside `pg_advisory_xact_lock(8101, hashtext(bucket_key))` for each armed bucket:
  1. Prune rows outside the window.
  2. Count what's left.
  3. If any bucket is full, refuse, with `retry_after_seconds` = the maximum across buckets.
  4. Otherwise insert one row per bucket, all sharing one `attempt_id`.
- **`auth.login` calls `db.commit()` immediately after reserving, before bcrypt.** A success, or a
  refusal that reserved nothing, removes only its own `attempt_id` rows. Never delete a whole bucket:
  that leaks whether an account exists.
- One generic 429 message. The service itself never commits.
- **Test:** 32 simultaneous attempts at a limit of 5 admit exactly 5.

### BS — bot flow state on PostgreSQL

Files: `services/bot_state.py`, `services/bot_service.py`, `tests/test_bot_state.py`,
`tests/test_bot_service.py`.

- Load, save and clear rows in `bot_flow_state`, keyed by phone number, with
  `expires_at = now + 30 min` on every write.
- A missing row and an expired row both read as a fresh start.
- A takeover never touches the row.
- No FK to `conversations`.

### P — retention scheduler

Files: new `services/retention_scheduler.py`; `retention_service.py`; `settings_service.py` (one
bounds entry, 0–23); `cli.py`; `main.py` (lifespan wiring only); tests.

- **What starts it:** an asyncio task started from the app's `lifespan`, woken at the top of every hour.
- **Deciding whether to run:** each tick reads `retention_purge_hour_utc` in its own short session. If
  the hour matches, it calls `run_guarded_purge`.
- **What `run_guarded_purge` does:** one transaction under `pg_try_advisory_xact_lock(8102, 1)`, which
  covers:
  - `purge_expired_messages`
  - reaping expired `bot_flow_state` rows
  - reaping `login_attempts` rows older than their window
- **Log lines**, exactly (the runbook quotes them):
  ```
  retention purge: ran messages=%d conversations=%d flow_states=%d login_attempts=%d
  retention purge: ran, chat purge disabled (chat_retention_days=0) flow_states=%d login_attempts=%d
  retention purge: skipped, another instance holds the lock
  retention purge: failed
  ```
- **Failures:** a tick that cannot reach the database logs and waits for the next hour. It never kills
  the task.
- **Manual runs:** `python -m app.cli purge-messages` goes through the same guarded path.

### X — remove Redis (last)

Step 1 is a check: grep for any remaining `redis_client` importer, and stop if one is found.

- Delete `api/app/redis_client.py`.
- Remove `redis_url` from `config.py` and the Redis leg from `/health/ready` (`routers/health.py`,
  `tests/test_health.py`).
- Remove `FakeRedis`/`redis_double` from `tests/conftest.py`, and seed `retention_purge_hour_utc` there.
- Remove `redis` from `pyproject.toml`, then refresh `uv.lock`.
- Remove the `redis` service from `docker-compose.yml`, the Redis service and `REDIS_URL` from
  `.github/workflows/ci.yml`, and Redis from `Readme.md`.
- **Done when:** `grep -rni redis api/ docker-compose.yml .github Readme.md` finds only migration `0018`.

### CD — deploy workflow

1. **New `deploy/ecs/primary-container.json`:**
   - Port 8000. Plain env as `${VAR}` placeholders: `COOKIE_SECURE=true`, `API_DOCS_ENABLED=false`,
     `TRUSTED_PROXIES`, `TWILIO_WHATSAPP_NUMBER`, `TWILIO_STATUS_CALLBACK_URL`.
   - `secrets[].valueFrom = ${APP_SECRET_ARN}:<KEY>::` for `DATABASE_URL`, `SECRET_KEY`,
     `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `ANTHROPIC_API_KEY`.
   - No command override.
2. **Rewrite `.github/workflows/deploy.yml`.**
   - **Keep:** tag `v*` and `workflow_dispatch` triggers only, the `deploy-production` concurrency group,
     OIDC (no static keys), SHA-pinned actions, the variables check, no build cache, and
     `ubuntu-24.04-arm` / `linux/arm64`.
   - **Build** `docker/api.Dockerfile` from the repo root with no `--target`.
   - **Smoke-test the image before pushing:**
     - the architecture is arm64;
     - `import anthropic, twilio` works;
     - `/opt/dashboard/index.html` exists;
     - `pytest --collect-only` passes.
   - **Push** `tutorlink-api:$GITHUB_SHA`.
   - **Migrate:**
     1. Register a copy of the current task definition with the new image.
     2. `aws ecs run-task` it with the command overridden to `alembic upgrade head`.
     3. `wait tasks-stopped`.
     4. **Fail unless `exitCode == 0`**, before the service is touched.
   - **Deploy:** update the Express service (image, env, secrets, health path, ARM64, cpu/memory,
     scaling), then wait for a steady state.
   - **Summary step:** image digest, migration task ARN and exit code, deployment id.
3. **Delete** `deploy/deploy.sh`, `deploy/backup.sh`, `deploy/restore-test.sh`, `deploy/systemd/` and
   `.env.prod.example`. Remove the `!.env.prod.example` exception from `.gitignore`.
4. **Check:** `actionlint` is clean, and `jq empty` passes on the container spec.

### RB — runbook

Rewrite `deploy/RUNBOOK.md` around the operator steps in section 4. It also covers:

- **Operating it:** CloudWatch logs; the four scheduler log lines; changing the purge hour; manual
  purge; scaling; WebSocket idle (uvicorn pings every 20 s against the ALB's 60 s timeout); the
  connection-budget check.
- **Rollback:** re-run the workflow for the previous tag. That rolls back code, not migrations; a bad
  migration is a PITR restore.
- **Rebuild from nothing, and a VERIFY-marked cost table.**
- **Issue bookkeeping:**
  - close #3, #4, #28, #29 and #30;
  - close #31 as met by Secrets Manager;
  - close #32 as superseded by PITR;
  - close #33 after OP-7;
  - #34 stays open.
- **Mention rule:** no mention of Caddy, EC2, systemd or Redis except in the "not used, and why" lines.

---

## 4. AWS setup — operator steps (you, after the code gate)

An agent cannot do these: they need AWS credentials, the Twilio console and a browser. Do them in
order, and record each one's check in the runbook.

| # | Step | Passes when |
|---|---|---|
| OP-2 | IAM: GitHub OIDC provider; deploy role with `sub` scoped to `repo:Siraneves/TutorLink:ref:refs/tags/v*` (+ `refs/heads/*` for manual runs); task execution role (reads `tutorlink/prod` only); Express infrastructure role | `aws iam get-role` for each; the trust policy is not a wildcard repo |
| OP-2a | AWS Budgets: monthly ~$75, alerts at 80% actual / 100% forecast | budget listed; the alert email is confirmed |
| OP-3 | ECR `tutorlink-api` with a lifecycle rule. RDS: PostgreSQL 17, `db.t4g.micro`, single-AZ, default VPC, **not public**, SG 5432 only from the service SG, encrypted, 7-day backups, deletion protection, `rds.force_ssl`. Create database `tutorlink` and role `tutorlink_app` | `describe-db-instances`: `PubliclyAccessible=false`, `BackupRetentionPeriod>=7`, `DeletionProtection=true`, `StorageEncrypted=true` |
| OP-4 | Secrets Manager `tutorlink/prod` (JSON keys above; `DATABASE_URL=postgresql+psycopg://tutorlink_app:…@<endpoint>:5432/tutorlink?sslmode=require`). Copy any `/tutorlink/prod/*` SSM values into it, then delete them | `aws ssm get-parameters-by-path --path /tutorlink/prod` is empty |
| OP-5 | GitHub repo variables: `AWS_REGION`, `AWS_DEPLOY_ROLE_ARN`, `ECS_SUBNETS`, `ECS_SECURITY_GROUP`, `APP_SECRET_ARN`, `TASK_EXECUTION_ROLE_ARN`, `INFRASTRUCTURE_ROLE_ARN`, `TRUSTED_PROXIES` (`172.31.0.0/16`), `TWILIO_WHATSAPP_NUMBER`, `PUBLIC_BASE_URL`. No secret values in GitHub | the workflow's variables check passes |
| OP-6 | First deploy: create the Express service; run the first migration task; seed the admin (`run-task … python -m app.cli seed-admin`); push a `v…` tag | migration `exitCode 0`; ≥1 healthy task; the Express URL serves the login page; `/api/nope` is a JSON 404; `/docs` is not Swagger |
| OP-7 | Confirm proxy trust live: fail a login twice from two networks (home, phone hotspot), and once with `X-Forwarded-For: 198.51.100.9`; read `login_attempts` bucket keys via a one-off task | two distinct public IPs appear as two buckets; `198.51.100.9` and any `172.31.x.x` are absent. Otherwise correct `TRUSTED_PROXIES` and redeploy |
| OP-8 | Custom domain (once #34 is decided): ACM cert (DNS validation), host-header rule and cert on the ALB listener, DNS record, update `PUBLIC_BASE_URL`, redeploy | `https://<domain>/` serves the dashboard with a valid cert |
| OP-9 | Twilio: point both webhooks at `https://<host>/webhook/whatsapp` and `/webhook/whatsapp/status`; send a real WhatsApp message | the message shows in `/chats`; no 403 in the logs; an admin reply reaches `delivered` |
| OP-10 | Live WebSocket: leave `/chats` open 5+ minutes idle, then send a message | it appears live, with no reconnect |
| OP-10a | Connection budget: `SHOW max_connections` via a one-off task | recorded value > 96 (6 tasks × 16 during a deploy at max scale). Otherwise cap `pool_size`/`max_overflow` or move to `db.t4g.small` |
| OP-11 | Scheduler: set `retention_purge_hour_utc` to the next hour and wait | exactly one "ran" line across all tasks; the others "skipped" or silent |
| OP-12 | PITR drill: restore to a throwaway instance, row-count four tables, record them in the runbook, delete the instance | a dated "Restore record" with four non-zero counts |

These stay **unproven** until their OP step is recorded, whatever the code gate says:

- REQ-080.5, REQ-082.1–.3, REQ-083.1/.2/.8, REQ-084.4 and REQ-085.4;
- the live WebSocket (OP-10).

---

## 5. Loose ends

- The code does not yet match the amended `docs/` in the Redis passages; RL, BS, B1, B2, P and X
  close that gap.
- `.planning/CODEBASE-MAP.md` still describes Redis. Update it once X lands.
- Three 7C screenshots were committed at the repo root in `56b5f9e` (`child-detail-1280.png`,
  `guardian-detail-1280.png`, `guardian-detail-with-child-1280.png`). Decide whether to keep them.
- Nothing goes to `main` until MVP.
- Open issue #34 (domain): the Express default URL stands in until it is decided.
