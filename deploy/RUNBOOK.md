# TutorLink production runbook

Operational procedure for standing up and operating TutorLink on a single AWS EC2 box. This is
**not** a frozen contract (`docs/` is; see `CONSTITUTION.md` §1) — it documents this one
deployment, it will change whenever AWS or the scripts change, and it lives beside the scripts it
describes rather than in `docs/`.

**No Organization, no Control Tower, no SCPs, no multi-account separation.** This is a single
personal AWS account on pay-as-you-go billing (P8-B). Do not add any of the above.

Anything marked **VERIFY** below was not checked against a running AWS account at the time of
writing (2026-09-22) — check it before you rely on it, and re-check before provisioning.

---

## 1. Account and identity

**The GitHub OIDC identity provider.** In IAM → Identity providers, add an OIDC provider for
`https://token.actions.githubusercontent.com` with audience `sts.amazonaws.com`. **The
certificate thumbprint is no longer required**: AWS trusts GitHub's root CA directly and ignores
whatever thumbprint is configured on the provider. Do not spend time pinning one from an older
guide — it does nothing.

**The deploy IAM role.** `.github/workflows/deploy.yml` documents the exact trust-policy
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
        "repo:Siraneves/TutorLink:ref:refs/tags/v*",
        "repo:Siraneves/TutorLink:ref:refs/heads/*"
      ]
    }
  }
}
```

Both `sub` values are required, not one. The first admits a tag push (`v*`); the second admits
`workflow_dispatch`, because a manual dispatch presents the branch it was launched from, not the
tag — a tag-only condition silently breaks the "Run workflow" button in the GitHub UI. **A `sub`
of `repo:*`, or no `sub` condition at all, lets any repository on GitHub assume this role and push
to this account's ECR — this is exactly what issue #29 exists to prevent.**

**VERIFY at provisioning time, both cheap to re-check:** if this repository is renamed or
recreated after 2026-07-15, GitHub issues an immutable subject embedding owner and repository IDs
(`repo:Siraneves@<owner-id>/TutorLink@<repo-id>:ref:refs/tags/v1`) instead of the plain form
above — read the token's own claims rather than assuming the form has not changed.

**The role's permissions** — ECR push to `tutorlink-api` and `tutorlink-web`, `ssm:SendCommand` to
this instance, and nothing else:

- `ecr:GetAuthorizationToken` (resource `*`), `ecr:BatchCheckLayerAvailability`,
  `ecr:PutImage`, `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload` on
  the two repository ARNs.
- `s3:PutObject` on `arn:aws:s3:::<BACKUP_BUCKET>/releases/*` — this is how the compose files
  reach S3 (§4). **If this is scoped only to `postgres/*`, the first deploy fails at the compose
  fetch upload step.**
- `ssm:SendCommand` on the instance's ARN and on the `AWS-RunShellScript` document,
  `ssm:GetCommandInvocation` (resource `*`, this action does not support resource-level scoping).

**GitHub repository variables** (Settings → Secrets and variables → Actions → Variables), read by
`deploy.yml`: `AWS_REGION`, `AWS_DEPLOY_ROLE_ARN`, `EC2_INSTANCE_ID`, `BACKUP_BUCKET`. The workflow
checks all four are set and fails fast naming whichever is missing, before touching AWS.

## 2. ECR

Two repositories: `tutorlink-api` and `tutorlink-web`. Add a lifecycle policy to each capping
retained images (e.g. "expire untagged images after 1 day" plus "keep the last 20 tagged images")
or the storage bill grows quietly forever, since every commit to a tag or dispatch pushes a new
image tagged with the full commit SHA.

## 3. SSM Parameter Store

Every parameter lives under `/tutorlink/prod/`. `deploy.sh` fetches all of them with
`aws ssm get-parameters-by-path --recursive --with-decryption` and writes `.env` from whatever it
finds — there is no second list to keep in sync beyond `.env.prod.example`, which is the
authoritative name list.

| Parameter | Type | Source |
|---|---|---|
| `SECRET_KEY` | SecureString | `openssl rand -hex 32`. **Must not be the `.env.example` placeholder** (`change-me-generate-with-openssl-rand-hex-32`) and must be at least 32 bytes — the app refuses to boot on either, by design (`api/app/config.py:_reject_weak_secret_key`). |
| `POSTGRES_PASSWORD` | SecureString | `openssl rand -hex 32`. Must match the password embedded in `DATABASE_URL` below. |
| `TWILIO_ACCOUNT_SID` | SecureString | Twilio console. |
| `TWILIO_AUTH_TOKEN` | SecureString | Twilio console. |
| `ANTHROPIC_API_KEY` | SecureString | Anthropic console. |
| `ECR_REGISTRY` | String | `<account-id>.dkr.ecr.<region>.amazonaws.com`. |
| `BACKUP_BUCKET` | String | The bucket name from §5. **This is also `vars.BACKUP_BUCKET` in GitHub — see the note below.** |
| `DOMAIN` | String | The production hostname (§6 — blocked on #34). |
| `ACME_EMAIL` | String | Where Let's Encrypt sends expiry/problem notices. |
| `DATABASE_URL` | String | `postgresql+psycopg://tutorlink:<POSTGRES_PASSWORD>@postgres:5432/tutorlink`. |
| `REDIS_URL` | String | `redis://redis:6379/0`. |
| `COOKIE_SECURE` | String | `true`. |
| `TRUSTED_PROXIES` | String | `172.28.0.10` — Caddy's fixed address on the compose network (§9's subnet note). |
| `TWILIO_WHATSAPP_NUMBER` | String | The WhatsApp sender in E.164, e.g. `whatsapp:+441234567890`. |
| `TWILIO_STATUS_CALLBACK_URL` | String | `https://<DOMAIN>/webhook/whatsapp/status` (REQ-082.2 — set once §6/§7 are done). |
| `POSTGRES_USER` | String | `tutorlink`. |
| `POSTGRES_DB` | String | `tutorlink`. |

`VITE_API_BASE_URL` is **not** an SSM parameter: it is baked into the dashboard bundle at CI build
time and never read on the box.

**`BACKUP_BUCKET` has two sources and they must agree.** It is a GitHub repository variable
(`vars.BACKUP_BUCKET`, used by `deploy.yml` to upload release compose files) **and** an SSM
parameter at `/tutorlink/prod/BACKUP_BUCKET` (used by `deploy.sh`, `backup.sh` and
`restore-test.sh` on the box). A repository variable was chosen for CI rather than granting CI
`ssm:GetParameter`, for consistency with the other three deploy coordinates. If the two disagree,
the failure is not silent: `deploy.sh` aborts naming the release tag it could not find at
`s3://<their-bucket>/releases/<tag>/`. Set both to the same bucket name whenever either changes.

**Value constraint — read this before generating any secret.** `deploy.sh` renders every value
**single-quoted** into `.env` and **refuses outright** any value containing a single quote or a
newline. This is deliberate, not a bug to work around:

`docker compose --env-file` **interpolates** unquoted values. This was proven, not assumed: a
password of `harness$HOME-and-${NOPE}` reached the container as
`harness/Users/franklin.filho-and-` — a database credential silently rewritten, carrying a
fragment of the host's filesystem path into the password. Single-quoting is the one form
Compose's dotenv parser takes literally with no escape processing (double quotes still process
backslash escapes); a value containing a single quote cannot be single-quoted and still round-trip
through the parser, so `deploy.sh` refuses it rather than mangle it.

**If a generated secret is rejected, do not remove the check.** The check exists precisely because
"my password was rejected" is the moment someone is tempted to delete it — and a secret that is
*mangled* rather than *rejected* is worse: the container starts, health checks pass, and the first
symptom is an authentication failure nobody can explain. Generate secrets from an alphabet that
cannot contain either character: `openssl rand -hex 32` already does.

## 4. The instance

Amazon Linux 2023, **`t4g.small`** (2 vCPU / 2 GB, Graviton/arm64 — **VERIFY** current on-demand
price, ~$12/mo in us-east-1 at time of writing) per OQ-33's default. **This is why CI builds with
`--platform linux/arm64`** (`.github/workflows/deploy.yml`'s `BUILD_PLATFORM`) — an amd64 image
builds and pushes cleanly and then fails on the box with `exec format error`. If the box is ever
resized to an x86 family, this must change too.

**Instance profile**, in addition to `AmazonSSMManagedInstanceCore`:
- `ssm:GetParameters` and `kms:Decrypt` scoped to `/tutorlink/prod/*` (`arn:aws:ssm:<region>:<account-id>:parameter/tutorlink/prod/*`).
- **`s3:GetObject` on `arn:aws:s3:::<BACKUP_BUCKET>/releases/*`** — `deploy.sh` fetches the
  release's compose files from here. **If this is scoped only to `postgres/*` (the backup
  prefix), the first real deploy fails at the compose fetch, well after the parameter check has
  already passed.**
- `s3:PutObject` on `arn:aws:s3:::<BACKUP_BUCKET>/postgres/*` — for `backup.sh`.
- `s3:GetObject` and `s3:ListBucket` on the bucket — for `restore-test.sh`.

**Elastic IP**, attached to the instance.

**Security group: inbound 80 and 443 only, and no 22.** The deploy arrives over SSM Run Command
(OQ-34's default), not SSH, so there is no need for an inbound management port and no key material
in GitHub. **Port 80 must stay open — this is not only an HTTP-to-HTTPS redirect.** It carries
Caddy's ACME HTTP-01 challenge (`docker/Caddyfile`'s comment, REQ-082.5); closing it breaks
certificate renewal roughly sixty days later, which is the worst possible time to discover it,
since everything looks fine until then. 443/tcp and 443/udp (HTTP/3) are both needed —
`docker-compose.prod.yml`'s `caddy` service publishes both.

**Provisioning steps, in order:**
1. Install Docker and the Compose plugin (`dnf install -y docker`, enable and start the
   `docker` service, then the Compose plugin per Docker's AL2023 instructions — **VERIFY** the
   current package name).
2. Enable `dnf-automatic` for unattended security updates.
3. **`jq` is required and Amazon Linux 2023 does not install it by default.** `deploy.sh` checks
   for `aws`, `docker` and `jq` up front (`assert_preconditions`) and fails clearly if any is
   missing: `dnf install -y jq`.
4. Create `/opt/tutorlink/` and copy in **the bootstrap layer only**: `deploy/deploy.sh`,
   `deploy/backup.sh`, `deploy/restore-test.sh`, and the four unit files under
   `deploy/systemd/` (`tutorlink-backup.service`, `tutorlink-backup.timer`,
   `tutorlink-purge.service`, `tutorlink-purge.timer`). Make the three scripts executable.
   `systemctl link` (or copy to `/etc/systemd/system/`) the four unit files, then
   `systemctl daemon-reload` and `systemctl enable --now tutorlink-backup.timer
   tutorlink-purge.timer`.

   **Do not hand-place the Compose files here.** `docker-compose.yml` and
   `docker-compose.prod.yml` are release artifacts, fetched by `deploy.sh` from
   `s3://${BACKUP_BUCKET}/releases/<tag>/` on every deploy (`deploy.sh:fetch_compose_files`,
   uploaded by `.github/workflows/deploy.yml`'s "Upload the compose files as release artifacts"
   step). A hand-placed compose file goes stale the moment a service or an environment variable
   changes — the box then pulls a new image and runs it against an old file, and
   `deploy.sh`'s `assert_compose_variables_resolved` **cannot** catch this, because a file that
   never mentions the new variable leaves nothing unresolved. This also makes rollback correct: an
   older tag runs that tag's own compose files, not today's.

   **The residual, stated plainly: `deploy.sh`, `backup.sh`, `restore-test.sh` and the four unit
   files ARE hand-placed, and they can go stale.** Something has to place the fetcher, and this is
   where the recursion stops. **When any of these five files changes in the repo, re-copy it to
   the box and, for a unit file, re-run `systemctl daemon-reload`.** There is no CI step that does
   this for you. An honest small gap an operator knows about beats an invisible one.

**`deploy.sh` must run as root** — it writes `/opt/tutorlink/.env` at `0600 root:root` and drives
the system Docker daemon (`deploy.sh:assert_preconditions` checks `id -u` and refuses otherwise).
SSM Run Command satisfies this by default.

## 5. S3 and DLM snapshots

**The backup bucket** (`BACKUP_BUCKET` in §1 and §3): versioning **on**, all public access
blocked, and a lifecycle rule expiring objects under `postgres/` after a stated retention window —
30 days is a reasonable default for a single agency's nightly dumps; **this is a deliberate
choice, not a platform default**, and should be revisited if the retention obligation changes.
The bucket also holds `releases/<tag>/` (the compose file artifacts, §4) — do not apply the same
expiry rule to that prefix, or a rollback to an old tag loses its compose files.

**DLM (Data Lifecycle Manager) EBS snapshot policy**, targeting the instance's root volume, on a
daily schedule with a retention count (e.g. 7). This is REQ-084.3, and it covers what `pg_dump`
structurally cannot: Caddy's TLS certificates and ACME account state (`caddy_data` volume,
re-issuance is rate-limited), the fetched Compose files, and the generated `.env`. The two backup
layers are deliberately different shapes — the S3 dump is portable and restores into any
Postgres, anywhere (§9's migration path); the EBS snapshot only restores into a new EC2 volume,
but it is what makes "rebuild the box from nothing" (§9) a bounded job instead of a
reconstruction from memory.

## 6. Domain, DNS and TLS

**The real domain name is not yet chosen (#34) — deferred to the user, and it is not on the
critical path.** Until it is, use the public DNS name AWS assigns the instance automatically the
moment the Elastic IP is attached: of the form `ec2-<ip-with-dashes>.<region>.compute.amazonaws.com`
(`.compute-1.amazonaws.com` in us-east-1), visible in the EC2 console or via
`aws ec2 describe-instances --query 'Reservations[].Instances[].PublicDnsName'`. Nothing to
register, no cost, no DNS record to create — it already resolves the moment the Elastic IP is
attached, and it stays stable for as long as that Elastic IP stays attached to this instance
(releasing or reassigning the address changes it).

Set `DOMAIN` to that AWS-assigned name and `ACME_EMAIL` in SSM (§3) before the first deploy meant
to serve real traffic. Caddy obtains and renews its Let's Encrypt certificate against it exactly
as it would against a purchased domain (`docker/Caddyfile`'s global `email {$ACME_EMAIL}` block) —
nothing in the app or in Caddy's config distinguishes an AWS-assigned name from a bought one.

**Once the real domain is chosen:** create an A record at the chosen registrar/DNS provider
pointing to the same Elastic IP, change `DOMAIN` in SSM to the new name, and redeploy — Caddy
re-issues the certificate automatically. Same one-line change either way.

Two non-technical reasons the *real* domain still matters, neither solved by the stand-in above: a
domain transferred to a new registrar inside 60 days of registration is locked from transferring
again, which matters at any future handover; and the Twilio WhatsApp webhook URL (§7) is
registered against whichever name is live at the time — switching from the AWS-assigned name to
the real domain later means re-registering with Twilio, not just updating DNS. That
re-registration is an expected, one-time cost of using the stand-in now, not a defect of it.

## 7. Twilio

Once a domain is live — the AWS-assigned stand-in from §6 works here too — in the Twilio console
register:
- `https://<DOMAIN>/webhook/whatsapp` as the WhatsApp inbound webhook.
- `https://<DOMAIN>/webhook/whatsapp/status` as the status callback.

Set `TWILIO_STATUS_CALLBACK_URL` in SSM to the second URL, in full (REQ-082.2).

**Smoke test — required, and it cannot be checked anywhere else (REQ-082.3):** send a real
WhatsApp message to the registered number and confirm the request signature validates end to end
in production. A signature failure here most often means `TRUSTED_PROXIES` does not match Caddy's
address, or `/webhook/*` was left out of the Caddy route (`docker/Caddyfile`'s comment on this
exact mistake) — check `docker compose ... logs api` for a 403 from the signature check.

## 8. First boot

There is no public setup endpoint and never will be. Bootstrap the first accounts the same way
local development does (`Readme.md`), against the production stack:

```bash
cd /opt/tutorlink
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env \
  run --rm api python -m app.cli seed-admin
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env \
  run --rm api python -m app.cli create-developer
```

`seed-admin` is idempotent. `create-developer` never promotes an existing account — an admin may
not create or be promoted to `developer` — and exits non-zero rather than silently promoting one;
run it again with a fresh email to recover from a lockout. Neither command resets a password or
changes an existing account's role.

## 9. Operating it

**Deploy.** Push a tag matching `v*` (e.g. `git tag v1.0.0 && git push origin v1.0.0`), or run the
`Deploy` workflow manually via `workflow_dispatch` in the GitHub Actions UI. The workflow builds
and smokes both images, pushes them to ECR, uploads that tag's compose files to
`s3://${BACKUP_BUCKET}/releases/<sha>/`, then runs `/opt/tutorlink/deploy.sh <sha>` on the box
over SSM Run Command and fails the job if the SSM invocation does not report `Success`.

**Roll back.** Re-run the `Deploy` workflow against the previous tag, or run
`/opt/tutorlink/deploy.sh <previous-sha>` directly on the box (root shell, e.g. via
`aws ssm start-session`). This re-fetches that tag's own compose files, so an old tag runs against
the compose shape it was built with, not today's.

**State the limit plainly: this rolls back code, not a migration.** `deploy.sh` runs
`alembic upgrade head` — forward only — before swapping containers. A deploy that shipped a
destructive migration is **not** undone by re-running an older tag; the old code will run against
a schema it does not expect. Recovering from that means a manual downward migration or a restore
from backup (below), not a rollback.

**Where to look when something is wrong:**
```bash
cd /opt/tutorlink
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env ps
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env logs api
systemctl list-timers 'tutorlink-*'
systemctl status tutorlink-backup
journalctl -u tutorlink-purge
```

**Health checks are not reachable from the public internet.** `/health`, `/health/ready` and
`/docs` are root-level on the API and are deliberately not proxied by `docker/Caddyfile` — from
outside, those paths return the SPA, and `/api/health` does not exist at all. Check them from the
compose network instead:
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env \
  exec api curl -sf http://localhost:8000/health/ready
```

**Restore from backup.** Run on the box:
```bash
cd /opt/tutorlink
sudo ./restore-test.sh            # restores the newest S3 dump into a scratch database
sudo ./restore-test.sh <s3-key>   # or a specific dump, e.g. postgres/2026/09/tutorlink-20260922T030000Z.dump
```
This restores into `tutorlink_restore_test` (never production — the script refuses if
`SCRATCH_DB` equals the live database name), prints row counts for `users`, `tutors`, `bookings`,
`conversations`, `messages`, and drops the scratch database again on success. To promote a scratch
restore to production instead of merely verifying it: stop the `api` container, drop and restore
directly into the production database name, then restart `api`. This is a manual, deliberate
sequence — there is no scripted "promote" step, by design, because it is destructive and rare.

**Rebuild the box from nothing.** This is the procedure that turns the single-point-of-failure
risk (`08-CONTEXT.md` §2.5) into a bounded outage:
1. Launch a new instance from the most recent DLM snapshot (§5), or a fresh AL2023 instance if
   the snapshot is unavailable — reattach the Elastic IP.
2. If launched fresh rather than from a snapshot, redo §4's provisioning steps (Docker, `jq`,
   `/opt/tutorlink/`, the bootstrap layer, the systemd timers).
3. Run `deploy.sh <last-known-good-tag>` — it fetches that tag's compose files from S3 and its
   configuration from SSM; nothing about §3's parameters needs to be re-entered.
4. If the EBS snapshot did not carry the database (a fresh instance), restore the latest S3 dump
   into the live database name (the "promote" sequence above) before considering the box live.
5. Re-point DNS to the new Elastic IP if it changed.

**Moving off the box later (REQ-081, stated as a procedure):**
- **Postgres → RDS:** restore the latest `pg_dump` (§9's restore procedure) into the RDS instance,
  then change `DATABASE_URL` in SSM to point at it.
- **Redis → ElastiCache Serverless:** change `REDIS_URL` in SSM. Nothing in Redis is durable
  application state (the AOF file only smooths a reboot), so there is nothing to migrate.
  **If ElastiCache is ever used, choose the Valkey engine, not Redis OSS** — Redis OSS and
  Memcached meter a 1 GB minimum against Valkey Serverless's 100 MB floor, roughly a 15× cost
  difference at the floor (`08-RESEARCH.md` §4, **VERIFY**).
- **Box → Fargate:** the same `tutorlink-api` / `tutorlink-web` images, in a Fargate task
  definition, behind an ALB. The application is already stateless by contract and the WebSocket
  fan-out already uses Redis pub/sub (P7-K), so this move needs no application change.

## 10. The restore record (REQ-084.4)

**Phase 8 is not done until this section contains real, dated output from `restore-test.sh` run
against production data on the actual box — not a description of what the script does.** Run:

```bash
cd /opt/tutorlink && sudo ./restore-test.sh
```

and paste its full stdout below, including the row-count table for `users`, `tutors`, `bookings`,
`conversations`, `messages`, and the closing line reporting how many of those five tables were
non-empty (the script itself requires at least 4 of 5, and fails loudly otherwise, because a
`pg_restore` of an empty dump also exits 0).

```
<PASTE restore-test.sh OUTPUT HERE — empty until a real restore has been performed>
```

## 11. Issue bookkeeping

- **#3 — close.** Login brute-force protection ships: `api/app/services/rate_limit_service.py`
  (274 lines), `api/tests/test_auth_rate_limit.py`, migration `0011`'s four
  `login_rate_limit_*` settings rows, per-IP and per-email buckets, a shared generic 429, and
  fail-open-on-unreachable-Redis, documented at `api-design.md:86-150`. One residual stays open
  and belongs to #17/#18, not here: the four rate-limit settings rows still accept negative
  values (P4-M).
- **#4 — close.** The premise (the `Secure` cookie flag keyed off a `DEBUG` setting) no longer
  holds: there is **no `DEBUG` setting anywhere in the codebase**. `api/app/config.py:21` is
  `cookie_secure: bool = True`, `.env.example:14` ships `COOKIE_SECURE=true`, and
  `api/app/routers/auth.py:191` reads that setting directly.
- **#28 — close as DONE, not as obsolete.** An earlier pass called this obsolete on the theory
  that managed services have no Compose overlay to fix. There is a box and there is an overlay:
  `docker-compose.prod.yml` retracts `postgres`'s and `redis`'s published ports with
  `ports: !reset null`, and does the same for `api`'s port 8000 — only Caddy publishes 80/443 to
  the internet. The concern was real and it was fixed; "closed as done" and "closed as obsolete"
  read differently to whoever opens this issue next, and done is the accurate one.
- **#29 — close.** CI builds and pushes to ECR via the GitHub OIDC role in §1; no long-lived AWS
  access key exists in this repository. `.github/workflows/deploy.yml`'s `configure-aws-credentials`
  step assumes the role by ARN with no static credentials.
- **#30 — close.** `deploy.sh` pulls, migrates, then swaps: `alembic upgrade head` runs as its own
  step against the previous containers, which are only replaced (`up -d`) after it exits zero. A
  failed migration aborts the deploy with the old code still serving and the database unchanged
  (`deploy.sh:99-108`'s comment on why this ordering is load-bearing).
- **#31 — close.** Secrets live in SSM Parameter Store as `SecureString`, fetched by the
  instance's own IAM role, and rendered into a `0600 root:root` `.env` that is never committed —
  five secrets now (`SECRET_KEY`, `POSTGRES_PASSWORD`, `TWILIO_AUTH_TOKEN`, `ANTHROPIC_API_KEY`,
  `TWILIO_ACCOUNT_SID`), per §3.
- **#32 — close.** Nightly `pg_dump -Fc` to a versioned S3 bucket with a lifecycle expiry
  (`tutorlink-backup.timer` → `backup.sh`, §5), plus a tested restore (`restore-test.sh`, §10) —
  now also promoted to its own requirement, REQ-084.
- **#33 — close.** `TRUSTED_PROXIES` is configured to Caddy's fixed compose-network address, and
  `docker/Caddyfile` sets both `X-Forwarded-For` (overwritten, not appended) and
  `X-Forwarded-Proto`. The application code this needed had already shipped in an earlier phase;
  what remained was configuration plus proof, per §7's smoke test.
- **#34 — stays open.** The production domain is deliberately unchosen (§6); this is the one
  carried-in issue that does not close with this phase.

---

## Acceptance criteria not yet met

The following require a live AWS account and a live box, and are **not** satisfied by this
document existing:

- **REQ-084 (the tested restore, §10) is not met.** The restore record is an empty placeholder.
  Scripts existing is explicitly not the criterion — a dated, real `restore-test.sh` run with
  non-zero row counts in at least four tables must be pasted into §10 before this requirement is
  closed.
- **§1's IAM role, §2's ECR repositories, §3's SSM parameters, §4's instance and §5's S3
  bucket/DLM policy** have not been provisioned against a real AWS account by this task — they are
  documented, not created.
- **§6/§7 (domain, DNS, TLS, Twilio registration) can proceed on the AWS-assigned stand-in
  address without #34.** Only the *real* production domain stays blocked on #34, deliberately
  deferred to the user; picking it later means re-doing §6's DNS record and §7's Twilio
  registration against the new name, not a first-time setup.
- **The end-to-end human walkthrough** — a reader who did not write this runbook following §1–§8
  on a scratch AWS account to a running stack — has not been performed. Until it has, treat this
  runbook as unverified in that sense, even though every filename, variable and path in it was
  checked directly against the files in this repository rather than against the plan that
  preceded them.
