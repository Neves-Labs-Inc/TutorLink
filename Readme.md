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
| Database | PostgreSQL | Hosted on AWS RDS in production, Docker in dev |
| Conversation state | Redis | Temporary TTL-based state, Docker in dev |
| Admin dashboard | Vite + React | Reads/writes directly to Postgres via API |
| Hosting | AWS EC2 | Docker Compose in early stage, ECS when scaling |

---

## Architecture

```
WhatsApp
   │
   ▼
Twilio ──────────► FastAPI (Bot Backend) ───────┐
                        │                       │
              ┌─────────┴──────────┐            │
              ▼                    ▼            │ WebSocket
           Redis              PostgreSQL        │ (live chat)
      (bot flow                (clients,        │
          state)              tutors, bookings, │
                              chat history)     │
                                   ▲            │
                                   │            │
                          Vite + React◄─────────┘
                         (Admin Dashboard)
```

- **Twilio** receives WhatsApp messages and forwards them to the FastAPI webhook
- **FastAPI** processes each message, manages conversation state in Redis, reads/writes booking data to Postgres
- **Vite + React** admin dashboard talks directly to FastAPI REST endpoints
- **Redis** stores per-user bot flow state with a 30-minute TTL — no long-term persistence needed; the conversation history that state drives is persisted in Postgres, not Redis
- **PostgreSQL** is the single source of truth for all business data, including full conversation and message history
- **WebSocket** carries live chat between the dashboard and FastAPI — new messages and takeover changes push to connected admins instead of being polled for

---

## Project Structure

```
tutorlink/
├── api/                        # FastAPI service (dashboard REST API + WhatsApp bot)
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── db.py
│   │   ├── redis_client.py
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
├── docker/                     # Dockerfiles
│   ├── api.Dockerfile
│   └── dashboard.Dockerfile
├── docker-compose.yml
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
- Redis on port `6379`

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
REDIS_URL=redis://redis:6379/0
SECRET_KEY=change-me-generate-with-openssl-rand-hex-32
DEBUG=true

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

`TWILIO_STATUS_CALLBACK_URL` must be an absolute public URL — Twilio posts delivery statuses to it and cannot resolve a relative path or the service's own hostname.

---

## Deployment (AWS)

### Early Stage — Single EC2 Instance

1. Launch an EC2 instance (t3.small recommended)
2. Install Docker + Docker Compose
3. Clone the repo and set environment variables
4. Run `docker compose up -d`
5. Point your domain to the EC2 public IP
6. Update Twilio webhook URL to your production domain

### Production — EC2 + RDS + ElastiCache

When reliability becomes a priority:

- Migrate Postgres from Docker container to **AWS RDS**
- Migrate Redis from Docker container to **AWS ElastiCache**
- Update `DATABASE_URL` and `REDIS_URL` in your environment to point to the managed services
- EC2 continues running the FastAPI bot and React dashboard

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