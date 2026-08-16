# TutorLink — API Design

## Overview

The TutorLink API is built with FastAPI and serves two consumers:

- **The WhatsApp bot** — calls endpoints internally within the FastAPI service to read and write booking data
- **The admin dashboard** — a Vite + React frontend that calls endpoints over HTTP using JWT tokens

All endpoints are prefixed with `/api/` except for auth and the Twilio webhook.

---

## List responses — the page envelope

**Every endpoint returning a list returns an envelope, never a bare array:**

```json
{
  "items": [],
  "total": 42,
  "page": 1,
  "page_size": 20
}
```

| Field | Meaning |
|---|---|
| `items` | The rows for this page |
| `total` | Rows matching the query **before** paging or any cap |
| `page` | 1-indexed |
| `page_size` | Rows per page |

**No exceptions.** This includes `/api/slots/available` and `/api/tutors/{id}/availability`, which are bounded by design and would never need paging. One contract everywhere is the point: carving out the endpoints that "obviously don't need it" reintroduces the "which shape is this one?" problem the envelope exists to remove, and the exceptions are never the ones you predicted.

It also earns something on the capped endpoints. `/api/slots/available` returns at most 5 slots, so `total` is what lets the bot say *"showing 5 of 8"* rather than implying 5 is all there is.

`total` counts matches, not returned rows. On a capped or paged response the two differ, and that difference is the useful part.

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

### `POST /auth/logout`

End the session. Revokes the presented refresh token and every token descended from it, so
the session cannot be resumed, and clears the refresh cookie.

The refresh token is read from the `refresh_token` cookie, falling back to the request body
for non-browser clients — the same transport as `POST /auth/refresh`. No request body is
required.

**Request** (optional, non-browser clients only)
```json
{
  "refresh_token": "<jwt>"
}
```

**Response** — `204 No Content`, with no body.

Returns `204` unconditionally, including when no token is presented or the token is already
revoked, expired, or malformed. Logging out is never an error and the response never reveals
whether a token was live.

Access tokens are deliberately not revocable; they expire on their own short lifetime. Logout
revokes the refresh side, which is what prevents the session from being renewed.

All `/api/*` endpoints require a valid JWT passed as a Bearer token:
```
Authorization: Bearer <access_token>
```

The JWT payload includes the user's role and tutor ID (if applicable):
```json
{
  "sub": "user_uuid",
  "role": "tutor",
  "tutor_id": "tutor_uuid",
  "exp": 1234567890
}
```

---

## Role-Based Access Control (RBAC)

TutorLink has three roles:

| Role | Access |
|---|---|
| `developer` | Everything `admin` has, plus developer-only system settings |
| `admin` | Full access to all endpoints and all data, except developer-only settings fields |
| `tutor` | Their own schedule, availability, exceptions and bookings, plus time-off requests |

Tutor accounts are scoped by `tutor_id` from the JWT. Any attempt by a tutor to access another tutor's data returns `403 Forbidden`.

`developer` is a **superset of `admin`**, not a parallel role. Every gate asks "admin or above" rather than "is admin", so a developer reaches every admin surface. The only thing that distinguishes them is field-level: developer-only settings fields.

### Who may create whom

| Actor | May create roles |
|---|---|
| `developer` | `developer`, `admin`, `tutor` |
| `admin` | `admin`, `tutor` — **never `developer`** |

**An admin may not create a `developer`, nor change any user's role to `developer`, including their own.** Enforced server-side on both `POST /api/users` and `PATCH /api/users/{id}`; omitting the option from the dashboard form is presentation, not enforcement. Without this the developer/admin boundary does not exist.

Because an admin cannot create one, the system cannot bootstrap itself over HTTP. The first developer account is created by a CLI command, which also serves as the lockout recovery path.

### Endpoint access by role

| Endpoint | Developer | Admin | Tutor |
|---|---|---|---|
| `GET /api/tutors` | All tutors | All tutors | Own profile only |
| `GET /api/tutors/{id}/availability` | Any tutor | Any tutor | Own only |
| `GET /api/tutors/{id}/exceptions` | Any tutor | Any tutor | Own only |
| `POST/PATCH/DELETE /api/tutors/*` | ✓ | ✓ | ✗ |
| `POST /api/tutors/{id}/exceptions` (time-off request) | ✓ | ✓ | Own only |
| `PATCH /api/exceptions/{id}` (approve/reject) | ✓ | ✓ | ✗ |
| `GET /api/bookings` | All bookings | All bookings | Own bookings only |
| `POST/PATCH /api/bookings` | ✓ | ✓ | ✗ |
| `GET /api/clients` | ✓ | ✓ | ✗ |
| `GET /api/subjects` | ✓ | ✓ | ✓ |
| `POST/PATCH/DELETE /api/subjects` | ✓ | ✓ | ✗ |
| `GET /api/users` | ✓ | ✓ | ✗ |
| `POST/PATCH/DELETE /api/users` | ✓ | ✓ (not `developer`) | ✗ |
| `GET /api/settings` | All fields | Admin-visible fields only | ✗ |
| `PATCH /api/settings` | All fields | Admin-visible fields only | ✗ |

