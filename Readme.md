# TutorLink

TutorLink is a WhatsApp-based scheduling tool that helps tutoring businesses manage bookings. Clients book sessions directly through WhatsApp, while admins oversee tutor schedules and appointments from a central dashboard.

---

## How It Works

Clients message the TutorLink WhatsApp number to book tutoring sessions for their children. The bot guides them through an intake flow — collecting parent details, child information, subject, and preferred times — then matches them with an available tutor and confirms the booking.

Admins manage everything through a web dashboard: adding tutors, setting weekly availability, creating exceptions (vacations, days off), and viewing all upcoming bookings.

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
Twilio ──────────► FastAPI (Bot Backend)
                        │
              ┌─────────┴──────────┐
              ▼                    ▼
           Redis              PostgreSQL
      (conversation           (clients,
          state)            tutors, bookings)
                                   ▲
                                   │
                          Vite + React
                         (Admin Dashboard)
```

- **Twilio** receives WhatsApp messages and forwards them to the FastAPI webhook
- **FastAPI** processes each message, manages conversation state in Redis, reads/writes booking data to Postgres
- **Vite + React** admin dashboard talks directly to FastAPI REST endpoints
- **Redis** stores per-user conversation state with a 30-minute TTL — no long-term persistence needed
- **PostgreSQL** is the single source of truth for all business data

---

## Project Structure

```
tutorlink/
├── bot/                        # FastAPI backend
│   ├── main.py                 # App entry point + Twilio webhook
│   ├── routers/                # API route handlers
│   │   ├── bookings.py
│   │   ├── tutors.py
│   │   ├── clients.py
│   │   └── availability.py
│   ├── services/               # Business logic
│   │   ├── booking_service.py
│   │   ├── availability_service.py
│   │   └── conversation_service.py
│   ├── models/                 # SQLAlchemy models
│   ├── schemas/                # Pydantic schemas
│   ├── db.py                   # Database connection
│   └── redis_client.py         # Redis connection
├── dashboard/                  # Vite + React frontend
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Tutors.jsx
│   │   │   ├── Bookings.jsx
│   │   │   ├── Clients.jsx
│   │   │   └── Availability.jsx
│   │   └── components/
│   └── vite.config.js
├── docker-compose.yml
├── .env.example
└── README.md
```

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

4. Expose your local webhook to Twilio using [ngrok](https://ngrok.com)

```bash
ngrok http 8000
```

Set the resulting URL as your Twilio WhatsApp webhook: `https://<your-ngrok-url>/webhook/whatsapp`

---

## Environment Variables

```env
# Twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_NUMBER=

# Database
DATABASE_URL=postgresql://user:password@postgres:5432/tutorlink

# Redis
REDIS_URL=redis://redis:6379

# App
SECRET_KEY=
DEBUG=true
```

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
3. New clients go through intake: parent name → home address + access code → child info (loops for multiple children)
4. For each child: subject → tutor selection → preferred day/time → available slots → confirm
5. Booking is written to Postgres, confirmation sent to client
6. Returning clients can book new sessions, cancel, or reschedule

---

## Admin Dashboard Views

- **Tutors** — add, edit, and deactivate tutors; assign subjects and grade levels
- **Availability** — set weekly recurring schedules per tutor; add exceptions (vacation, days off)
- **Bookings** — view all upcoming and past sessions; manually create or cancel bookings
- **Clients** — view parent profiles, children, addresses, and booking history

---

## License

MIT