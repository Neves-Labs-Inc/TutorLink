# TutorLink

TutorLink is a WhatsApp-based scheduling tool that helps tutoring businesses manage bookings. Clients book sessions directly through WhatsApp, while admins oversee tutor schedules and appointments from a central dashboard.

---

## How It Works

Clients message the TutorLink WhatsApp number to book tutoring sessions for their children. The bot guides them through an intake flow — collecting guardian details, the home, child information, subject, and preferred times — then matches them with an available tutor and confirms the booking.

Admins manage everything through a web dashboard: adding tutors, setting weekly availability, creating exceptions (vacations, days off), and viewing all upcoming bookings. They can also read every conversation the bot has had and step into one directly — taking over pauses the bot until the admin hands it back, so a client is never answered by both at once.

---

## Tech Stack

| Layer | Tool | Notes |
|---|---|---|
| WhatsApp | Twilio | Sandbox for dev, production when ready |
| Bot backend | FastAPI (Python) | Handles Twilio webhooks and business logic |
| Database | PostgreSQL | Docker container in dev and production (data on an EBS volume) |
| Admin dashboard | Vite + React | Reads/writes directly to Postgres via API |
| Hosting | AWS EC2 | Single instance running Docker Compose, provisioned with Terraform |

---

## Architecture

```
WhatsApp
   │
   ▼
Twilio ──────────► FastAPI (Bot Backend)
                        │
                        ▼
                   PostgreSQL
                   (clients,
               tutors, bookings)
                        ▲
                        │
                  Vite + React
                (Admin Dashboard)
```

- **Twilio** receives WhatsApp messages and forwards them to the FastAPI webhook
- **FastAPI** processes each message, reads/writes booking data to Postgres
- **Vite + React** admin dashboard talks directly to FastAPI REST endpoints
- **PostgreSQL** is the single source of truth for all business data

---

## Project Structure

```
tutorlink/
├── api/                        # FastAPI service (dashboard REST API + WhatsApp bot)
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── db.py
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   └── routers/
│   ├── alembic/
│   ├── tests/
│   └── pyproject.toml
├── dashboard/                  # Vite + React + TypeScript admin dashboard
│   └── src/
│       ├── pages/
│       ├── components/
│       ├── stores/
│       └── lib/
├── docker/                     # Dockerfiles and Caddy config
│   ├── api.Dockerfile          # dev API image
│   ├── api.prod.Dockerfile     # production API image
│   ├── dashboard.Dockerfile    # dev dashboard image
│   ├── web.Dockerfile          # production web image (dashboard build + Caddy)
│   └── Caddyfile
├── deploy/
│   └── remote-deploy.sh        # runs on the instance: pull, migrate, restart
├── infra/                      # Terraform for the production EC2 environment
│   ├── bootstrap/              # one-time S3 bucket for Terraform state
│   └── *.tf
├── scripts/
│   └── smoke-prod.sh           # local check of the production stack
├── .github/workflows/
│   └── deploy.yml              # manual deploy: ECR + SSM
├── docker-compose.yml          # local development
├── docker-compose.prod.yml     # production stack (postgres, api, web)
├── .env.example
└── Readme.md
```

The service is named `api/` rather than `bot/` because it serves both the Twilio webhook and the dashboard REST API from one process.

---

## Local Development

### Prerequisites

- Docker + Docker Compose
- A Twilio account (free sandbox is fine to start)

### Setup

1. Clone the repository

```bash
git clone https://github.com/your-org/tutorlink.git
cd tutorlink
```

2. Copy the environment file and fill in your values

```bash
cp .env.example .env
```

3. Start all services

```bash
docker compose up
```

This starts:
- FastAPI on `http://localhost:8000`
- Vite + React dashboard on `http://localhost:5173`
- PostgreSQL on port `5432`

4. Apply database migrations

```bash
docker compose run --rm api alembic upgrade head
```

Migrations are applied explicitly and never run automatically on startup.

5. Create the first account

```bash
docker compose run --rm api python -m app.cli seed-admin
docker compose run --rm api python -m app.cli create-developer
```

Both prompt for an email and password. There is no public setup endpoint and there never will be — the first accounts are created here, never over HTTP.

`create-developer` is the only way to get a `developer`: an admin may not create one, nor promote anyone to it, so the system cannot bootstrap its own super-user through the API. Run it again with a fresh email to recover from a lockout.