### Settings

`GET /api/settings` and `PATCH /api/settings` — a singleton resource, no `{id}`.

**The gate is per field, not per route.** Both roles reach both endpoints; what differs is which fields come back and which may be written. An admin never receives a developer-only field, and a `PATCH` from an admin token naming one is refused rather than silently ignored. Hiding a field in the dashboard is presentation only.

Every setting that exists today is admin-visible. The mechanism is built ahead of its first developer-only occupant, and `is_developer_only` defaults to TRUE so a setting added without thought hides rather than leaks.

> ⚠️ **Tutors are no longer read-only.** `POST /api/tutors/{id}/exceptions` lets a tutor request time off, which an admin then approves or rejects. It is the only tutor write path, and a pending request does not block bookings — only an approved one does. Any test asserting the blanket read-only form needs to learn this exception.

---

## Users

```
GET    /api/users
GET    /api/users/{id}
POST   /api/users
PATCH  /api/users/{id}
DELETE /api/users/{id}
```

Admin only. Used to create and manage admin and tutor login accounts.

### `GET /api/users`

Returns all user accounts.

**Response**
```json
{
  "items": [
    {
      "id": "uuid",
      "email": "sarah@example.com",
      "role": "tutor",
      "tutor_id": "uuid",
      "is_active": true
    }
  ],
  "total": 42,
  "page": 1,
  "page_size": 20
}
```

### `POST /api/users`

Create a new user account. When creating a tutor account, provide the `tutor_id` to link it to an existing tutor profile.

**Request**
```json
{
  "email": "sarah@example.com",
  "password": "temporary_password",
  "role": "tutor",
  "tutor_id": "uuid"
}
```

### `PATCH /api/users/{id}`

Update email, password, role, or active status.

### `DELETE /api/users/{id}`

