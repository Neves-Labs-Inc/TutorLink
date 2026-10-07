# TutorLink production runbook

Operational procedure for standing up and operating TutorLink on Amazon ECS Express Mode. This is
**not** a frozen contract (`docs/` is; see `CONSTITUTION.md` §1) — it documents this one
deployment, it will change whenever AWS or the workflow changes, and it lives beside the files it
describes rather than in `docs/`.

**No Organization, no Control Tower, no SCPs, no multi-account separation.** This is a single
personal AWS account on pay-as-you-go billing (P8-B). Do not add any of the above.

Anything marked **VERIFY** below was not checked against a running AWS account at the time of
writing (2026-09-24) — check it before you rely on it, and re-check before provisioning.

---

## 1. Shape

One ECS Express service, `tutorlink`, running one container, `Main`: the FastAPI API and the
compiled dashboard bundle, served from a single origin (no CORS, no separate frontend host).
Express Mode provisions and owns the Application Load Balancer in front of it. RDS PostgreSQL is
the only datastore. Secrets live in Secrets Manager. The image lives in one ECR repository,
`tutorlink-api`. TLS is an ACM certificate on the ALB listener.

```
            Browser / Twilio
                   │  HTTPS (ACM certificate)
                   ▼
   Application Load Balancer      (created and managed by ECS Express Mode)
                   │
                   ▼
   ECS Express service "tutorlink"   container "Main", port 8000, Fargate ARM64, 0.5 vCPU / 1 GB
   min 1 / max 3 tasks, target-tracking ~70% average CPU
                   │  5432, only from the service security group
                   ▼
   RDS PostgreSQL 17   db.t4g.micro, single-AZ, private, encrypted, 7-day backups + PITR

   Secrets Manager "tutorlink/prod"        ECR "tutorlink-api"
```

**Not used, and why:**
- **Redis / ElastiCache** — retired this phase. Chat broadcast runs on `LISTEN`/`NOTIFY`, the login
  limiter and bot flow state live in Postgres tables, and duplicate Twilio deliveries are rejected
  by `messages.twilio_sid`'s unique constraint alone.
- **RDS Proxy** — a pooling proxy multiplexes connections onto a smaller pool of backend sessions,
  which breaks a session-scoped `LISTEN` the moment the proxy recycles it onto a different backend
  connection. If a proxy is ever added later, the `LISTEN` connection must bypass it.
- **S3 backups, `backup.sh`, `restore-test.sh`** — RDS automated backups and point-in-time recovery
  replace them (§12).
- **systemd, Caddy, EC2, SSM Run Command** — there is no box. The one place SSM still appears is the
  one-time migration of secrets out of SSM Parameter Store, below (§5).

## 2. Account and identity

**The GitHub OIDC identity provider.** In IAM → Identity providers, add an OIDC provider for
`https://token.actions.githubusercontent.com` with audience `sts.amazonaws.com`. AWS trusts
GitHub's root CA directly and no longer checks the configured thumbprint.

**The deploy IAM role.** `.github/workflows/deploy.yml`'s header documents the exact trust-policy
condition it needs. The role's trust policy must condition on both claims:

```json
{
  "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
    "StringLike": {
      "token.actions.githubusercontent.com:sub": [
        "repo:Neves-Labs-Inc/TutorLink:ref:refs/tags/v*",
        "repo:Neves-Labs-Inc/TutorLink:ref:refs/heads/*"
      ]
    }
  }
}
```

Both `sub` values are required, not one: the first admits a tag push, the second admits
`workflow_dispatch`, which presents the branch it was launched from, not the tag. **A `sub` of
`repo:*`, or no `sub` condition at all, lets any repository on GitHub assume this role and push to
this account's ECR — this is exactly what issue #29 exists to prevent.**

**VERIFY at provisioning time:** if this repository is renamed or recreated after 2026-07-15,
GitHub issues an immutable subject embedding owner and repository IDs
(`repo:Neves-Labs-Inc@<owner-id>/TutorLink@<repo-id>:ref:refs/tags/v1`) instead of the plain form above
— read the token's own claims rather than assuming the form has not changed.