Neither command resets a password or changes an existing account's role. An email that is already taken is reported and left alone, and `create-developer` exits non-zero rather than promoting an existing admin.

6. Expose your local webhook to Twilio using [ngrok](https://ngrok.com)

```bash
ngrok http 8000
```

Set the resulting URL as your Twilio WhatsApp webhook: `https://<your-ngrok-url>/webhook/whatsapp`

---

## Environment Variables

```env
# App
DATABASE_URL=postgresql+psycopg://tutorlink:tutorlink@postgres:5432/tutorlink
SECRET_KEY=change-me-generate-with-openssl-rand-hex-32
COOKIE_SECURE=true

# Twilio (leave blank until Phase 7 — no webhook exists yet)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_NUMBER=
TWILIO_STATUS_CALLBACK_URL=

# Postgres (container)
POSTGRES_USER=tutorlink
POSTGRES_PASSWORD=tutorlink
POSTGRES_DB=tutorlink

# Dashboard (Vite)
VITE_API_BASE_URL=
VITE_API_PROXY_TARGET=http://api:8000
```

`COOKIE_SECURE` gates the `Secure` attribute on the refresh cookie and defaults to `true` when unset. Keep it `true` for any deployment reachable over the network — the refresh token is the long-lived half of the auth pair, and without `Secure` it travels over plain HTTP. Set it to `false` only for local plain-HTTP development, where a browser would refuse to store the cookie at all.

`TWILIO_STATUS_CALLBACK_URL` must be an absolute public URL — Twilio posts delivery statuses to it and cannot resolve a relative path or the service's own hostname.

---

## Deployment (AWS)

### Architecture

Production is one EC2 `t3.micro` in `us-east-1` running Docker Compose (Postgres, the API and a Caddy `web` container that serves the dashboard and proxies the API). Postgres data, Caddy certificates and the deploy files live on a separate 5 GB encrypted EBS volume mounted at `/srv/tutorlink`, so they survive instance replacement. Caddy serves HTTPS on `<elastic-ip-with-dashes>.sslip.io` until there is a domain. There is no SSH: shells go through SSM Session Manager. App secrets live in SSM Parameter Store under `/tutorlink/prod/`, and deploys are a manual GitHub Actions workflow that pushes images to ECR and runs them on the instance through SSM. Every AWS resource is tagged `Project=tutorlink`, `Environment=prod`, `ManagedBy=terraform`. The Terraform details (resources, variables, outputs) are in [`infra/README.md`](infra/README.md).

### Prerequisites

- Terraform >= 1.10
- AWS CLI v2 with working credentials for account `211125623243` (`aws login` for the default profile; check with `aws sts get-caller-identity`). No profile name is required: Terraform uses the default credential chain, and `AWS_PROFILE` works.
- The [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html) (`brew install --cask session-manager-plugin`)
- The `gh` CLI, logged in with `gh auth login` and with admin access to the repository

### One-time setup

Run these in order, from an empty AWS account.

1. Create the Terraform state bucket (keeps its own local state, run once):

   ```bash
   cd infra/bootstrap
   terraform init && terraform apply
   ```

   The main root's backend in `infra/versions.tf` names the bucket (`tutorlink-tfstate-<account-id>`); see [`infra/bootstrap/README.md`](infra/bootstrap/README.md).

2. Create the infrastructure:

   ```bash
   cd ../
   terraform init
   terraform apply
   ```

   The instance installs Docker and mounts the data volume on first boot, then waits for its first deploy.

3. Set the five repository variables from the Terraform outputs (from `infra/`):

   ```bash
   gh variable set AWS_REGION          --body "$(terraform output -raw region)"
   gh variable set AWS_DEPLOY_ROLE_ARN --body "$(terraform output -raw deploy_role_arn)"
   gh variable set ECR_API_REPO        --body "$(terraform output -raw ecr_api_repo_url)"
   gh variable set ECR_WEB_REPO        --body "$(terraform output -raw ecr_web_repo_url)"
   gh variable set SITE_URL            --body "$(terraform output -raw site_url)"
   ```

   There is no instance ID variable: the workflow finds the one running instance tagged `Project=tutorlink`, `Environment=prod`.

4. Wait a few minutes after `apply` for first-boot setup (Docker, data volume) to finish; the instance should show as Online under Systems Manager > Fleet Manager. If the first deploy fails on a missing instance or a missing `/srv/tutorlink/app`, wait and run it again.

5. Run the Deploy workflow. It only works on `main`: choose `main` in the Run workflow branch picker, because the deploy role trusts only runs on `main` and AWS rejects any other branch. Or:

   ```bash
   gh workflow run deploy.yml --ref main
   ```

   It finishes when `<SITE_URL>/health/ready` returns 200 over valid HTTPS. The first run also waits for Caddy to obtain its certificate.

6. Seed the first accounts. Open a session on the instance (from `infra/`):

   ```bash
   aws ssm start-session --region "$(terraform output -raw region)" --target "$(terraform output -raw instance_id)"
   ```

   then, inside the session, each command prompts for an email and password:

   ```bash
   sudo docker compose -f /srv/tutorlink/app/docker-compose.prod.yml --env-file /srv/tutorlink/app/.env run --rm api python -m app.cli seed-admin
   sudo docker compose -f /srv/tutorlink/app/docker-compose.prod.yml --env-file /srv/tutorlink/app/.env run --rm api python -m app.cli create-developer
   ```

   See [Local Development](#local-development) for what these commands do and refuse to do.

### Routine deploy

Run the Deploy workflow on `main` (the only branch AWS accepts; Actions > Deploy > Run workflow). It builds both images tagged with the commit SHA, pushes them to ECR, and has the instance pull them, run `alembic upgrade head` and restart the containers. A failed migration stops the deploy before the API and web containers are replaced, so the previous version keeps running. Only one deploy runs at a time.

After an instance replacement (a change to the `user_data` script makes Terraform replace the instance), just run Deploy again: it finds the new instance by its tags. The data volume and the Elastic IP carry over.

To check the production stack locally before deploying, run `scripts/smoke-prod.sh`. It builds both production images, starts the stack on `https://localhost` (needs Docker, curl, openssl and ports 80 and 443 free) and checks the routing and security headers.

### Day-to-day operations

- **Shell on the instance:** `aws ssm start-session --region "$(terraform output -raw region)" --target "$(terraform output -raw instance_id)"` from `infra/`. The app lives in `/srv/tutorlink/app/`.
- **Growing the data volume:** raise `data_volume_size_gb` (default 5), run `terraform apply`, then in an SSM session run `sudo xfs_growfs /srv/tutorlink`. A volume can never be shrunk.
- **Listing everything this project created:**

  ```bash
  aws resourcegroupstaggingapi get-resources --region us-east-1 --tag-filters Key=Project,Values=tutorlink
  ```

### Adding a domain

1. Set `domain` in `infra/terraform.tfvars` (gitignored), e.g. `domain = "app.example.com"`.
2. Add a DNS A record for that hostname pointing at `terraform output -raw public_ip`.
3. Run `terraform apply` in `infra/`.
4. Update the `SITE_URL` variable (`gh variable set SITE_URL --body "$(terraform output -raw site_url)"`) and run the Deploy workflow again so Caddy requests the new certificate.
5. Update the Twilio webhook URL once it exists.

### Known risks

- **There are no database backups yet.** The data volume holds the only copy of the database. Losing it loses the data.
- The data volume has `prevent_destroy`, so `terraform destroy` fails on it by design. Do not remove that guard without a backup.
- The `t3.micro` has no swap; watch for out-of-memory kills if the load grows.

---

## Conversation Flow Summary

1. Client messages TutorLink on WhatsApp
2. Bot checks if client is returning (by phone number)
3. New clients go through intake: guardian name → home address + access code → child info (loops for multiple children)
4. For each child: subject → tutor selection → preferred day/time → available slots → confirm
5. Booking is written to Postgres, confirmation sent to client
6. Returning clients can book new sessions, cancel, or reschedule
7. An admin may take over any conversation at any point — inbound client messages keep being recorded, but the bot stops replying until the admin releases the conversation back to it

---

## Admin Dashboard Views

- **Tutors** — add, edit, and deactivate tutors; assign subjects and grade levels
- **Availability** — set weekly recurring schedules per tutor; add exceptions (vacation, days off)
- **Bookings** — view all upcoming and past sessions; manually create or cancel bookings
- **Clients** — view guardian profiles, their homes, children, and booking history
- **Chats** — read every conversation the bot has had, filter by bot/human status, and take over or release a conversation

---

## License

MIT