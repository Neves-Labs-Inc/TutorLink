# TutorLink — API Design

## Overview

The TutorLink API is built with FastAPI and serves two consumers:

- **The WhatsApp bot** — calls endpoints internally within the FastAPI service to read and write booking data
- **The admin dashboard** — a Vite + React frontend that calls endpoints over HTTP using JWT tokens

All endpoints are prefixed with `/api/` except for auth and the Twilio webhook.

---

## Authentication

TutorLink uses OAuth2 with JWT tokens, implemented natively via FastAPI's `OAuth2PasswordBearer`.

### Endpoints

```
POST /auth/token
POST /auth/refresh
```

### `POST /auth/token`

Standard OAuth2 password flow. Used by the admin dashboard login screen.

**Request**
```json
{
  "username": "admin@tutorlink.com",
  "password": "your_password"
}
```

**Response**
```json
{
  "access_token": "<jwt>",
  "refresh_token": "<jwt>",
  "token_type": "bearer"
}
```

### `POST /auth/refresh`

Exchange a refresh token for a new access token.

**Request**
```json
{
  "refresh_token": "<jwt>"
}
```

**Response**
```json
{
  "access_token": "<jwt>",
  "token_type": "bearer"
}
```

All `/api/*` endpoints require a valid JWT passed as a Bearer token:
```
Authorization: Bearer <access_token>
```

---

## Webhook

### `POST /webhook/whatsapp`

Twilio forwards all incoming WhatsApp messages to this endpoint. The signature is validated on every request before any processing occurs.

**Twilio Signature Validation**

Every request from Twilio includes an `X-Twilio-Signature` header. FastAPI validates this against your `TWILIO_AUTH_TOKEN` before handling the message. Requests with an invalid or missing signature are rejected with `403 Forbidden`.

**Request** _(sent by Twilio, not the dashboard)_
```
Form-encoded body:
  From: whatsapp:+1234567890
  Body: "I'd like to book a session"
  ...
```

**Response**

Returns a TwiML response with the bot's reply message.

---

## Subjects

```
GET    /api/subjects
POST   /api/subjects
PATCH  /api/subjects/{id}
DELETE /api/subjects/{id}
```

### `GET /api/subjects`

Returns all active subjects.

**Response**
```json
[
  {
    "id": "uuid",
    "name": "Math",
    "description": "Mathematics tutoring",
    "is_active": true
  }
]
```

### `POST /api/subjects`

Create a new subject.

**Request**
```json
{
  "name": "Math",
  "description": "Mathematics tutoring"
}
```

### `PATCH /api/subjects/{id}`

Update a subject's name, description, or active status.

### `DELETE /api/subjects/{id}`

Soft delete — sets `is_active = false`. Does not remove from database.

---

## Clients

```
GET    /api/clients
GET    /api/clients/{id}
POST   /api/clients
PATCH  /api/clients/{id}
GET    /api/clients/{id}/bookings
```

### `GET /api/clients`

Returns all clients. Supports optional query params: `?is_active=true`

**Response**
```json
[
  {
    "id": "uuid",
    "name": "Jane Doe",
    "phone_number": "+1234567890",
    "address": "123 Main St",
    "access_code": "1234",
    "is_active": true
  }
]
```

### `GET /api/clients/{id}`

Returns a single client with their children.

**Response**
```json
{
  "id": "uuid",
  "name": "Jane Doe",
  "phone_number": "+1234567890",
  "address": "123 Main St",
  "access_code": "1234",
  "children": [
    {
      "id": "uuid",
      "name": "Tommy Doe",
      "age": 12,
      "grade_level": "Grade 7",
      "school_name": "Lincoln Middle School"
    }
  ]
}
```

### `POST /api/clients`

Create a new client. Called internally by the bot during the intake flow.

**Request**
```json
{
  "name": "Jane Doe",
  "phone_number": "+1234567890",
  "address": "123 Main St",
  "access_code": "1234"
}
```

### `PATCH /api/clients/{id}`

Update client info (address, access code, name, active status).

### `GET /api/clients/{id}/bookings`

Returns all bookings for a client across all their children. Supports filtering: `?status=confirmed&from=2026-08-01`

---

## Children

```
POST   /api/children
PATCH  /api/children/{id}
```

### `POST /api/children`

Create a child linked to a parent. Called by the bot during intake.

**Request**
```json
{
  "parent_id": "uuid",
  "name": "Tommy Doe",
  "age": 12,
  "grade_level": "Grade 7",
  "school_name": "Lincoln Middle School"
}
```

### `PATCH /api/children/{id}`

Update child info.

---

## Tutors

```
GET    /api/tutors
GET    /api/tutors/{id}
POST   /api/tutors
PATCH  /api/tutors/{id}
DELETE /api/tutors/{id}

POST   /api/tutors/{id}/subjects
DELETE /api/tutors/{id}/subjects/{subject_id}
```

### `GET /api/tutors`

Returns all active tutors. Supports filtering: `?subject_id=uuid&grade_level=Grade 7`

**Response**
```json
[
  {
    "id": "uuid",
    "name": "Sarah Miller",
    "email": "sarah@example.com",
    "phone_number": "+1987654321",
    "bio": "Experienced Math and Science tutor",
    "is_active": true,
    "subjects": [
      {
        "subject_id": "uuid",
        "name": "Math",
        "grade_levels": ["Grade 6", "Grade 7", "Grade 8"]
      }
    ]
  }
]
```

### `GET /api/tutors/{id}`