**The deploy role's permissions**, as `deploy.yml`'s header states them (wider than an earlier
draft — the workflow now reads the service's active configuration and its deployment history
before it updates anything):

- `ecr:GetAuthorizationToken` (resource `*`); `ecr:BatchCheckLayerAvailability`,
  `InitiateLayerUpload`, `UploadLayerPart`, `CompleteLayerUpload`, `PutImage`, `BatchGetImage` on
  the `tutorlink-api` repository only.
- `ecs:DescribeServices`, `DescribeTaskDefinition`, `RegisterTaskDefinition`, `RunTask`,
  `DescribeTasks`, `ListServiceDeployments`, `DescribeServiceDeployments`,
  `DescribeExpressGatewayService`, `UpdateExpressGatewayService` — **VERIFY** the exact Express
  action names (V-4 below); `DescribeServices`, `ListServiceDeployments` and
  `DescribeServiceDeployments` are the widened part.
- `iam:PassRole` on exactly `TASK_EXECUTION_ROLE_ARN` and `INFRASTRUCTURE_ROLE_ARN`.
- `logs:GetLogEvents` is **not used** by the workflow (it prints the migration's log group and
  stream name for the operator to read directly, not the log events themselves).

**The task execution role** (`TASK_EXECUTION_ROLE_ARN`) — pulls the image from ECR, writes to
CloudWatch Logs, and reads exactly one secret: `secretsmanager:GetSecretValue` on the
`tutorlink/prod` secret ARN (`APP_SECRET_ARN`), nothing wider.

**The Express infrastructure role** (`INFRASTRUCTURE_ROLE_ARN`) — required by
`aws ecs create-express-gateway-service` at first deploy (§6) so Express can provision the ALB,
target group and security group it manages. The deploy workflow's *update* step does not pass it
and does not use it (`--network-configuration` is not passed either — the service keeps what it
was created with). **VERIFY (V-4):** whether `update-express-gateway-service` needs
`iam:PassRole` on this role even though it does not pass it; if not, it can be dropped from the
deploy role once the workflow's own comment is updated to match.