Soft delete — sets `is_active = false`.

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
{
  "items": [
    {
      "id": "uuid",
      "name": "Math",
      "description": "Mathematics tutoring",
      "is_active": true
    }
  ],
  "total": 42,
  "page": 1,
  "page_size": 20
}
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
{
  "items": [
    {
      "id": "uuid",
      "name": "Jane Doe",
      "phone_number": "+1234567890",
      "is_active": true
    }
  ],
  "total": 42,
  "page": 1,
  "page_size": 20
}
```

### `GET /api/clients/{id}`

Returns a single client with their children and their homes.

A client is a **guardian**. Address and access code belong to a `home`, not to the guardian: a child with separated guardians has two homes, either guardian may book into either, and siblings share the pair. The API keeps the word *client* because that is the business relationship; the table is `guardians`.

**Response**
```json
{
  "id": "uuid",
  "name": "Jane Doe",
  "phone_number": "+1234567890",
  "homes": [
    {
      "id": "uuid",
      "label": "Mum's",
      "address": "123 Main St",
      "access_code": "1234"
    }
  ],
  "children": [
    {
      "id": "uuid",
      "name": "Tommy Doe",
      "age": 12,
      "grade_level": 7,
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
  "home": {
    "label": "Mum's",
    "address": "123 Main St",
    "access_code": "1234"
  }
}
```

### `PATCH /api/clients/{id}`

Update client info (name, active status). Address and access code belong to a home and are edited through the home, not here.

### `GET /api/clients/{id}/bookings`

Returns all bookings for a client across all their children, in the standard page envelope. Supports filtering: `?status=confirmed&from=2026-08-01`

---

## Children

```
POST   /api/children
PATCH  /api/children/{id}
```

### `POST /api/children`

Create a child, linked to one or more guardians and one or more homes. Called by the bot during intake.

**Request**
```json
{
  "guardian_ids": ["uuid"],
  "home_ids": ["uuid"],
  "name": "Tommy Doe",
  "age": 12,
  "grade_level": 7,
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

Returns all active tutors. Supports filtering: `?subject_id=uuid&grade_level=7`.

`grade_level` is a **ceiling comparison, not a membership test**: it returns every tutor whose `max_grade_level` for the subject is at or above the requested grade. With no `subject_id`, it returns tutors with at least one qualifying subject assignment.

**Response**
```json
{
  "items": [
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
          "max_grade_level": 8
        }
      ]
    }
  ],
  "total": 42,
  "page": 1,
  "page_size": 20
}
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

Assign a subject to a tutor, with the highest grade level they cover in it.

**Request**
```json
{
  "subject_id": "uuid",
  "max_grade_level": 8
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
{
  "items": [
    {
      "id": "uuid",
      "day_of_week": 0,
      "start_time": "09:00",
      "end_time": "12:00",
      "is_active": true
    }
  ],
  "total": 42,
  "page": 1,
  "page_size": 20
}
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
{
  "items": [
    {
      "id": "uuid",
      "start_date": "2026-12-20",
      "end_date": "2026-12-31",
      "start_time": null,
      "end_time": null,
      "reason": "vacation",
      "notes": "Christmas break"
    },
    {
      "id": "uuid",
      "start_date": "2026-08-18",
      "end_date": "2026-08-18",
      "start_time": "09:00",
      "end_time": "12:00",
      "reason": "personal",
      "notes": "Dentist appointment"
    }
  ],
  "total": 42,
  "page": 1,
  "page_size": 20
}
```

### `POST /api/tutors/{id}/exceptions`

Add an exception. For a single day off, set `start_date` and `end_date` to the same date. `start_time` and
`end_time` are optional and must both be NULL or both be set — NULL blocks the whole day, set values block
only that portion of each day in the range.

**Request**
```json
{
  "start_date": "2026-08-18",
  "end_date": "2026-08-18",
  "start_time": "09:00",
  "end_time": "12:00",
  "reason": "personal",
  "notes": "Dentist appointment"
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

1. Fetches recurring ranges from `tutor_availability` for the requested day and cuts each into a grid, striding by `session_length_minutes + session_gap_minutes`
2. Removes slots blocked by `tutor_availability_exceptions` — the whole day when `start_time`/`end_time` are NULL, by time overlap otherwise
3. Removes slots already taken in `bookings`, by time overlap — `slot.start_time < booking.end_time AND slot.end_time > booking.start_time`

Step 1 strides rather than packing slots back-to-back because the tutor travels to the home between
sessions. From a 09:00–12:00 range at length 60 and gap 30, the stride is 90 minutes and the grid is
09:00–10:00 and 10:30–11:30; 11:30–12:00 is leftover and is not offered here. A slot is offered only if
it starts after `now + min_booking_lead_hours`.

`date` in the past returns **400**, as does a `date` further ahead than `booking_lookahead_days`.

Step 3 compares ranges, not start times. `session_length_minutes` is runtime-editable, so an existing
booking need not line up with the current grid: at a 45-minute length, a 60-minute booking at 10:00
straddles 09:45–10:30 and 10:30–11:15 and matches the start time of neither. Overlap subtraction drops
both; equality matching would offer both. See the availability query logic in `docs/erd.md`.

**Query Parameters**

| Param | Required | Description |
|---|---|---|
| subject_id | Yes | Filter by subject |
| grade_level | Yes | The child's grade. Matches tutors whose ceiling for the subject is at or above it |
| date | Yes | The requested session date (YYYY-MM-DD) |
| tutor_id | No | Filter to a specific tutor if client has a preference |

**Response**
```json
{
  "items": [
    {
      "tutor_id": "uuid",
      "tutor_name": "Sarah Miller",
      "availability_id": "uuid",
      "date": "2026-08-10",
      "start_time": "09:00",
      "end_time": "10:00"
    }
  ],
  "total": 8,
  "page": 1,
  "page_size": 5
}
```

Returns a maximum of 5 slots, ordered by start time, to keep the bot's response concise.

`total` is 8 while `items` holds at most 5: three further slots matched and were suppressed by REQ-043's cap. That is the number the bot needs in order to say "showing 5 of 8" rather than implying 5 is all there is.

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
{
  "items": [
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
  ],
  "total": 42,
  "page": 1,
  "page_size": 20
}
```

### `GET /api/bookings/{id}`

Returns full detail for a single booking, including the address and access code of **the booking's home** — not the guardian's. Once a child has two homes those are different things, and resolving through the guardian returns the wrong house whenever a session is at the other one.

### `POST /api/bookings`

Create a confirmed booking. Called by the bot after the client selects a slot.

**Validation**

The requested range is accepted when it satisfies all of the following:

1. it sits entirely inside an active `tutor_availability` range for that tutor and day
2. it overlaps no existing booking for that tutor with `status IN (pending, confirmed)` — `new.start_time < booking.end_time AND new.end_time > booking.start_time`
3. it is at least `session_gap_minutes` clear of the nearest booking on either side
4. it is not blocked by a `tutor_availability_exceptions` row covering `scheduled_date` — the whole day
   when `start_time`/`end_time` are NULL, or by time overlap when they are set

Rule 1 failing is **400**. Rules 2, 3 and 4 failing are **409**, the conflict case the error table already
names.

Rule 4 is checked here and not only in `GET /api/slots/available`. The grid is an offer, and an exception
can be added between the offer and the confirm — a same-day partial-day window especially, which is the
routine case that motivated the time columns. Without this rule the bot can confirm a slot it was offered
minutes earlier onto a tutor who has since gone unavailable, and an admin posting a time directly is never
checked against exceptions at all.

The endpoint does **not** require the range to land on a generated grid slot. The grid from
`GET /api/slots/available` is an offer mechanism for the bot, not an API constraint: an admin may book
the 11:30–12:00 leftover that a rigid grid strands. This is the only rule set compatible with
runtime-editable `session_length_minutes` and `session_gap_minutes` — under a grid-locked rule, changing
either setting would leave every existing booking failing its own validation the next time it is edited.

`scheduled_date` in the past returns **400**, as does a date further ahead than `booking_lookahead_days`.
A start time earlier than `now + min_booking_lead_hours` returns **400**.

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