Returns a single tutor with subjects and weekly availability.

### `POST /api/tutors`

Create a new tutor.

**Request**
```json
{
  "name": "Sarah Miller",
  "email": "sarah@example.com",
  "phone_number": "+1987654321",
  "bio": "Experienced Math and Science tutor"
}
```

### `PATCH /api/tutors/{id}`

Update tutor info or active status.

### `DELETE /api/tutors/{id}`

Soft delete — sets `is_active = false`.

### `POST /api/tutors/{id}/subjects`

Assign a subject (and grade levels) to a tutor.

**Request**
```json
{
  "subject_id": "uuid",
  "grade_levels": ["Grade 6", "Grade 7", "Grade 8"]
}
```

### `DELETE /api/tutors/{id}/subjects/{subject_id}`

Remove a subject assignment from a tutor.

---

## Availability

```
GET    /api/tutors/{id}/availability
POST   /api/tutors/{id}/availability
PATCH  /api/availability/{id}
DELETE /api/availability/{id}

GET    /api/tutors/{id}/exceptions
POST   /api/tutors/{id}/exceptions
DELETE /api/exceptions/{id}
```

### `GET /api/tutors/{id}/availability`

Returns the tutor's full weekly schedule.

**Response**
```json
[
  {
    "id": "uuid",
    "day_of_week": 0,
    "start_time": "09:00",
    "end_time": "12:00",
    "is_active": true
  }
]
```

### `POST /api/tutors/{id}/availability`

Add a recurring weekly slot.

**Request**
```json
{
  "day_of_week": 0,
  "start_time": "09:00",
  "end_time": "12:00"
}
```

### `PATCH /api/availability/{id}`

Update a slot's time or active status.

### `DELETE /api/availability/{id}`

Remove a recurring slot.

### `GET /api/tutors/{id}/exceptions`

Returns all exceptions for a tutor.

**Response**
```json
[
  {
    "id": "uuid",
    "start_date": "2026-12-20",
    "end_date": "2026-12-31",
    "reason": "vacation",
    "notes": "Christmas break"
  }
]
```

### `POST /api/tutors/{id}/exceptions`

Add an exception. For a single day off, set `start_date` and `end_date` to the same date.

**Request**
```json
{
  "start_date": "2026-12-20",
  "end_date": "2026-12-31",
  "reason": "vacation",
  "notes": "Christmas break"
}
```

### `DELETE /api/exceptions/{id}`

Remove an exception.

---

## Slots

```
GET    /api/slots/available
```

### `GET /api/slots/available`

The core endpoint used by the bot to find open slots for a client. Runs the full three-step availability check:

1. Fetches recurring slots from `tutor_availability` for the requested day
2. Removes slots blocked by `tutor_availability_exceptions`
3. Removes slots already taken in `bookings`

**Query Parameters**

| Param | Required | Description |
|---|---|---|
| subject_id | Yes | Filter by subject |
| grade_level | Yes | Filter by grade level |
| date | Yes | The requested session date (YYYY-MM-DD) |
| tutor_id | No | Filter to a specific tutor if client has a preference |

**Response**
```json
[
  {
    "tutor_id": "uuid",
    "tutor_name": "Sarah Miller",
    "availability_id": "uuid",
    "date": "2026-08-10",
    "start_time": "09:00",
    "end_time": "10:00"
  }
]
```

Returns a maximum of 5 slots, ordered by start time, to keep the bot's response concise.

---

## Bookings

```
GET    /api/bookings
GET    /api/bookings/{id}
POST   /api/bookings
PATCH  /api/bookings/{id}
```

### `GET /api/bookings`

Returns all bookings. Supports filtering: `?status=confirmed&tutor_id=uuid&from=2026-08-01&to=2026-08-31`

**Response**
```json
[
  {
    "id": "uuid",
    "child": { "id": "uuid", "name": "Tommy Doe" },
    "tutor": { "id": "uuid", "name": "Sarah Miller" },
    "subject": { "id": "uuid", "name": "Math" },
    "scheduled_date": "2026-08-10",
    "start_time": "09:00",
    "end_time": "10:00",
    "status": "confirmed",
    "notes": null
  }
]
```

### `GET /api/bookings/{id}`

Returns full detail for a single booking including parent address.

### `POST /api/bookings`

Create a confirmed booking. Called by the bot after the client selects a slot.

**Request**
```json
{
  "child_id": "uuid",
  "tutor_id": "uuid",
  "subject_id": "uuid",
  "availability_id": "uuid",
  "scheduled_date": "2026-08-10",
  "start_time": "09:00",
  "end_time": "10:00",
  "notes": null
}
```

**Response**
```json
{
  "id": "uuid",
  "status": "confirmed",
  "scheduled_date": "2026-08-10",
  "start_time": "09:00",
  "end_time": "10:00"
}
```

### `PATCH /api/bookings/{id}`

Update booking status. Used for cancellations, completions, and rescheduling.

**Request**
```json
{
  "status": "cancelled"
}
```

For rescheduling, cancel the existing booking and create a new one via `POST /api/bookings`.

---

## Error Responses

All endpoints return consistent error shapes.

```json
{
  "detail": "Booking not found"
}
```

| Status | Meaning |
|---|---|
| 400 | Bad request — validation error |
| 401 | Missing or invalid JWT |
| 403 | Forbidden — invalid Twilio signature |
| 404 | Resource not found |
| 409 | Conflict — e.g. slot already booked |
| 500 | Internal server error |