**Budget alert.** AWS Budgets → create a monthly cost budget of ~$75 with an email alert at 80% of
actual spend and 100% of forecast spend (§15's cost table is the basis for the figure).

## 3. ECR

One repository, `tutorlink-api` (`tutorlink-web` is retired — the dashboard ships inside the API
image, `docker/api.Dockerfile`'s `production` stage). Add a lifecycle rule capping retained images
— **VERIFY N**, e.g. "expire untagged images after 1 day" plus "keep the last 20 tagged images" —
or the storage bill grows quietly forever, since every tagged deploy pushes a new image tagged with
the commit SHA (`IMAGE_TAG` in `deploy.yml`).

## 4. RDS

PostgreSQL 17, `db.t4g.micro`, single-AZ, default VPC, **not publicly accessible**. Security group:
inbound 5432 **only from the service's security group** (`ECS_SECURITY_GROUP`), nothing else
(REQ-080.5). Storage encrypted, automated backups with a 7-day retention window, deletion
protection on, final snapshot taken on delete (REQ-084). Enable `rds.force_ssl` in the parameter
group.

Create database `tutorlink` and a role `tutorlink_app` that owns it. `DATABASE_URL` (the value that
goes into the `tutorlink/prod` secret, §5) is:

```
postgresql+psycopg://tutorlink_app:<password>@<rds-endpoint>:5432/tutorlink?sslmode=require
```

`sslmode=require` on the client side pairs with `rds.force_ssl` on the server side; either alone
leaves a path where a client that doesn't ask for TLS gets a plaintext connection.

## 5. Secrets Manager

Create secret `tutorlink/prod` as a JSON blob with keys `DATABASE_URL`, `SECRET_KEY`,
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `ANTHROPIC_API_KEY` — exactly the keys
`deploy/ecs/primary-container.json`'s `secrets[].valueFrom` references
(`${APP_SECRET_ARN}:<KEY>::`). `SECRET_KEY` must not be the `.env.example` placeholder and must be
at least 32 bytes (`api/app/config.py:_reject_weak_secret_key` refuses to boot otherwise) —
generate it with `openssl rand -hex 32`.

**Migrating from SSM:** if any `/tutorlink/prod/*` parameters exist from an earlier deployment,
copy each value into the new secret, confirm the service starts from it, then **delete the SSM
parameters**. The two mechanisms are not run side by side — the application reads secrets only as
container environment variables injected from `secrets[].valueFrom` in
`deploy/ecs/primary-container.json`, never from SSM directly, so once the secret is populated and
the service confirmed healthy the parameters are dead weight, not a fallback.

## 6. First deploy

In order:

1. **IAM and Secrets Manager** (§2, §5) — the deploy role, task execution role, infrastructure
   role, and the `tutorlink/prod` secret populated.
2. **ECR and RDS** (§3, §4).
3. **Create the Express service:**
   ```
   aws ecs create-express-gateway-service \
     --cluster default \
     --service-name tutorlink \
     --infrastructure-role-arn <INFRASTRUCTURE_ROLE_ARN> \
     --execution-role-arn <TASK_EXECUTION_ROLE_ARN> \
     --primary-container file://<a filled-in primary-container.json> \
     --health-check-path /health \
     --cpu-architecture ARM64 \
     --cpu 512 \
     --memory 1024 \
     --scaling-target minTaskCount=1,maxTaskCount=3,autoScalingMetric=AVERAGE_CPU,autoScalingTargetValue=70 \
     --network-configuration '{"awsvpcConfiguration":{"subnets":[...],"securityGroups":["..."],"assignPublicIp":"ENABLED"}}'
   ```
   **The container name in the rendered spec must stay `Main`** (`deploy/ecs/primary-container.json`
   carries no `name` field — Express supplies it as `Main` by default; do not override it) and
   **the container port must be 8000** — every later deploy fails outright
   (`if any(.containerDefinitions[]; .name == $container) then . else error(...)` in `deploy.yml`)
   if the active task definition has no `Main` container. **VERIFY** that `create-express-gateway-service`
   provisions an `awslogs` CloudWatch Logs configuration by default; every later `update-express-gateway-service`
   call copies whatever `awsLogsConfiguration` sits on the current active configuration forward
   unchanged, so if none exists at create, none exists after any update either.
4. **Run the first migration task** by hand — the same shape the workflow later automates: describe
   the just-created service's active task definition, register a copy in the family
   `tutorlink-migrate` with the image, environment and secrets filled in, `run-task` it with the
   command overridden to `["alembic", "upgrade", "head"]`, and confirm `exitCode == 0` before
   continuing.
5. **Seed the first admin**, as a one-off `run-task` on the same task definition, container command
   overridden, with `TUTORLINK_ADMIN_EMAIL`, `TUTORLINK_ADMIN_DISPLAY_NAME` and
   `TUTORLINK_ADMIN_PASSWORD` set as environment overrides on the container (`app/cli.py`'s
   `seed-admin` reads them; it prompts if any is absent, which a non-interactive task cannot
   answer):
   ```
   python -m app.cli seed-admin
   ```
   `seed-admin` is idempotent — re-running it against an existing email reports "no change" rather
   than resetting a password.
6. **Set the GitHub repository variables** (§2's roles' ARNs, plus the rest of the table below),
   then push a `v…` tag (or run the `Deploy` workflow via `workflow_dispatch`) to exercise the
   automated path end to end.

**GitHub repository variables**, read by `deploy.yml` (Settings → Secrets and variables → Actions →
Variables). The workflow's variables-check step fails fast naming whichever is missing, before
touching AWS:

| Variable | Value |
|---|---|
| `AWS_REGION` | the account's region |
| `AWS_DEPLOY_ROLE_ARN` | the deploy role from §2 |
| `ECS_SUBNETS` | comma-separated subnet IDs, the service's `awsvpcConfiguration` |
| `ECS_SECURITY_GROUP` | the service's own security group (also RDS's inbound source, §4) |
| `APP_SECRET_ARN` | the full `tutorlink/prod` secret ARN, including its suffix |
| `TASK_EXECUTION_ROLE_ARN` | the task execution role from §2 |
| `INFRASTRUCTURE_ROLE_ARN` | the Express infrastructure role from §2 (used at create only, §2) |
| `TRUSTED_PROXIES` | a CIDR the ALB's private addresses fall in — default `172.31.0.0/16`, **VERIFY via OP-7** (§9) |
| `TWILIO_WHATSAPP_NUMBER` | the WhatsApp sender in E.164, e.g. `whatsapp:+441234567890` |
| `PUBLIC_BASE_URL` | the Express default URL until #34 (§7) |

No secret value is ever set as a GitHub variable or secret — every credential the running
container needs comes from `tutorlink/prod` via `secrets[].valueFrom`.

**Plain container environment** (`deploy/ecs/primary-container.json`'s `environment`, rendered by
the workflow with `jq`): `COOKIE_SECURE=true`, `BUSINESS_TIMEZONE=America/New_York` (IANA name; the API defaults to `UTC` and refuses to boot on an invalid one), `API_DOCS_ENABLED=false`, `TRUSTED_PROXIES`,
`TWILIO_WHATSAPP_NUMBER`, `TWILIO_STATUS_CALLBACK_URL` (the workflow derives this one from
`PUBLIC_BASE_URL` — never set it separately). `DASHBOARD_DIST_DIR` is **not** set here: it is baked
into the image (`docker/api.Dockerfile`'s production stage sets `ENV DASHBOARD_DIST_DIR=/opt/dashboard`).

## 7. Domain and TLS

**The real domain name is not yet chosen (#34).** Until it is, `PUBLIC_BASE_URL` is set to the
Express-assigned default URL, the same stand-in role a bare instance's public DNS name played
before this deployment moved to managed AWS. Nothing to register, no DNS record to create; it
works the moment the service is created.

**Once the real domain is chosen:** request an ACM certificate for it (DNS validation), add a
host-header rule and attach the certificate to the ALB listener Express created, create the DNS
record pointing at the ALB, update `PUBLIC_BASE_URL` to the new domain, redeploy (so
`TWILIO_STATUS_CALLBACK_URL` is re-derived from it), then re-register both Twilio webhook URLs
against the new host (§8) — switching the public host after Twilio has already been pointed at the
stand-in is not free.

## 8. Twilio

Once a host is live (the Express default URL works here too, §7), in the Twilio console register:
- `https://<host>/webhook/whatsapp` as the WhatsApp inbound webhook.
- `https://<host>/webhook/whatsapp/status` as the status callback.

`TWILIO_STATUS_CALLBACK_URL` is derived by the workflow from `PUBLIC_BASE_URL`
(`"${PUBLIC_BASE_URL%/}/webhook/whatsapp/status"` in `deploy.yml`'s render step, REQ-082.2) — do not
set it as its own repository variable.

**Smoke test — required, and it cannot be checked anywhere else (REQ-082.3):** send a real WhatsApp
message to the registered number and confirm it arrives in `/chats` with the request signature
validated end to end in production. A 403 from the signature check in the CloudWatch logs (§10)
most often means `TRUSTED_PROXIES` does not match the ALB's actual address range — see §9 — or that
the registered webhook host doesn't match `PUBLIC_BASE_URL`.

## 9. Confirming proxy trust live (REQ-083, OP-7)

`TRUSTED_PROXIES` defaults to `172.31.0.0/16` (**VERIFY**: the default VPC's actual CIDR) — but the
only way to know it is right is to watch real traffic bucket by client IP, not by the ALB's:

1. Look up the ALB's subnets' CIDRs and the VPC CIDR.
2. Fail a login twice for a throwaway email from two different networks (e.g. home and a mobile
   hotspot), and once more sending a manual request with `X-Forwarded-For: 198.51.100.9`.
3. Read the buckets via a one-off `run-task`:
   ```sql
   SELECT bucket_key FROM login_attempts WHERE bucket_key LIKE 'ratelimit:login:ip:%'
   ```
4. **PASS** means two distinct public client IPs appear as two separate buckets; `198.51.100.9`
   does **not** appear (a spoofed header from a peer outside `TRUSTED_PROXIES` must not be
   believed); and no bucket carries the ALB's own private address (a `172.31.x.x`, or whatever the
   VPC CIDR is) — that would mean every login is being bucketed under the load balancer's IP
   instead of the caller's, which defeats the per-IP limiter entirely.
5. If step 4 fails, `TRUSTED_PROXIES` is wrong: set it to the CIDR the ALB's addresses actually
   fall in and redeploy.

## 10. Operating it

**Logs.** Each task writes to the CloudWatch Logs group the service's `awsLogsConfiguration` names
(set at create, §6, and copied forward by every update). The migration task's own log group and
stream are printed directly in the workflow's "Run the database migration" step output.

**The retention scheduler's four log lines**, logger `app.services.retention_scheduler`, exactly:

```
retention purge: ran messages=%d conversations=%d flow_states=%d login_attempts=%d
retention purge: ran, chat purge disabled (chat_retention_days=0) flow_states=%d login_attempts=%d
retention purge: skipped, another instance holds the lock
retention purge: failed
```

The first two are a completed purge — the first when chat purging is enabled, the second when
`chat_retention_days` is `0` and only the state tables were reaped. The third is normal at 3+ tasks:
only one instance holds `pg_try_advisory_xact_lock(8102, 1)` in a given hour, and the others log
this and do nothing — exactly one "ran" line per night across every task is the expected pattern,
not a fault. The fourth means the tick could not reach the database; it does not kill the
scheduler, which simply waits for the next hour.

**Changing the purge hour.** `retention_purge_hour_utc` (default `3`, bounds 0–23) is an
admin-editable row in the Settings page — the scheduler rereads it every tick, so a change takes
effect at the next top of the hour, no redeploy needed.

**Manual purge**, as a one-off `run-task` (same task definition family as the migration, container
command overridden):
```
python -m app.cli purge-messages
```
This goes through the same guarded path as the hourly tick: if another instance already holds the
advisory lock, it exits 1 and logs "skipped, another instance holds the lock" rather than purging
twice.

**Scaling.** Min 1 / max 3 tasks, target-tracking on ~70% average CPU (the `scaling-target` in
`deploy.yml`'s "Update the Express service" step). Raise `maxTaskCount` before a known traffic
spike; a redeploy is not required to change the running task count, but the workflow's
`update-express-gateway-service` call reasserts these exact values on every deploy, so a manual
override outside the workflow is undone by the next deploy.

**WebSocket idle behaviour.** uvicorn's websocket implementation pings an open connection every
20 s by default; the ALB's idle timeout is 60 s (**VERIFY** — the Express-managed ALB's default,
unless changed at creation). Three missed pings inside one idle window is the margin — a `/chats`
socket left open with no traffic should never see the ALB close it for inactivity (OP-10 proves
this against the real ALB, not this margin alone).

**Connection budget (OQ-100).** Up to 16 Postgres connections per task (the SQLAlchemy pool);
during a canary deploy at max scale that is 6 tasks (3 old + 3 new, briefly), so up to 96
connections at once. Run, as a one-off `run-task`:
```sql
SHOW max_connections;
```
**VERIFY** the recorded value exceeds 96; if it does not, either cap `pool_size`/`max_overflow`
lower, or move RDS to a larger instance class (`db.t4g.small` raises the connection ceiling with
it).

## 11. Rollback

Re-run the `Deploy` workflow (`workflow_dispatch`, or re-push the same tag) against the previous
release's tag. **This rolls back code, not a migration** (REQ-086.4): the migration step runs
`alembic upgrade head` — forward only — before the service is touched. A deploy that shipped a
destructive migration is **not** undone by re-running an older tag; the old code would run against
a schema it does not expect. Recovering from that is a PITR restore (§12), not a rollback.

Two outcomes the workflow itself distinguishes, both worth knowing before you re-run it:
- **`UNCHANGED`** — re-running the workflow for a tag whose image is already live on every active
  configuration starts no new deployment at all; this is a pass, not a failure.
- **`ROLLBACK_SUCCESSFUL`** — an alarm-triggered canary rollback also ends with the service stable,
  but on the *previous* revision, not the one this run targeted; the workflow fails the job on this
  status rather than reading "stable" as "succeeded".

**A hung migration is left running, never killed mid-transaction.** If the migration step times out
at `MIGRATION_TIMEOUT` (1800 s), the task is left running and the job fails before the service is
touched. Find it with:
```
aws ecs list-tasks --cluster default --started-by tutorlink-migrate
```
and read its logs (§10) before deciding whether to let it finish or stop it by hand.

`DEPLOY_POLL_TIMEOUT` is also 1800 s: the deploy step fails if no deployment reaches a terminal
status inside that window.

## 12. Backups and restore

RDS automated backups and point-in-time recovery (PITR) are the only backup mechanism now (§4's
7-day window; the previous deployment's script-driven S3 backup and restore are retired).
Recovering from a bad migration or a bad data change is a PITR restore, not a rollback (§11).

**The PITR drill** (run once, and re-run whenever the procedure or the schema changes materially):
1. Restore RDS to a throwaway instance at a point before the incident (or, for the drill itself,
   any recent point).
2. Row-count four tables through a one-off `run-task` (or a temporary `psql` session against the
   throwaway instance): `users`, `tutors`, `bookings`, `conversations`, `messages` — pick four with
   non-zero rows.
3. Record the date and the four counts in the **Restore record** below.
4. Delete the throwaway instance.

### Restore record (REQ-084.4)

```
<PASTE the drill's date and four non-zero row counts here — empty until a real drill has been run>
```

## 13. Rebuild from nothing

The order of §2–§8 as a checklist, run against a fresh AWS account or a fresh region:

1. IAM (§2): OIDC provider, deploy role, task execution role, infrastructure role. Budget alert.
2. ECR repository (§3).
3. RDS instance (§4) — from a snapshot or a PITR restore if one is available, rather than an empty
   database, so the rebuild does not also lose data.
4. Secrets Manager secret (§5), populated with real values.
5. Create the Express service, run the first migration task, seed the admin (§6).
6. Set the GitHub repository variables (§6), tag a release.
7. Domain and TLS (§7), if the real domain has been chosen by then.
8. Twilio webhook registration (§8).

## 14. Issue bookkeeping

- **#3 — close.** Login brute-force protection ships on PostgreSQL now:
  `api/app/services/rate_limit_service.py`, per-IP and per-email buckets reserved inside
  `pg_advisory_xact_lock(8101, hashtext(bucket_key))`, one generic 429. The residual (negative
  values still accepted in the four rate-limit settings rows) stays open under #17/#18, not here.
- **#4 — close.** There is no `DEBUG` setting anywhere in the codebase; `cookie_secure` in
  `api/app/config.py` defaults `True` and is read directly by the auth router.
- **#28 — close, as done.** RDS is not publicly accessible (§4) and reachable only from the
  service's own security group; nothing but the Express-managed ALB is exposed to the internet.
- **#29 — close.** CI assumes the deploy role by OIDC (§2); no long-lived AWS access key exists in
  this repository.
- **#30 — close.** Migrations are a one-off ECS task (`tutorlink-migrate` family) that must exit 0
  before the service update runs at all; a failed or hung migration leaves the old tasks serving.
- **#31 — close, as met by a different mechanism.** Secrets live in Secrets Manager (§5), not SSM
  Parameter Store.
- **#32 — close, as superseded.** RDS automated backups plus the PITR drill (§12) replace the
  nightly `pg_dump`/S3 mechanism, by the user's decision of 2026-09-24.
- **#33 — close only after OP-7 passes** (§9) — the code (`TRUSTED_PROXIES`,
  `ProxyHeadersMiddleware`) has shipped for a while; what remained was configuring it against the
  real ALB and proving it with the login-bucket check.
- **#34 — stays open.** The production domain is deliberately unchosen (§7); the Express default
  URL stands in.

## 15. Costs

**VERIFY every figure below** — none has been checked against a live bill yet:

| Item | Estimate |
|---|---|
| Application Load Balancer (Express-managed) | ~$16/mo + LCU usage |
| Fargate, ARM64, 0.5 vCPU / 1 GB, 1 task steady-state | ~$9/mo |
| RDS `db.t4g.micro`, single-AZ | ~$12/mo |
| RDS storage + 7-day automated backups | a few $/mo, size-dependent |
| Secrets Manager, one secret | ~$0.40/mo |
| Public IPv4 address(es) on Fargate ENIs | ~$3.60/mo per address (AWS's 2024 public-IPv4 charge) |

Total, steady-state, is the basis for the ~$75/mo budget alert (§2) — it leaves headroom for
scaling to 2–3 tasks under load and does not assume the Compute Savings Plan lever below.

**Later levers, not needed now:** a Compute Savings Plan once Fargate usage is stable (locking in a
discount against a usage pattern that is still guesswork today would be the wrong order); start
every new resource at its smallest viable size and grow only against an observed need.

## 16. Acceptance criteria not yet met

None of the operator steps below have been performed against a live AWS account. Until each is
recorded here with its passing evidence, treat the corresponding requirement as **unproven**,
whatever the code gate says:

- **OP-2** — IAM: OIDC provider, deploy role, task execution role, infrastructure role. Not done.
- **OP-2a** — AWS Budgets monthly cost budget and alert subscription. Not done.
- **OP-3** — ECR repository and RDS instance, provisioned and confirmed
  `PubliclyAccessible=false`/`BackupRetentionPeriod>=7`/`DeletionProtection=true`/`StorageEncrypted=true`.
  Not done.
- **OP-4** — Secrets Manager populated; any SSM `/tutorlink/prod/*` parameters migrated and
  deleted. Not done.
- **OP-5** — GitHub repository variables set; the workflow's variables-check step passes. Not done.
- **OP-6** — First deploy through the Express service and the tagged workflow; the five VERIFY
  items V-1 … V-5 below settled and recorded. Not done.
- **OP-7** — Proxy trust confirmed live against the real ALB (§9); `TRUSTED_PROXIES` corrected if
  needed. Not done — REQ-083.1/.2/.8 stay unproven until it is.
- **OP-8** — Custom domain, once #34 is decided. Not done (and not blocking).
- **OP-9** — Twilio webhook registration and a real WhatsApp smoke test. Not done — REQ-082.2/.3
  stay unproven until it is.
- **OP-10** — Live WebSocket idle test through the real ALB (§10). Not done.
- **OP-10a** — Connection budget check (`SHOW max_connections`, §10). Not done.
- **OP-11** — Retention scheduler observed live for at least one night, exactly one "ran" line
  across all tasks. Not done — REQ-085.4 stays unproven until it is.
- **OP-12** — PITR drill, with a dated Restore record (§12). Not done — REQ-084.4 stays unproven
  until it is.

**Open VERIFY items carried from the deploy workflow (CD), to be settled at OP-6** and recorded
here once they are:

- **V-1** — whether `update-express-gateway-service`'s returned `serviceRevisionArn` and a
  deployment's `targetServiceRevisionArn` are guaranteed to be the same ARN. A `::warning::` in a
  deploy's run log means they differed and the revision match fell back to "any new deployment".
- **V-2** — whether an update that changes nothing starts a deployment at all (the `UNCHANGED`
  branch in §11 assumes it may not).
- **V-3** — the accepted input form of `aws ecs list-service-deployments --created-at` (the workflow
  passes JSON `{"after": "<ISO-8601>"}`).
- **V-4** — the exact Express IAM action names (`DescribeExpressGatewayService`,
  `UpdateExpressGatewayService`), and whether `update-express-gateway-service` needs `iam:PassRole`
  on `INFRASTRUCTURE_ROLE_ARN` even though it is not passed on update (§2). If it does not, drop the
  role from the deploy role's PassRole grant and from the variables check.
- **V-5** — whether the AWS CLI version on `ubuntu-24.04-arm` (the workflow's runner) supports the
  Express and service-deployment subcommands out of the box; if not, add a pinned CLI install step
  to `deploy.yml`.
