# TutorLink — API Design

## Overview

The TutorLink API is built with FastAPI and serves two consumers:

- **The WhatsApp bot** — calls endpoints internally within the FastAPI service to read and write booking data
- **The admin dashboard** — a Vite + React frontend that calls endpoints over HTTP using JWT tokens

All endpoints are prefixed with `/api/` except for auth and the Twilio webhook.

This document is a contract specification: endpoints are specified before they are built, and several sections below describe endpoints that do not exist yet — where the two disagree, the code is the authority for what ships today and this document is the authority for what it must do.

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

## Soft deletes and the `is_active` filter

Nothing an admin manages is deleted. `DELETE /api/{resource}/{id}` sets `is_active = false` and the row stays in the database.

**Every list endpoint over a soft-deleted resource returns active rows by default and deactivated rows only when asked. Uniform, with no per-endpoint variation.**

| `?is_active` | Returns |
|---|---|
| omitted | active rows only |
| `true` | active rows only |
| `false` | deactivated rows only |

**The parameter is a boolean and there is no "both" state.** A caller cannot retrieve active and deactivated rows in one response; a full audit list is two requests and the sum of two `total`s. That is a real property of the contract, not an omission.

A value that is not a boolean is **400**, with the usual `{"detail": "<string>"}` body. A schema or type validation failure — a malformed body, a non-boolean query parameter — is always 400 and never 422, because the framework's validation error is converted; the 422 the status table lists is a different thing, a semantic refusal of an otherwise well-formed request rather than a validation failure — see [Error Responses](#error-responses).

`total` counts matches of the **filtered** query, before paging. A default request reporting `"total": 42` is reporting 42 *active* rows — a dashboard rendering that number is showing a count of active clients, not of clients. This follows from the envelope section's own `total` rule above; it is worth stating separately because it is the sentence a dashboard bug comes from.

**The five collection endpoints this governs, named:** `GET /api/users`, `GET /api/tutors`, `GET /api/subjects`, `GET /api/clients`, `GET /api/children` — every collection whose resource carries an `is_active` column. It is stated once here rather than on each because a rule written five times reads five different ways, and a dashboard table cannot explain to a user why one screen hides deactivated rows and another does not.

**Fetching one row by id ignores the flag.** `GET /api/{resource}/{id}` takes no `?is_active` and returns the row whatever its flag, and where the response carries `is_active` it reports the real state (not every by-id response documents the field today, so a caller that must distinguish a deactivated row needs it added to that endpoint's schema first). Three reasons: an id is an address and not a query, so there is no set to filter; the admin surface that deactivated a row is the surface that must be able to open it again in order to reactivate it; and a 404 for a deactivated row would make a soft delete indistinguishable from a hard one, which is the entire distinction the flag exists to draw. This is not the 403-not-404 rule from [Role-Based Access Control](#role-based-access-control-rbac) wearing a different hat — that rule is about *denial*, and a deactivated row is a state the response reports rather than something withheld.

**Two resources carry `is_active` and are deliberately outside this rule:**

- `tutor_availability` — `GET /api/tutors/{id}/availability` returns the tutor's full weekly schedule, inactive slots included, because this endpoint's purpose is to feed an availability editor, and an editor that hid disabled slots by default would leave them unreachable for re-enabling. Unlike the four collection endpoints above, this one deliberately does not filter. `PATCH /api/availability/{id}` toggles the flag.
- `homes` — homes are returned nested inside `GET /api/clients/{id}` and have no collection endpoint of their own; they are written through `POST /api/clients/{id}/homes` and `PATCH /api/homes/{id}`. A nested list inside a single-resource response is not a list endpoint and this rule does not reach it.
- `GET /api/households` is not a soft-delete list: it has no `?is_active` and always includes inactive guardians and children, each carrying its flag.

**Some resources carry no flag at all, and that is also deliberate: junctions, plus `tutor_availability_exceptions`.** Junction tables are hard deleted and carry no `is_active`: `child_guardians`, `child_homes`, `guardian_homes`, `tutor_subjects`. A junction is a link rather than an entity, so unlinking a guardian after a custody change is a `DELETE` that takes effect immediately. Neither does `tutor_availability_exceptions` carry one: `DELETE /api/exceptions/{id}` really erases the row, because a time-off request that was withdrawn or refused has no state worth keeping. Do not add one to the junctions or to `tutor_availability_exceptions` to make the rule look uniform — the rule is about entities an admin retires, and a link that still exists is a claim that is still true.

`children` gained `is_active` by decision on 2026-09-23: a child who stops tutoring is retired, not deleted — its links and booking history stay.

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

**Rate limited** — `429 Too Many Requests`, with `Retry-After` in seconds. This is the only
unauthenticated write surface in the system, so it is the only endpoint that is throttled (#3,
OQ-7). Two independent sliding windows, each with its own pair of settings:

| Bucket | Keyed on | Max attempts | Window |
|---|---|---|---|
| Per-IP | The direct socket peer | `login_rate_limit_ip_max_attempts` (20) | `login_rate_limit_ip_window_seconds` (900) |
| Per-email | The submitted address, lowercased and trimmed | `login_rate_limit_email_max_attempts` (5) | `login_rate_limit_email_window_seconds` (900) |

Wide and tight on purpose. The per-IP limit is generous enough not to lock out an office behind
one NAT while still making a password spray across every account from one host expensive; the
per-email limit is what makes guessing one account's password expensive from anywhere,
including a rotating botnet. Because the email bucket keys on the *normalised* address,
`Admin@X` and `admin@x` share one budget — the same normalisation the account lookup uses, so
varying the casing buys an attacker nothing.

**A slot is taken before the password is checked, not recorded after it.** Every request claims
its slot in both buckets up front and gives it back only if it turns out not to have been a
failure — a successful login returns its own slot, a refused one returns whatever it managed to
claim. Recording the failure afterwards instead sounds equivalent and is not: the endpoint runs
on a worker threadpool, so every request arriving during one bcrypt round would read the same
count and be admitted, making the configured number a floor rather than a ceiling. Measured
against the original implementation, thirty-two simultaneous attempts at a limit of five were all admitted
under the record-afterwards form and exactly five under this one.

**Only failures ultimately count**, so a shared address signing in correctly all morning is
never throttled by its own success — in either bucket. What a successful login must *not* do is
clear the bucket, and it does not: it removes only the one slot it took. A bucket-wide reset
would make the counter observable shared state, and an attacker parked one attempt short of the
limit could poll it and read a silent reset as proof that someone had just signed in — which
identifies the address as a live, in-use account and timestamps its sessions. That is the same
account-enumeration oracle the single 401 message and the dummy-hash round exist to close.

The 429 carries one generic message for both buckets and for every address. Naming the bucket
would tell an unauthenticated caller whether it was their account or their network that tripped,
and a message that appeared only for real accounts would reintroduce the enumeration oracle the
shared 401 exists to close.

Counting is backed by the `login_attempts` table in PostgreSQL — the same database the login
already reads the user from — so there is no separate store whose outage the limiter would have to
fail open around: if the database is down, login is down regardless. The reservation is committed
before the password is checked, so a refused attempt is counted even though the request then fails.
Concurrent attempts on one bucket are serialized with an advisory lock on the bucket key. Setting either `max_attempts` to `0` disables that
bucket outright; both at `0` is the kill switch, and it is an integer rather than a boolean
because `integer` is the only `value_type` the settings table has.

> **The client address is the socket peer unless a trusted proxy says otherwise.** The
> application reads `request.client`; `X-Forwarded-For` reaches it only through
> `ProxyHeadersMiddleware`, which `create_app()` mounts when `TRUSTED_PROXIES` is configured, and
> which honors the header only from a peer in that set. Trust is fail-closed: unset or empty
> mounts no middleware at all, so the address is the socket peer, full stop. That is correct when
> the API is reached directly and wrong behind a proxy — behind a proxy every request appears to
> come from the proxy and the per-IP bucket silently becomes one global bucket, which locks out
> every user at once rather than failing open or closed.
>
> `*` is not merely discouraged, it is unconfigurable — so are `0.0.0.0/0` and `::/0`. They trust
> the header from any peer and restore full spoofability, which is worse than the collapsed
> bucket because it looks like it is working. The setting refuses them at startup. A hostname
> does not work either, and does not warn: trust is matched against the peer address and nothing
> resolves a name, so `TRUSTED_PROXIES=my-load-balancer` would trust nothing while looking configured — the
> setting refuses that too. The value must be an IP address or a CIDR block.
>
> uvicorn's own proxy-header handling stays off (`--no-proxy-headers` in
> `docker/api.Dockerfile`), so that exactly one place decides trust. In production the API runs on
> ECS behind an Application Load Balancer. The peer is always one of the load balancer's nodes,
> whose private addresses sit inside the VPC, so `TRUSTED_PROXIES` is that VPC's CIDR (the default
> VPC is `172.31.0.0/16`). The load balancer **appends** the client address to any
> `X-Forwarded-For` it receives, and the middleware walks the header right to left, returning the
> first hop that is not trusted. A client-supplied `X-Forwarded-For` therefore sits to the left of
> the real address and is never picked. `X-Forwarded-Proto` is honored on the same terms, and the
> Twilio webhook reads it, because signatures are validated over the full request URL, scheme
> included.
>
> `TRUSTED_PROXIES` ships unset for local development. The production value is confirmed against
> the live service before it is trusted: failed logins from two different networks must appear as
> two separate per-IP buckets, and neither may carry a VPC address (`deploy/RUNBOOK.md`).

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
| `POST/PATCH/DELETE /api/tutors/*` (profile, subjects, availability — excludes `/exceptions`, see below) | ✓ | ✓ | ✗ |
| `POST /api/tutors/{id}/exceptions` (time-off request) | ✓ | ✓ | Own only |
| `PATCH /api/exceptions/{id}` (approve/reject) | ✓ | ✓ | ✗ |
| `DELETE /api/exceptions/{id}` | ✓ | ✓ | Own, pending only |
| `GET /api/bookings` | All bookings | All bookings | Own bookings only |
| `POST/PATCH /api/bookings` | ✓ | ✓ | ✗ |
| `GET /api/slots/available` | ✓ | ✓ | ✗ |
| `GET /api/clients` | ✓ | ✓ | ✗ |
| `POST/PATCH /api/clients` | ✓ | ✓ | ✗ |
| `POST /api/clients/{id}/homes`, `PATCH /api/homes/{id}` | ✓ | ✓ | ✗ |
| `GET /api/children` | ✓ | ✓ | ✗ |
| `GET /api/children/{id}` | ✓ | ✓ | ✗ |
| `POST/PATCH /api/children`, `POST /api/children/{id}/guardians` | ✓ | ✓ | ✗ |
| `GET /api/households` | ✓ | ✓ | ✗ |
| `GET /api/conversations` | ✓ | ✓ | ✗ |
| `GET /api/conversations/{id}` | ✓ | ✓ | ✗ |
| `GET /api/conversations/{id}/messages` | ✓ | ✓ | ✗ |
| `POST/DELETE /api/conversations/{id}/takeover` | ✓ | ✓ | ✗ |
| `POST /api/conversations/{id}/read` | ✓ | ✓ | ✗ |
| `POST /api/conversations/{id}/reactivation/approve`, `.../deny` | ✓ | ✓ | ✗ |
| `POST /api/conversations/{id}/handled` | ✓ | ✓ | ✗ |
| `WS /api/conversations/stream` | ✓ | ✓ | ✗ |
| `GET /api/subjects` | ✓ | ✓ | ✓ |
| `POST/PATCH/DELETE /api/subjects` | ✓ | ✓ | ✗ |
| `GET /api/users` | ✓ | ✓ | ✗ |
| `POST/PATCH/DELETE /api/users` | ✓ | ✓ (not `developer`) | ✗ |
| `GET /api/settings` | All fields | Admin-visible fields only | ✗ |
| `PATCH /api/settings` | All fields | Admin-visible fields only | ✗ |
| `GET /api/stats/overview` | ✓ | ✓ | ✗ |
| `POST /webhook/whatsapp` | No auth dependency — see below | | |
| `POST /webhook/whatsapp/status` | No auth dependency — see below | | |

> A `pending` exception is visible to both the tutor and admins but does not block bookings — only an `approved` one subtracts from availability. See [Availability](#availability) and `docs/erd.md`.

> The two webhook rows carry no auth dependency and no role check — Twilio calls them directly, with no user session behind the request. The `X-Twilio-Signature` validation described under each endpoint is the control that stands in its place: it is not an omission for a future task to close by adding one.

> A child's `date_of_birth` appears only on `/api/children` and `/api/clients/*`, which tutors
> cannot call. A child's `notes` appear there and in exactly one place a tutor can reach:
> `child.notes` on [`GET /api/bookings/{id}`](#get-apibookingsid), for the tutor assigned to that
> booking — learning needs and allergies are what the person in the room needs to know. Every
> other response a tutor can reach, the bookings list included, carries a child as `{id, name}`.
> No response a tutor can reach carries a date of birth or an age.

### Settings

`GET /api/settings` and `PATCH /api/settings` — a singleton resource, no `{id}`.

**The gate is per field, not per route.** Both roles reach both endpoints; what differs is which fields come back and which may be written. An admin never receives a developer-only field, and a `PATCH` from an admin token naming one is refused rather than silently ignored. Hiding a field in the dashboard is presentation only.

Every setting that exists today is admin-visible. The mechanism is built ahead of its first developer-only occupant, and `is_developer_only` defaults to TRUE so a setting added without thought hides rather than leaks.

That includes the four login rate limits — `login_rate_limit_ip_max_attempts` (20), `login_rate_limit_ip_window_seconds` (900), `login_rate_limit_email_max_attempts` (5), `login_rate_limit_email_window_seconds` (900). They are admin-tunable rather than constants because the right numbers depend on how a client's staff actually sign in — a shared office address behind one NAT looks like an attacker to a limit tuned for a home connection — and finding that out during an incident must not require a deploy. See [`POST /auth/token`](#post-authtoken) for what they do and what `0` means.

Also admin-visible: `default_phone_country_code` (1), the E.164 calling code used to normalise a `phone_number` given without one on `POST`/`PATCH /api/clients` and `POST /api/tutors`. It is a setting rather than a constant for the same reason the rate limits are — the right default depends on where a deployment's guardians and tutors actually live, and that should not require a deploy to change.

Also admin-visible: `max_slots_offered` (5), the maximum number of slots `GET /api/slots/available` returns in one response. It is a setting rather than a constant for the same reason the others are — how many options a guardian can usefully weigh in a chat message is a property of the deployment, not of the code. Raising or lowering it changes what is *offered* and not what is *counted*: `total` still reports every slot that matched, which is what lets the bot say "showing 5 of 8". Seeded by migration `0013`.

> ⚠️ **Tutors are no longer read-only.** `POST /api/tutors/{id}/exceptions` lets a tutor request time off, which an admin then approves or rejects. It is the only tutor write path, and a pending request does not block bookings — only an approved one does. Any test asserting the blanket read-only form needs to learn this exception.

### `GET /api/settings`

Returns every setting the caller's role may see. Takes no paging parameters — `page_size` always equals `total`, since a settings form must render every field it receives.

**Response**
```json
{
  "items": [
    {
      "key": "session_length_minutes",
      "value": "60",
      "value_type": "integer",
      "is_developer_only": false
    },
    {
      "key": "some_developer_only_setting",
      "value": "1",
      "value_type": "integer",
      "is_developer_only": true
    }
  ],
  "total": 2,
  "page": 1,
  "page_size": 2
}
```

An admin never receives the second item — a developer-only row is absent from `items` entirely, not present with a redacted `value`.

### `PATCH /api/settings`

Update one or more settings by key.

**Request**
```json
{"updates": [{"key": "session_length_minutes", "value": "90"}]}
```

`value` is always a string, mirroring the underlying column. The request is all-or-nothing: every update is validated before any is applied, and a duplicate key anywhere in `updates` is refused rather than letting the last occurrence silently win. The response is the same envelope `GET /api/settings` would return for that caller, reflecting the new state.

`PATCH` writes `value` only. It never creates, deletes, or reclassifies a row — migrations remain the only thing that does that, which is what makes `is_developer_only` trustworthy.

`value` is validated against the row's `value_type` before it is applied. `0` remains a valid value for a rate-limit `max_attempts` setting because it is the documented kill switch — see the rate-limit paragraph above.

| Status | When |
|---|---|
| 400 | Empty `updates`, a duplicate key, a non-string `value`, or a value that does not parse for the setting's `value_type` |
| 401 | No or invalid token |
| 403 | A tutor on either endpoint; an admin naming a developer-only key in `PATCH` |
| 404 | A key with no settings row, for any role |

**The asymmetry above is the section's whole point: a read filters silently, a write refuses loudly.** `GET` asks "what may I see" and a response listing only what the caller may see is a complete, honest answer. `PATCH` asks "change this specific thing", and silently not changing it would be a lie — so it is refused instead.

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

Returns user accounts, active by default. See [Soft deletes and the `is_active` filter](#soft-deletes-and-the-is_active-filter) for `?is_active=`.

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

Create a new user account. A tutor account names its tutor profile in exactly one of two ways — `tutor_id` to link a profile that already exists, or `tutor` to create one alongside the account. Sending both, or neither, is a **400**, and an `admin` or `developer` account may carry neither.

**Request** — linking an existing profile
```json
{
  "email": "sarah@example.com",
  "password": "temporary_password",
  "role": "tutor",
  "tutor_id": "uuid"
}
```

**Request** — creating the profile with the account
```json
{
  "email": "sarah@example.com",
  "password": "temporary_password",
  "role": "tutor",
  "tutor": {
    "name": "Sarah Chen",
    "phone_number": "(202) 555-0180",
    "bio": "Algebra and geometry"
  }
}
```

The nested `tutor` object carries **no email**: the profile takes the account's, so the address a tutor logs in with and the one their profile is found by cannot drift apart. `phone_number` is canonicalised like every other write path, so an unparseable number is a **400**. A profile already holding that email or that phone number is a **409** — for the email that means the profile exists and should be joined with `tutor_id` instead. Both rows are written in one transaction: a refused request leaves neither behind.

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
  MessageSid: SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  ...
```

**Order of operations**

1. Validate the `X-Twilio-Signature`. Invalid or missing is **403**.
2. Resolve the conversation by `From`, creating it on first contact.
3. Insert the inbound message with `author_kind = 'client'`, `status = 'received'` and Twilio's
   `MessageSid`. A duplicate SID means this delivery is a Twilio retry: the insert conflicts, nothing
   is recorded, and processing continues at step 5.
4. Update the conversation's `last_message_at`.
5. Branch on the conversation's `status`. A `human` conversation returns an empty TwiML document; a
   `bot` conversation runs bot processing as before, records the reply with `author_kind = 'bot'`,
   and returns it as TwiML.
6. In both branches, broadcast the new message to connected admin sockets — see
   [WebSocket](#websocket).

**When the bot cannot use the message**

Two situations look alike from the client's side — no useful reply arrives — but are not the same
failure and are handled differently.

A message the parser returns but the flow cannot act on (an answer that doesn't match what was
asked, an unrecognised choice) gets a re-prompt. A second consecutive one gets a second re-prompt.
A third failure in the same step stops the bot from asking again: it replies that it couldn't
follow along and an admin will reach out, leaves the flow state untouched — it expires 30 minutes
after its last write rather than being cleared — and flags the conversation `stuck`. The reply still
goes out; the flag brings an admin to look, it does not replace the answer the client is owed.

A parser outage — the model call itself failing, rather than returning something the flow can't use
— is not the client's fault and does not spend one of the two re-prompts. It flags the conversation
`parse_error` immediately, on the first failure, and still replies that an admin will reach out.
Burning a re-prompt on an outage would tell a client stuck behind a downed model to try rephrasing a
message that was never the problem.

Both flags are written to `flag_reason` and `flagged_at` as described in `docs/erd.md`, and neither
changes the conversation's `status` — a flagged conversation is still `bot` until an admin takes it
over.

**Intake questions.** A new guardian is asked, in order: their name; the home's address,
access code and an optional label; whether the child is already registered with another
guardian; then, per child, the child's name, **date of birth**, grade, school, and an
**optional notes question** that accepts "none" and never re-prompts. Nothing is written until
the notes answer of the first child arrives, and then everything is written in one
transaction. A date of birth that is not a real date between 1900-01-01 and today is
re-asked. Once collected, the date of birth, the notes, the address and the access code are
not sent to the parser again.

**A guardian the bot recognises by phone number is linked to the conversation.** When a
conversation has no `guardian_id` and the inbound number belongs to an existing guardian —
one an admin created, or one who changed handsets — the bot's turn backfills
`conversations.guardian_id`, exactly as a completed intake does.

The bot lists only active children. When a guardian names one of their own inactive children —
when asking to book, when answering which child a booking is for, or when giving a new child's
name — the bot asks whether to request reactivation; "yes" records the request on the
conversation and flags `reactivation_request`. A name is matched only against the guardian's own
children. A conversation holds at most one pending request; while one is pending, the bot refuses
another and says an earlier request is still waiting. A guardian whose children are all inactive
is offered to add a child. The bot never reactivates a child itself.

The message is recorded before the branch, not inside the `bot` arm. The whole point of a handoff is
that the admin can read what the client said while the bot was silent, so a paused conversation has
to be logged as fully as a running one. Recording as a side effect of bot processing would be the
cheaper change and would lose exactly the messages the feature exists to show.

`MessageSid` carries the idempotency. Twilio retries a webhook it believes failed — a timeout on our
side, a 5xx, a body it could not parse — and the retry arrives as the same message with the same
SID, so without a guard a slow response duplicates the client's line in the thread. The unique index
on `messages.twilio_sid` is that guard, and the insert itself is the check: the second write
conflicts and is discarded. A read-then-write "does this SID already exist?" test would be the
obvious alternative and is the same race as rule 2 under [`POST /api/bookings`](#post-apibookings) —
two retries landing together both read nothing and both insert.

**Response**

A `bot` conversation returns a TwiML response with the bot's reply message. A `human` conversation
returns an empty TwiML document, and nothing else:

```xml
<Response></Response>
```

Returning nothing at all is not the same thing and is not an option. Twilio expects a well-formed
TwiML body on every webhook and treats a non-200 or an unparseable body as a delivery failure to
retry, so expressing "say nothing" as "send nothing" turns a deliberately silent conversation into a
stream of retries against an endpoint that will keep declining to answer. An empty `<Response>` is a
valid instruction to send no reply, which is precisely the semantics of a paused bot: the webhook
succeeded, the message is recorded, and there is no outbound message to make.

`bot_flow_state` is untouched by a takeover. Live bot flow state keeps its 30-minute expiry and will
usually expire during a handoff of any length, so when the bot is released the client resumes from a
fresh state — the same behaviour as any other client who went quiet for half an hour. Freezing the expiry for
the duration of the handoff was the alternative and is worse: it restores a half-finished intake
that the admin has by then completed by hand, and the client is asked again for details already on
file.

### `POST /webhook/whatsapp/status`

Twilio's delivery status callback for outbound messages, pointed at the absolute URL in
`TWILIO_STATUS_CALLBACK_URL`. The `X-Twilio-Signature` is validated identically, and an invalid or
missing signature is the same **403**.

**Request** _(sent by Twilio)_
```
Form-encoded body:
  MessageSid: SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
  MessageStatus: delivered
  ErrorCode: 63016
  ...
```

The `MessageSid` is matched to a `messages` row and advances its `status`, recording `error_code`
when the status is `failed`. This callback advances messages sent through Twilio's REST API — an
admin's reply, sent from the socket — which are written `queued` and reach `sent`, `delivered` or
`failed` only through this callback. A bot reply is different: it is returned as TwiML in
`POST /webhook/whatsapp`'s own response, and Twilio mints a `MessageSid` for it only after reading
that response, so `twilio_sid` is NULL at the moment the row is written and this callback has nothing
to match it against. A bot reply is recorded `status = 'sent'` with `twilio_sid` NULL and never
reaches this endpoint. An inbound message is written `received` and never moves.

**Response** — `204 No Content`, with no body.

An unknown `MessageSid` is acknowledged with the same `204` and ignored rather than answered with a
`404`. Retention deletes messages on a schedule and Twilio's callbacks are not bounded by it, so a
status arriving for a purged message is an ordinary event, not an error; answering it with a `404`
would only teach Twilio to retry a row that no longer exists.

---

## Subjects

```
GET    /api/subjects
POST   /api/subjects
PATCH  /api/subjects/{id}
DELETE /api/subjects/{id}
```

### `GET /api/subjects`

Returns subjects, active by default. See [Soft deletes and the `is_active` filter](#soft-deletes-and-the-is_active-filter) for `?is_active=`.

**Response**
```json
{
  "items": [
    {
      "id": "uuid",
      "name": "Math",
      "description": "Mathematics tutoring",
      "is_active": true,
      "tutor_count": 3
    }
  ],
  "total": 42,
  "page": 1,
  "page_size": 20
}
```

`tutor_count` is the number of **active** tutors assigned to the subject: `tutors` rows with `is_active = true`, joined to the subject through `tutor_subjects`. **The filter is on `tutors.is_active` and on nothing else.** `tutor_subjects` is a junction, carries no `is_active` and is hard deleted — [Soft deletes and the `is_active` filter](#soft-deletes-and-the-is_active-filter) already names it as one. An implementation looking for a flag on the junction is looking for a column that does not exist.

**`max_grade_level` is ignored.** A tutor who covers the subject only to grade 3 still counts. The ceiling is a per-assignment bound, used by `GET /api/tutors?grade_level=` and by rule 5 of [`POST /api/bookings`](#post-apibookings); `tutor_count` answers a roster question — how many tutors teach this subject at all — and applying a grade filter here would give a subjects table a number that depends on a grade nobody named.

**A subject with no tutors reports `0`. The field is always present and is never omitted.** A response schema that varies by data forces every client to model the field as optional and then guess what its absence means. The field appears on `GET /api/subjects` items because those are the only subject bodies this contract documents; **if `POST`, `PATCH` or `DELETE /api/subjects` is ever given a response body it carries `tutor_count` on these same terms** — one subject shape across all four routes rather than a schema that varies by endpoint, and on `DELETE` that is the count as it stands after deactivation, which is the same number, since the subject's own `is_active` does not enter it.

**The subject's own `is_active` does not affect the count.** A deactivated subject retrieved with `?is_active=false` reports its real active-tutor count, which is the number an admin needs before reactivating it or before reassigning its tutors.

**`total` is unchanged: it counts subjects, not tutors.** A `LEFT JOIN` plus `COUNT` is exactly where a `total` accidentally becomes a count of join rows, and [List responses — the page envelope](#list-responses--the-page-envelope) already fixes what `total` means.

**Every role that may read `GET /api/subjects` sees `tutor_count`, tutors included.** Stated rather than left to be noticed: it is roster-size information carrying no name and no identity, the response schema does not vary by role, and hiding the column in the dashboard would be presentation only.

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

Returns clients, active by default. See [Soft deletes and the `is_active` filter](#soft-deletes-and-the-is_active-filter) for `?is_active=`. Also supports `?phone_number=` and `?q=`.

`?phone_number=` is how the bot resolves a returning client before intake. It is a **filter, not an address**: the response is the ordinary page envelope holding zero or one item — never a bare object, and never a 404. `total` is `0` when no client holds that number and `1` when one does, never more, because `guardians.phone_number` is UNIQUE (see [`guardians`](erd.md#guardians)). No match is an empty set rather than a missing resource: the collection exists either way, and "look up, then create when empty" is one branch on `total` rather than a caught error. [List responses — the page envelope](#list-responses--the-page-envelope) admits no exception to the envelope, and a lookup is not one.

The value is normalised the same way a `POST`/`PATCH` body is before it is compared against `guardians.phone_number`, so a human-typed `(202) 555-0123` finds the row stored as `+12025550123`. A value that cannot be parsed as a phone number at all is refused with **400**, the same rule `POST`/`PATCH` apply to the field itself.

`?phone_number=` and `?is_active=` compose and `?is_active=`'s default is **not** special-cased for the lookup: `?phone_number=X` on its own finds an **active** client. A deactivated client is found with `?phone_number=X&is_active=false`. This matters on the intake path — see `POST /api/clients` below — because the lookup coming back empty does **not** guarantee the create will succeed: the UNIQUE constraint spans deactivated rows too.

`?q=` is the dashboard's search box, not the bot's lookup. It is a case-insensitive substring match against the stored name **or** the stored phone number, and it composes freely with both parameters above. It takes any string: there is no minimum length, no maximum, and no format. `%`, `_` and `\` typed by a user match themselves rather than acting as wildcards.

**`?q=` is deliberately not normalised, and `?phone_number=` deliberately is.** They are different things and must stay so. `?phone_number=` is an address for one canonical row, so a human-typed `(202) 555-0123` is normalised to `+12025550123` before it is compared and an unparseable value is refused with 400. `?q=` is a *fragment*: `555` has no canonical form, and normalising it would turn a search box into a 400 on every partial number a user types. So `?q=555` searches the stored E.164 string as written and never refuses. Do not "fix" this by routing `q` through the normaliser.

**Response**
```json
{
  "items": [
    {
      "id": "uuid",
      "name": "Jane Doe",
      "phone_number": "+1234567890",
      "is_active": true,
      "home_count": 2,
      "child_count": 3
    }
  ],
  "total": 42,
  "page": 1,
  "page_size": 20
}
```

`home_count` and `child_count` are additive fields carried on every item, always present and `0` when there are none — the same shape `tutor_count` takes on [`GET /api/subjects`](#get-apisubjects). The dashboard's client list renders them as columns.

**The two counts apply different predicates, and that is deliberate.** `child_count` counts every linked child, active or inactive; `home_count` counts only active homes. The asymmetry is deliberate: the count answers "how many children has this guardian had registered", and no screen reads it as "how many can be booked".

Both are computed as correlated scalar subqueries rather than joins. A join over `guardian_homes` would multiply the guardian row and turn `total` into a count of links rather than of clients, which [List responses — the page envelope](#list-responses--the-page-envelope) does not permit. A future count added here follows the same rule.

### `GET /api/clients/{id}`

Returns a single client with their children and their homes.

A client is a **guardian**. Address and access code belong to a `home`, not to the guardian: a child with separated guardians has two homes, either guardian may book into either, and siblings share the pair. The API keeps the word *client* because that is the business relationship; the table is `guardians`.

Carries `is_active`, reporting the real state whatever it is — see [Soft deletes and the `is_active` filter](#soft-deletes-and-the-is_active-filter) for why a by-id fetch ignores the flag as a filter but still reports it as a field.

**Response**
```json
{
  "id": "uuid",
  "name": "Jane Doe",
  "phone_number": "+1234567890",
  "is_active": true,
  "homes": [
    {
      "id": "uuid",
      "label": "Mum's",
      "address": "123 Main St",
      "access_code": "1234",
      "is_active": true
    }
  ],
  "children": [
    {
      "id": "uuid",
      "name": "Tommy Doe",
      "date_of_birth": "2014-05-02",
      "grade_level": 7,
      "school_name": "Lincoln Middle School",
      "notes": null,
      "is_active": true
    }
  ]
}
```

A child registered before date of birth replaced age has `"date_of_birth": null`.

The nested `homes` list carries `is_active` and returns **every** linked home, deactivated ones included — a nested list inside a single-resource response is not a list endpoint and the collection filter does not reach it, as [Soft deletes and the `is_active` filter](#soft-deletes-and-the-is_active-filter) states. The field is what lets a caller tell which of these homes `home_count` on [`GET /api/clients`](#get-apiclients) left out, since that count excludes the inactive ones. `homes` is an entity table with its own identity and is not a junction: `child_homes` and `guardian_homes` are the junctions, and they correctly carry no flag.

The nested lists do not say which home a given child is tutored at or which other guardians it has; [`GET /api/children/{id}`](#get-apichildrenid) does. A caller choosing a home for a booking reads the child, and `POST /api/bookings` rule 6 still adjudicates.

### `POST /api/clients`

Create a new client. Called internally by the bot during the intake flow.

**Never an upsert.** A `POST` naming a `phone_number` that any client already holds — active or deactivated — is refused with **409** and the `detail` string `A client with that phone number already exists`. It does not update the existing client. Upserting here would silently overwrite a real guardian's name and homes with whatever was just typed into WhatsApp: data loss reported as success, which is the one failure this endpoint cannot have.

Uniqueness is held by the `UNIQUE (phone_number)` constraint on `guardians`, not by the check that produces the message. The check is what turns a collision into a 409 with something readable in it; the constraint is what makes the collision impossible under two concurrent requests.

On a 409, the bot does not retry the `POST`; the same request fails the same way for as long as the other row exists. It re-runs the lookup — `GET /api/clients?phone_number=X`, then with `&is_active=false`, because a deactivated client is invisible to the first — and continues with the client it finds, reactivating it with `PATCH /api/clients/{id}` if it was deactivated. It never creates a second client for that number and never overwrites the existing one's name or homes.

A 409 here is a bug or a lost race, not a normal path: the bot resolves returning clients by lookup before intake, so reaching this endpoint at all means the lookup found nobody. A 409 anyway means the lookup's answer went stale between the two calls, the lookup was skipped, or the client was deactivated and the lookup was never going to see them.

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

Update client info (name, active status, phone number). Address and access code belong to a home and are edited through [`PATCH /api/homes/{id}`](#patch-apihomesid), not here.

`phone_number` may be updated — a guardian changes handset, or the number was mistyped at intake. The edit moves `guardians.phone_number` only. It does **not** move the client's existing conversation thread, which stays on the number it was actually held with; the next inbound message from the new number opens a second thread carrying the same client. See [`conversations`](../docs/erd.md#conversations).

A `phone_number` that **another** client already holds — active or deactivated — is refused with **409** and the same `detail` string `A client with that phone number already exists` that `POST /api/clients` returns: the duplicate-phone case has two entry points and one rule, so it has one message. **"Another client" excludes this one** — a `PATCH` carrying the client's own current number is a no-op on that field and returns 200, never a conflict with itself, including a `PATCH` that changes only the name and echoes the existing number back.

### `GET /api/clients/{id}/bookings`

Returns all bookings for a client across all their children, in the standard page envelope. Supports filtering: `?status=confirmed&from=2026-08-01`. Every filter [`GET /api/bookings`](#get-apibookings) defines — `?status=` including its repeated form, `?tutor_id=`, and `?from=`/`?to=` including the empty page for an inverted range — carries the same meaning here, applied within this client's bookings.

---

## Homes

```
POST   /api/clients/{id}/homes
PATCH  /api/homes/{id}
```

### `POST /api/clients/{id}/homes`

Add a home to an existing client — a guardian who moved, or a separated guardian's second
address — and optionally say which of the client's children are tutored there.

**Request**
```json
{ "label": "Dad's", "address": "9 Elm St", "access_code": "4321", "child_ids": ["uuid"] }
```

`label` is optional and a blank one is stored as `null`; `address` and `access_code` must not
be blank (**400**). `child_ids` is optional; each must be a child linked to this client, or the
request is **400** and nothing is written. The home is created active and linked to the client
and to each named child. An unknown client is **404**. Returns the home, `201`, in the nested
home shape.

### `PATCH /api/homes/{id}`

Edit a home's `label`, `address` or `access_code`, or deactivate and reactivate it with
`is_active`. There is no `DELETE`: a home is deactivated, never erased, because bookings point
at it.

An absent field is left alone. `label: ""` clears the label; a blank `address` or
`access_code` is **400**. Deactivating a home that still has a `pending` or `confirmed`
booking that starts after now (business time) is refused with **409**
`Home has upcoming bookings; cancel or move them first`, and nothing in the request is
applied — a deactivated home cannot be booked, and a live session would otherwise send a tutor
to an address the family has left. Links to children and guardians are never changed here. An
unknown home is **404**.

---

## Children

```
GET    /api/children
GET    /api/children/{id}
POST   /api/children
PATCH  /api/children/{id}
POST   /api/children/{id}/guardians
```

### `GET /api/children`

Returns children, active by default. See [Soft deletes and the `is_active` filter](#soft-deletes-and-the-is_active-filter) for `?is_active=`. Also supports `?q=` and paging.

`q` is trimmed; blank means no filter. It is a case-insensitive substring match against the
child's name or the name of any linked guardian. `%`, `_` and `\` typed by a user match
themselves rather than acting as wildcards, the same rule `?q=` follows on
[`GET /api/clients`](#get-apiclients).

Ordered by `Child.name`, then `Child.id`.

`guardians` lists every linked guardian, active or not, ordered by name then id. `homes` lists
only the child's **active** homes, ordered by creation. `next_session` is the child's earliest
booking that is live and starts after now (business time) — `null` when there is none.

**Response**
```json
{
  "items": [
    {
      "id": "uuid", "name": "Tommy Doe", "grade_level": 7, "school_name": "Lincoln Middle School",
      "is_active": true,
      "guardians": [{ "id": "uuid", "name": "Jane Doe" }, { "id": "uuid", "name": "John Doe" }],
      "homes": [{ "id": "uuid", "label": "Mum's", "address": "123 Main St", "is_active": true }],
      "next_session": {
        "id": "uuid", "scheduled_date": "2026-10-05", "start_time": "09:00:00", "end_time": "10:00:00",
        "tutor": { "id": "uuid", "name": "Sarah Miller" }, "subject": { "id": "uuid", "name": "Math" }
      }
    }
  ],
  "total": 1, "page": 1, "page_size": 20
}
```

### `GET /api/children/{id}`

An unknown id is **404** `Child not found`. The flag is ignored, as with every by-id fetch.

`upcoming_session_count` is the number of the child's bookings that are live and start after now
(business time) — exactly the set a deactivation would cancel.

`guardians` is ordered by name then id. `homes` lists **every** linked home, deactivated ones
included, each carrying `is_active` and `access_code`, ordered by creation.

**Response**
```json
{
  "id": "uuid", "name": "Tommy Doe", "date_of_birth": "2014-05-02", "grade_level": 7,
  "school_name": "Lincoln Middle School", "notes": null, "is_active": true, "upcoming_session_count": 2,
  "guardians": [{ "id": "uuid", "name": "Jane Doe", "phone_number": "+12025550123", "is_active": true }],
  "homes": [{ "id": "uuid", "label": "Mum's", "address": "123 Main St", "access_code": "1234", "is_active": true }]
}
```

### `POST /api/children`

Create a child, linked to one or more guardians and one or more homes. Called by the bot during intake.

**Request**
```json
{
  "guardian_ids": ["uuid"],
  "home_ids": ["uuid"],
  "name": "Tommy Doe",
  "date_of_birth": "2014-05-02",
  "grade_level": 7,
  "school_name": "Lincoln Middle School",
  "notes": "Peanut allergy"
}
```

`date_of_birth` is required and must be a real calendar date between `1900-01-01` and today;
anything else is **400** `date_of_birth must be a real date between 1900-01-01 and today`.
`notes` is optional, at most 2000 characters, and a blank value is stored as `null`.
`grade_level` stays an integer ≥ 1 and `school_name` stays required. A new child is always
active — there is no `is_active` field on this request.

**Response** (`201`, and the same shape from `PATCH`):
```json
{
  "id": "uuid",
  "name": "Tommy Doe",
  "date_of_birth": "2014-05-02",
  "grade_level": 7,
  "school_name": "Lincoln Middle School",
  "notes": "Peanut allergy",
  "is_active": true,
  "guardian_ids": ["uuid"],
  "home_ids": ["uuid"]
}
```

### `PATCH /api/children/{id}`

Update child info. Every field is optional and an absent field is left as it is. `notes: ""`
clears the notes; `date_of_birth` can be corrected but not cleared. `guardian_ids` / `home_ids`,
when present, replace the link set.

`is_active: false` deactivates the child; `true` reactivates it.

**Deactivation cancels the child's upcoming sessions.** With `is_active: false`, the child's
bookings that are live and start after now (business time) are found. If there are any and
`expected_cancellations` is absent or does not match their number, the request is refused with
**409** `Upcoming sessions changed; review them and confirm again` and nothing is applied.
Otherwise each of those bookings is cancelled in the same transaction as the deactivation. **No
notification of any kind is sent** — no WhatsApp to the guardians, no notice to the tutor. With
no upcoming sessions, `expected_cancellations` is ignored. Deactivating a child that is already
inactive cancels nothing.

**Removing a home a child has an upcoming session at is refused.** A `home_ids` set that drops a
home at which the child has a booking that is live and starts after now (business time) is **409**
`Child has upcoming bookings at a home being removed; cancel or move them first`, and nothing is
applied. Removing a guardian is not guarded beyond the existing "at least one guardian, at least
one home" rule.

**Check order:** unknown child (404) → `date_of_birth` (400) → an unknown guardian or home id
(400) → the home-unlink guard (409) → the deactivation count check (409) → apply, cancelling
sessions before assigning fields and links. Nothing is written before every check has passed.

Response: `ChildRead`, with `is_active`.

### `POST /api/children/{id}/guardians`

Link another guardian to an existing child — the second parent of a separated family. This is
how an admin fulfils a `guardian_link_request` flag: the bot never links a second guardian
itself (see [`POST /webhook/whatsapp`](#post-webhookwhatsapp)).

**Request** — exactly one of `guardian_id` or `guardian`:
```json
{ "guardian_id": "uuid", "home_ids": ["uuid"] }
{ "guardian": { "name": "John Doe", "phone_number": "+1987654321" }, "home_ids": [] }
```

`guardian_id` names an existing client (**400** if it does not). `guardian` creates one in the
same request, under the rules of `POST /api/clients` — an unparseable number is **400** and a
number any client already holds is **409** `A client with that phone number already exists`;
it is never an upsert. Both or neither is **400**. A guardian already linked to the child is
**409**. An unknown child is **404**.

`home_ids` chooses which of the child's **active** homes also become this guardian's own
homes (`guardian_homes`); any other id is **400**. It may be empty. It does not change which
homes the child is tutored at, and it does not limit where this guardian may book the child:
[booking rule 6](#post-apibookings) checks a booking's home against the child, never against the
booking guardian.

Everything is one transaction. Returns the child, `201`, in the `POST /api/children` response
shape.

---

## Households

```
GET    /api/households
```

### `GET /api/households`

Admin-only, and **not** a [soft-delete list](#soft-deletes-and-the-is_active-filter): there is no
`?is_active` parameter and inactive guardians and children are always included, each carrying its
own flag.

**Household** = a connected component of the bipartite graph guardians ⟷ children over
`child_guardians`. A guardian with no links is a household of one. A child enters only through a
link — the API refuses a child with no guardian.

Within a household, guardians are ordered by `(name, id)` case-insensitively and children the
same way. `key` is the first guardian's id — a render key for the card, not an address to fetch
by. Households themselves are ordered by their first guardian's name, case-insensitively, then id.

`q` is trimmed; blank means no filter. A household matches when **any** member matches: a
guardian's or a child's name contains `q` case-insensitively, or — when `q` with spaces, `+`,
`-`, `(`, `)` and `.` removed is non-empty and all digits — a guardian's phone number, with every
non-digit removed, contains those digits. The whole matching household is returned. `%` and `_`
have no special meaning here; the match happens in Python, not in SQL.

`total` counts matching households, before paging, and a household is never split across a page
boundary.

Computed on the server, in memory, per request, from three narrow reads (guardians, children,
`child_guardians`) rather than stored on a `household_id` column: the value is fully derivable,
and a stored column would need merge/split maintenance on every link write. This stays
comfortable at the system's realistic scale.

**Response**
```json
{
  "items": [
    {
      "key": "uuid",
      "guardians": [
        { "id": "uuid", "name": "Jane Doe", "phone_number": "+12025550123", "is_active": true },
        { "id": "uuid", "name": "John Doe", "phone_number": "+12025550199", "is_active": false }
      ],
      "children": [{ "id": "uuid", "name": "Tommy Doe", "grade_level": 7, "is_active": true }]
    }
  ],
  "total": 1, "page": 1, "page_size": 20
}
```

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

Returns tutors, active by default. See [Soft deletes and the `is_active` filter](#soft-deletes-and-the-is_active-filter) for `?is_active=`. Also supports filtering: `?subject_id=uuid&grade_level=7&q=sarah`.

`?q=` is a case-insensitive substring match on the tutor's name, and it composes freely with every parameter above. It takes any string: no minimum length, no maximum, no format. `%`, `_` and `\` typed by a user match themselves rather than acting as wildcards.

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

Returns a single tutor with subjects. Weekly availability is not embedded here — see `GET /api/tutors/{id}/availability`.

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
PATCH  /api/exceptions/{id}
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
      "start_time": "09:00:00",
      "end_time": "12:00:00",
      "is_active": true,
      "mode": "anywhere"
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
  "end_time": "12:00",
  "mode": "anywhere"
}
```

`mode` is optional and one of `traveler` (Home visits), `anywhere` (Home or office) or `only_office` (Office only). Omitted, it defaults to `anywhere`; an unknown value is a 400. The mode limits only what the bot offers; the Office can book any Location. Every slot is returned with its `mode`.

### `PATCH /api/availability/{id}`

Update a slot's time, active status or `mode`.

```json
{ "mode": "traveler" }
```

A `mode` change runs no booking checks and leaves existing bookings alone; omitting `mode` leaves it as it was.

### `DELETE /api/availability/{id}`

Remove a recurring slot. **This is a soft delete**: the row is kept with `is_active = false` and returned with **200**, not a 204. It cannot be anything else — `bookings.availability_id` is `NOT NULL`, so erasing the row would either fail against its own foreign key or orphan booking history. The slot stops being offered by `GET /api/slots/available` immediately; bookings already made against it are unaffected and stay valid. `GET /api/tutors/{id}/availability` still returns the row so the editor can re-enable it.

### `GET /api/tutors/{id}/exceptions`

Returns all exceptions for a tutor, including still-`pending` requests. A `pending` row is shown to both
the tutor and admins but has no effect on availability until it is approved — see rule 2 in
[Availability Query Logic](../docs/erd.md).

Supports filtering: `?from=2026-08-18&to=2026-08-24`

**`from` and `to` select rows that overlap the window, not rows contained by it**: a row matches when
`end_date >= from` and `start_date <= to`. Either bound may be given without the other, and omitting
both returns every row as before. This differs from [`GET /api/bookings`](#get-apibookings)'s `from`/`to`,
which bound a single date column — an exception spans a range of its own, and a row that began before
`from` and runs through the window must still be returned, since it is precisely the row a weekly grid
exists to show.

**Response**
```json
{
  "items": [
    {
      "id": "uuid",
      "tutor_id": "uuid",
      "start_date": "2026-12-20",
      "end_date": "2026-12-31",
      "start_time": null,
      "end_time": null,
      "reason": "vacation",
      "notes": "Christmas break",
      "status": "approved",
      "created_at": "2026-08-01T14:32:00Z"
    },
    {
      "id": "uuid",
      "tutor_id": "uuid",
      "start_date": "2026-08-18",
      "end_date": "2026-08-18",
      "start_time": "09:00:00",
      "end_time": "12:00:00",
      "reason": "personal",
      "notes": "Dentist appointment",
      "status": "pending",
      "created_at": "2026-08-01T14:32:00Z"
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

Callable by an admin or developer for any tutor, or by a tutor for themselves — a tutor naming another
tutor's id returns **403**. `status` is not a request field; a client cannot choose its own status. It is
set by who called the endpoint: a tutor's request lands `pending` and waits on admin review, while an
admin or developer's entry is `approved` immediately. Exceptions were admin-managed and immediately
blocking before tutor self-serve existed; forcing an admin to approve their own entry would be a step with
no gate value, so their writes keep the old behaviour.

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

**Response**
```json
{
  "id": "uuid",
  "tutor_id": "uuid",
  "start_date": "2026-08-18",
  "end_date": "2026-08-18",
  "start_time": "09:00:00",
  "end_time": "12:00:00",
  "reason": "personal",
  "notes": "Dentist appointment",
  "status": "pending",
  "created_at": "2026-08-01T14:32:00Z"
}
```

### `PATCH /api/exceptions/{id}`

Approve or reject a pending exception. Admin or developer only.

**Request**
```json
{
  "status": "approved"
}
```

`status` must be `approved` or `rejected` — `pending` is not an accepted target, since a row only ever
becomes pending by being created, never by transitioning back to it.

Only a `pending` row may transition. An already-`approved` or already-`rejected` row returns **409**: the
decision has already been made, and silently overwriting it would let a second admin action erase the
first without a trace. An unknown `id` returns **404**.

**Response**
```json
{
  "id": "uuid",
  "status": "approved"
}
```

### `DELETE /api/exceptions/{id}`

An admin or developer may delete any exception. A tutor may delete only their **own** exception, and only
while it is still `pending` — that is withdrawing a request before anyone has acted on it. Deleting an
`approved` or `rejected` exception as a tutor returns **403**: once an admin has ruled on a request, a
tutor must not be able to unilaterally undo that decision in either direction, whether that means erasing
a block they'd rather not have or erasing a rejection they disagree with.

---

## Slots

```
GET    /api/slots/available
```

### `GET /api/slots/available`

The core endpoint used by the bot to find open slots for a client. Runs the full three-step availability check:

1. Fetches recurring ranges from `tutor_availability` with `is_active = true` for the requested day and cuts each into a grid, striding by `session_length_minutes + session_gap_minutes`
2. Removes slots blocked by `tutor_availability_exceptions` rows with `status = 'approved'` — the whole day when `start_time`/`end_time` are NULL, by time overlap otherwise. `pending` and `rejected` rows are ignored.
3. Removes slots already taken in `bookings`, by **gap-expanded** time overlap — `slot.start_time < booking.end_time + session_gap_minutes AND slot.end_time + session_gap_minutes > booking.start_time`

Step 1 strides rather than packing slots back-to-back because the tutor travels to the home between
sessions. From a 09:00–12:00 range at length 60 and gap 30, the stride is 90 minutes and the grid is
09:00–10:00 and 10:30–11:30; 11:30–12:00 is leftover and is not offered here. A slot is offered only if
it starts after `now + min_booking_lead_hours`.

Step 1 also takes only rows with `is_active = true`. Deactivating a recurring slot is a soft delete, so
the row survives it, and a query that assumed a withdrawn slot was gone would keep offering it. Rule 1 of
`POST /api/bookings` already requires an **active** range, so the filter is what stops the bot offering a
slot the confirm then refuses with **400** — the same trap step 2's `status` filter avoids.

`date` in the past returns **400**, as does a `date` further ahead than `booking_lookahead_days`.

Step 3 compares ranges, not start times, and widens each booking by `session_gap_minutes` on both sides
before comparing. The gap is where the tutor travels, so a slot that merely abuts a booking, or sits inside
the travel gap beside one, is no more bookable than one that overlaps it — which is exactly what rule 3 of
`POST /api/bookings` says: "at least `session_gap_minutes` clear of the nearest booking on either side".
Subtracting by bare overlap here would offer slots the confirm then rejects with **409**, the offer surface
and the write path disagreeing about the same rows.

Both inequalities stay strict, so clearance of exactly `session_gap_minutes` passes, which is what rule 3's
"at least" means. At length 60 and gap 30, a booking filling the 09:00–10:00 grid slot leaves 10:30–11:30
offered, because `10:30 < 10:00 + 30` is false — and that is general rather than lucky, since the stride is
`length + gap` and consecutive grid slots are therefore always exactly a gap apart and never erase each
other. An admin booking 10:00–11:00, off-grid and abutting, does drop 09:00–10:00, which bare overlap would
have kept and rule 3 would then have rejected.

Ranges rather than start times, because `session_length_minutes` is runtime-editable and
`POST /api/bookings` does not require a booking to land on the grid at all. From the same 09:00–12:00 range
at length 45 and gap 30 the stride is 75 minutes, so the grid is 09:00–09:45 and 10:15–11:00, with
11:30–12:15 overrunning the range and 11:00–12:00 left over. An admin booking 09:30–10:30 directly starts
at neither 09:00 nor 10:15, yet takes the last 15 minutes of the first slot and the first 15 of the second.
Equality matching would find no slot to remove and offer both, double-booking the tutor. See the
availability query logic in `docs/erd.md`.

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
      "start_time": "09:00:00",
      "end_time": "10:00:00"
    }
  ],
  "total": 8,
  "page": 1,
  "page_size": 5
}
```

Returns a maximum of 5 slots, ordered by start time, to keep the bot's response concise.

**Which `is_active` this surface honours.** A slot is offered only when the tutor is active **and** the subject is active. A retired subject yields no qualified tutors here, the same way a retired tutor already yields none, so an unsatisfiable filter answers with an empty page rather than a refusal — this endpoint has never used a refusal shape for a filter that matches nothing. `tutor_availability.is_active` is honoured too: a withdrawn recurring slot generates no grid. Homes do not enter this endpoint at all.

This must stay in step with `POST /api/bookings` below. The offer surface and the write path reading the same rows by different rules is the defect class that produced #44 item 1, and it reappears silently: nothing fails, the bot is simply offered something the write path will refuse, or worse, allowed to confirm something the offer path had already stopped showing.

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

Returns all bookings. Supports filtering: `?status=confirmed&tutor_id=uuid&child_id=uuid&kind=evaluation&location=in_office&user_id=uuid&from=2026-08-01&to=2026-08-31`

`?child_id=` filters to one child's bookings. It composes with every filter above and with the
tutor scope on a tutor token; an unknown id returns an empty page, never a **404**.

**`?kind=regular|evaluation`** and **`?location=home|in_office`** filter on the booking's kind and Location. **`?user_id=`** filters to one Staff member's bookings by user id (`bookings.user_id`), an Admin's Evaluations included; `tutor_id` stays the teaching profile's id, and the two simply AND. All three compose with every other filter and with the tutor scope. On a tutor token the scope wins: `?user_id=<another user>` ANDs with the tutor's own rows and returns an empty page (`total: 0`, both counts `0`), never a **403** and never that user's rows. `?subject_id=` never returns an Evaluation, since an Evaluation has no subject.

**`counts_by_kind`** reports, for each kind, the `total` this same request would return with `kind` forced to that value: every other filter, the tutor scope and the date range apply, and `kind` itself is ignored. On the Regular tab `counts_by_kind.evaluation` is therefore still what the Evaluation tab would show. Only this endpoint returns it; the client bookings list (`GET /api/clients/{id}/bookings`) keeps the plain page.

**`?status=` may be repeated**, and repeated values are ORed: `?status=pending&status=confirmed` returns every booking in either status. A single `?status=confirmed` is the one-element case and means what it has always meant, and omitting `status` still returns every status. Repetition rather than a comma-separated list, because every filter in this contract carries one value per key: a comma inside a value slot would need an escaping rule that then has to be documented for every parameter, and a repeated key needs none. This is the first multi-value parameter in this contract, and the form is chosen here rather than improvised later.

**`from` and `to` are inclusive bounds on `scheduled_date`** — the date the session happens, not the date the booking was created. `?from=2026-08-10&to=2026-08-10` is exactly the sessions scheduled on 10 August. Either bound may be given without the other. **An inverted range — `from` later than `to` — is not an error: it selects nothing, so the response is the ordinary page envelope with `items: []` and `total: 0`.** It is neither refused nor special-cased. A caller that computes its window arithmetically can hand over whatever that arithmetic produced, including a window that collapsed to nothing, and read the answer off `total`; a 400 here would move that check into every caller and make `total` unavailable for exactly the case where `0` is the right answer.

**Response**
```json
{
  "items": [
    {
      "id": "uuid",
      "child": { "id": "uuid", "name": "Tommy Doe" },
      "staff": { "id": "uuid", "name": "Sarah Miller", "role": "tutor" },
      "kind": "regular",
      "location": "home",
      "subject": { "id": "uuid", "name": "Math" },
      "scheduled_date": "2026-08-10",
      "start_time": "09:00:00",
      "end_time": "10:00:00",
      "status": "confirmed",
      "notes": null,
      "updated_at": "2026-08-01T12:00:00"
    }
  ],
  "total": 42,
  "page": 1,
  "page_size": 20,
  "counts_by_kind": { "regular": 40, "evaluation": 2 }
}
```

`start_time`/`end_time` render with seconds — `"09:00:00"`, not `"09:00"` — the same `HH:MM:SS` form the API's exception schema already serialises. One time format across the API beats a booking-shaped response that differs from an exception-shaped one by a trailing `:00`. A `POST`/`PATCH` body may still submit either form; this is a response-serialisation fact, not an input restriction.

### `GET /api/bookings/{id}`

Returns full detail for a single booking, including the address and access code of **the booking's home** — not the guardian's. Once a child has two homes those are different things, and resolving through the guardian returns the wrong house whenever a session is at the other one.

`child` carries the child's current `notes` as well as `id` and `name` — `{ "id": "uuid", "name": "Tommy Doe", "notes": "Peanut allergy" }` — so the tutor assigned to the session knows about learning needs and allergies before arriving. It is the child's notes as they are now, not a copy taken when the booking was made, whatever the booking's status, and the same for every caller who may read the booking. The date of birth is not included. A tutor reading another tutor's booking is refused with **403**, as everywhere else. [`GET /api/bookings`](#get-apibookings) does not carry notes.

### `POST /api/bookings`

Create a confirmed booking. **Office only.** Called by the bot after the client selects a slot (a
Regular booking at a home with a Tutor or Manager), and by the dashboard for every shape below.

**The shapes.** A booking has a `kind` (`regular` or `evaluation`), a Staff member (`user_id`, a
Tutor, Manager or Admin — a Developer is not bookable and is refused like an unknown id) and a
`location` (`home`, naming one of the child's homes in `home_id`, or `in_office`, naming none). The
Staff member's role is read from `users.role` at write time. Which rules run depends on the kind and
the role (#130, #132, #133, #151):

| | Evaluation | Regular, Admin | Regular, Tutor/Manager |
|---|---|---|---|
| Staff role allowed | Admin or Manager | Admin | Tutor or Manager |
| `subject_id` | must be absent | required | required |
| `availability_id` | must be absent | must be absent | required: a range of that Staff member's profile (rule 1) |
| Gap (rule 3) | no | no | yes |
| Time off (rule 4) | no | no | yes |
| Grade ceiling (rule 5) | no | no | yes |
| Overlap (rule 2 + EXCLUDE) | yes | yes | yes |
| Home linked to the child (rule 6) | when `location = home` | when `location = home` | when `location = home` |
| Child not Evaluated, no live Evaluation (rules 8, 9) | yes | no | no |
| Window + lead time | hard block | hard block | hard block |
| Created status | `confirmed` | `confirmed` | `confirmed` |

A Manager with no teaching profile can take Evaluations; a Regular booking with them fails rule 1,
since no range can be theirs. Creating a booking here sends no WhatsApp message, for either kind.

**Validation**

The requested range is accepted when it satisfies every rule its column above says runs:

1. it sits inside the `tutor_availability` range the caller named, which must exist, be active and
   belong to the Staff member's teaching profile. The range being another profile's, withdrawn, or
   named by a Manager with no profile is a hard **400**; the time falling outside it — the wrong
   weekday or the wrong hours — is the `outside_slot` warning (below). The range's `mode` is not
   checked: it limits only the bot.
2. it overlaps no existing booking of that Staff member, of either kind, with
   `status IN (pending, confirmed)` — `new.start_time < booking.end_time AND new.end_time > booking.start_time`. This check exists to return a clean 409 with a useful message; the guarantee itself is held by the `excl_bookings_live_overlap` exclusion constraint (see `erd.md`), since a read-then-write check alone races under concurrent requests
3. it is at least the travel gap clear of the nearest live booking of that Staff member on either side, of either kind — refused when `new.start_time < booking.end_time + gap AND new.end_time + gap > booking.start_time` holds for any booking counted by rule 2. The gap is `session_gap_minutes` when either booking is at a home and **zero** when both are `in_office` (#132): two office sessions may run back to back. That is rule 2's comparison with the booking widened by the gap on both sides, and it is the comparison step 3 of `GET /api/slots/available` subtracts by, so the offer surface and this check read the same rows the same way. The inequalities are strict, so clearance of exactly the gap is accepted
4. it is not blocked by a `tutor_availability_exceptions` row with `status = 'approved'` covering
   `scheduled_date` — the whole day when `start_time`/`end_time` are NULL, or by time overlap when they
   are set. `pending` and `rejected` rows never block a booking.
5. the Staff member's `max_grade_level` for the **booked subject** is at or above the booked child's
   Subject level for that subject (never the Overall grade; with no level the comparison is skipped). The ceiling is per subject, so this resolves the `(tutor_id, subject_id)` pair from
   `bookings.subject_id` — there is no tutor-wide grade to fall back on. A Staff member qualified for the child's
   grade in one subject is still refused for a subject where their ceiling is lower. The boundary is
   inclusive: a ceiling equal to the child's level is accepted.

   A **missing** `tutor_subjects` row for the booked subject is a refusal, not a pass. With no assignment
   there is no ceiling to compare against, and the Staff member does not teach the subject at all. Written as a
   join that silently drops the row, the strongest possible violation would return success.

6. `home_id` is one of the booked child's homes — a `child_homes` row exists for
   `(child_id, home_id)`. Any other home is refused, including one belonging to a different family. Nothing to check `in_office`.

7. `booked_by_guardian_id`, when present, is one of the booked child's guardians — a `child_guardians`
   row exists for `(child_id, booked_by_guardian_id)`. NULL is always allowed and is the Office path.

8. (Evaluation) the child is not Evaluated: `children.evaluated_at IS NULL`. Clearing the mark reopens it.

9. (Evaluation) the child has no other live Evaluation — no booking with `kind = 'evaluation'` and
   `status IN (pending, confirmed)`. Completed and Cancelled ones do not count. The guarantee is the
   partial unique index `uq_bookings_one_live_evaluation_per_child`; this check is the readable 409.

**Status codes.** A missing or retired reference and rule 1's hard half are **400**, as are the window
gates. Rules 2 and 9 and unconfirmed warnings are **409**, the conflict case the error table already
names. Rules 5, 6, 7 and 8, a role the kind does not take, and a Subject, slot or home present or absent
against the kind or Location are **422** — the request is well-formed and conflicts with nothing, it
just names a combination that is not permitted: a Tutor asked to run an Evaluation, a Staff member not
qualified to teach that child at that level, a home the child does not live at, a guardian not linked
to the child, or a child already Evaluated.

Rules 6 and 7 are deliberately independent of each other. The home is checked against the **child**, never
against the booking guardian, so a guardian booking a session at the child's *other* home — the co-parent's
house — is accepted; that case is the reason the two columns exist. A rule phrased as "the home must belong
to the booking guardian" would wrongly refuse it. Rule 7 is what keeps that openness safe: a stranger
booking for someone else's child is refused because they hold no `child_guardians` link, and that link is
the only thing separating the two requests. Two siblings sharing a home each pass rule 6 on their own
`child_homes` row.

This enumeration is the authority for what `POST /api/bookings` enforces, and it belongs in one place in
code — ordered rule tables carrying these issue numbers as comments (rule 4 from #24, rule 5 from #36,
rules 6 and 7 from #38, rules 8 and 9 from #133), not prose scattered across issues. The list has been
amended four times; treat it as open and expect a fifth.

**Confirmable warnings (#151).** For a Regular booking with a Tutor or Manager, four checks are warnings
the Office may confirm rather than refusals: `outside_slot` (rule 1's time half), `gap` (rule 3),
`time_off` (rule 4) and `grade_ceiling` (rule 5). The contract:

1. Hard blocks are checked first and never come back as warnings: overlap, home not linked, the window
   and lead time, reference failures, the kind/role/Subject/slot/Location shape, and the Evaluation
   preconditions.
2. The service collects **every** failing warning rather than stopping at the first.
3. Any unconfirmed warning refuses with **409** and the body
   `{"detail": "...", "warnings": [{"code": "gap", "message": "..."}, ...]}`. The messages are the
   same sentences the hard refusals carry.
4. The client resubmits the same body with `confirm_warnings: ["gap", ...]`. The write lands only if
   every warning raised on **that** submission is listed; a new or unlisted one refuses again with a
   fresh `warnings[]` naming what is still unconfirmed. An unknown code is **400**.
5. Overrides are not recorded. The bot passes no confirmations, so every warning still refuses it as
   a plain 409 or 422 and it re-offers.

Rule 3 is checked here and not only in `GET /api/slots/available`, even though the two now apply the same
gap-expanded comparison. Agreement removes the case where a slot the bot was just offered is refused on
arrival; it does not remove the booking created between the offer and the confirm, which the offer could not
have seen. The admin dashboard's manual booking form also reaches this endpoint without passing through slot
matching at all.

Rule 4 is checked here and not only in `GET /api/slots/available`. The grid is an offer, and an exception
can be approved between the offer and the confirm — a same-day partial-day window especially, which is the
routine case that motivated the time columns. Without this rule the bot can confirm a slot it was offered
minutes earlier onto a tutor whose time off has since been approved, and an admin posting a time directly is
never checked against exceptions at all.

Rule 5 is likewise not redundant with the `grade_level` filter on `GET /api/slots/available`. That filter is
an offer mechanism, and `POST /api/bookings` is reachable directly from the admin dashboard's manual booking
form, which never passes through slot matching. Enforcing the ceiling only at the offer surface leaves it
unenforced on the path an admin actually uses.

Rules 6 and 7 sit in the endpoint for the same reason. The dashboard's manual booking form scopes its home
selector to the selected child, but that is a UI affordance on one client, not enforcement — the endpoint is
reachable without it.

The endpoint does **not** require the range to land on a generated grid slot. The grid from
`GET /api/slots/available` is an offer mechanism for the bot, not an API constraint: an admin may book
the 11:30–12:00 leftover that a rigid grid strands. This is the only rule set compatible with
runtime-editable `session_length_minutes` and `session_gap_minutes` — under a grid-locked rule, changing
either setting would leave every existing booking failing its own validation the next time it is edited.

`scheduled_date` in the past returns **400**, as does a date further ahead than `booking_lookahead_days`.
A start time earlier than `now + min_booking_lead_hours` returns **400**. Both apply to every kind.

**Request**
```json
{
  "child_id": "uuid",
  "user_id": "uuid",
  "kind": "regular",
  "location": "home",
  "subject_id": "uuid",
  "availability_id": "uuid",
  "home_id": "uuid",
  "scheduled_date": "2026-08-10",
  "start_time": "09:00",
  "end_time": "10:00",
  "booked_by_guardian_id": null,
  "notes": null,
  "confirm_warnings": []
}
```

`home_id` is required exactly when `location` is `home` and rule 6 validates it against the child's `child_homes` rows. It is not derivable once a child has two homes, which is the case the column exists for. `subject_id` is required for a Regular booking and must be absent on an Evaluation; `availability_id` is required for a Regular booking with a Tutor or Manager and must be absent otherwise. `booked_by_guardian_id` is optional and `null` is the Office path; when present, rule 7 validates it against `child_guardians`. `confirm_warnings` is optional and empty by default.

**Which `is_active` this endpoint honours.** A `user_id`, `subject_id`, `home_id`, `child_id` or `booked_by_guardian_id` naming a **deactivated** row is refused with **400**, exactly as a missing one is: a soft delete keeps the row and all its dependents, so an existence check alone would let this endpoint confirm a session against a Staff member `GET /api/slots/available` has already stopped offering. `users.is_active` is the only flag that decides whether a Tutor or Manager is active; `tutors.is_active` is not consulted. That 400 is deliberately not one of the 422s above — 422 refuses a *combination* of two individually valid rows, while a retired reference is a property of one row, which is what rule 1 already answers with 400. `tutor_availability.is_active` is rule 1's business rather than a reference failure: a withdrawn range names the wrong times, not the wrong row.

**Response**
```json
{
  "id": "uuid",
  "status": "confirmed",
  "scheduled_date": "2026-08-10",
  "start_time": "09:00:00",
  "end_time": "10:00:00"
}
```

### `PATCH /api/bookings/{id}`

Update booking status. Used for cancellations, completions, and rescheduling.

**`status` is the only writable field.** The request body carries nothing else, and `notes` in particular cannot be edited through this endpoint — a booking's notes are set at creation and are read-only thereafter. That is a property of this contract, not a gap in a client.

**The legal transitions are exactly these:**

| From | May move to |
|---|---|
| `pending` | `confirmed`, `cancelled` |
| `confirmed` | `cancelled`, `completed` |
| `cancelled` | — terminal |
| `completed` | — terminal |

Any other move is refused. `pending → completed` is deliberately **absent**: no path writes a `pending` booking today (`POST /api/bookings` always writes `confirmed`), so the edge is unreachable and adding it now would be speculative. When an intake path starts creating `pending` bookings, whether a session may be marked complete without ever being confirmed is a question to answer against this table rather than against an implementation's dictionary.

A transition is decided once. The endpoint reads the row under a lock, judges the move against this table, and writes; two concurrent callers cannot both pass the check and have one decision silently discarded.

**Request**
```json
{
  "status": "cancelled"
}
```

For rescheduling, cancel the existing booking and create a new one via `POST /api/bookings`.

---

## Dashboard aggregates

```
GET    /api/stats/overview
```

### `GET /api/stats/overview`

The admin dashboard's overview page in one request: five widgets — today's sessions, the rest of this week, active tutors, active clients, and the five most recently created bookings. It is purpose-built rather than composed from five list calls, so every count is computed in SQL rather than assembled client-side, and the page renders from one round trip.

**Authorization is `admin` or above.** A `tutor` receives **403** — never an empty payload and never a tutor-scoped variant. See [Role-Based Access Control](#role-based-access-control-rbac). These are whole-system metrics, and a role that may see only its own bookings has no correct value for any of them; an own-scoped variant would be a different endpoint answering a different question, and nothing has asked for one.

**The endpoint holds no clock.** `date` is a **required** query parameter and every window in the response is computed relative to it. That makes the response a pure function of the date and the data: deterministic, identical for every caller naming the same day, and assertable by a test without freezing anything. It is also the honest division of labour, because the caller already knows which day it means and the API does not. Making the caller name the date is the same shape [`GET /api/slots/available`](#get-apislotsavailable) already uses, where `date` is likewise required and the bot supplies it.

**This endpoint needs no clock because it has no rule that requires one.** The endpoints that do hold one hold it because their rules are about the present instant — a slot is offered only if it starts after `now + min_booking_lead_hours`, and a session cannot be booked into the past. Neither rule can be written without knowing what time it is. This endpoint states no such rule: it reads, and the window it reads is named by its caller.

That distinction matters because the endpoints that hold a clock read the business wall-clock defined by the `BUSINESS_TIMEZONE` setting (an IANA name, default `UTC`; an invalid name refuses boot). Scheduling columns are naive business-local wall-clock, and audit timestamps are timezone-aware UTC. This endpoint still takes its date from the caller.

A missing or malformed `date` is **400**, per [Error Responses](#error-responses).

Unlike `GET /api/slots/available`, **`date` here carries no past or future bound**. That endpoint bounds its `date` for the same reason it consults a clock at all: it is deciding what can be booked, and a slot in the past or beyond `booking_lookahead_days` cannot be. This endpoint decides nothing and bounds nothing. A reader who finds the same parameter name governed differently two sections apart is looking at a deliberate difference rather than a mistake.

**Query Parameters**

| Param | Required | Description |
|---|---|---|
| date | Yes | The reference date (YYYY-MM-DD). Every window below is relative to it |

**Response** — a single JSON object, **not** the page envelope, because this endpoint does not return a list:

```json
{
  "date": "2026-08-25",
  "week_end": "2026-08-30",
  "today_session_count": 12,
  "upcoming_week_session_count": 35,
  "active_tutor_count": 8,
  "active_client_count": 63,
  "recent_bookings": [
    {
      "id": "uuid",
      "child": { "id": "uuid", "name": "Tommy Doe" },
      "tutor": { "id": "uuid", "name": "Sarah Miller" },
      "subject": { "id": "uuid", "name": "Math" },
      "scheduled_date": "2026-08-27",
      "start_time": "09:00:00",
      "end_time": "10:00:00",
      "status": "confirmed",
      "notes": null
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `date` | Echoes the `date` parameter |
| `week_end` | The Sunday of the ISO week containing `date` |
| `today_session_count` | Live sessions on `date` |
| `upcoming_week_session_count` | Live sessions from the day after `date` through `week_end`, inclusive |
| `active_tutor_count` | `tutors` rows with `is_active = true` |
| `active_client_count` | `guardians` rows with `is_active = true` |
| `recent_bookings` | The five most recently created bookings, newest first |

**What counts as a session.** Both session counts count bookings whose `status` is **`pending` or `confirmed`** — the same set rule 2 of [`POST /api/bookings`](#post-apibookings) uses, and the same set the `excl_bookings_live_overlap` exclusion constraint is scoped by. `cancelled` and `completed` are excluded. This is deliberately the *only* definition of a booking that counts anywhere in TutorLink: a second one here — "everything not cancelled", say — would be a fifth place with a fourth opinion, which is the failure mode a purpose-built aggregate exists to avoid.

**`today_session_count` therefore falls as the day is worked through**, because marking a session `completed` removes it from the live set. That is the intended reading of the widget: sessions still live today, not sessions scheduled today.

**The windows.** Both are inclusive date ranges over `scheduled_date`, which is a bare date — no time-of-day comparison enters either count, and neither changes during the day except through a status change.

- `today_session_count` — `scheduled_date = date`. The whole calendar date, not the next 24 hours; a session at 08:00 counts all day.
- `upcoming_week_session_count` — `scheduled_date` from **`date` + 1 day through `week_end`, inclusive**. `week_end` is the **Sunday** of the ISO week containing `date`, because `tutor_availability.day_of_week` is 0 = Monday … 6 = Sunday throughout this system. One week convention, not two.
- The two windows are **disjoint by construction**: `date` itself is excluded from the upcoming window, so no booking is reported by both and the two widgets cannot double-count.
- **When `date` is a Sunday the upcoming window is empty and `upcoming_week_session_count` is `0`**, because the rest of that ISO week is already past. That is stated rather than left to be discovered: a dashboard should label the widget as the rest of this week, through `week_end`. On a Sunday `week_end` is `date` itself, so the window written as a query is `from=<date + 1 day>&to=<date>` — an inverted range, which [`GET /api/bookings`](#get-apibookings) answers with an empty page and a `total` of `0` rather than a 400. The count and that call therefore report the same `0`, and nothing on either side branches on the day of the week.

**The counts agree with the list endpoints.** This is the heart of the endpoint, and it is an obligation rather than an aspiration.

- `today_session_count` is the number of live bookings on `date`. **For an admin-or-above caller it equals the `total` of `GET /api/bookings?status=pending&status=confirmed&from=<date>&to=<date>`** — the same status set, the same inclusive bounds on the same column. That call is exactly the list a dashboard renders beneath this number, so the count and the rows agree by construction rather than by luck.
- `upcoming_week_session_count` equals the `total` of that same call with `from=<date + 1 day>&to=<week_end>`. **The equality holds on a Sunday as well**, where that call's `from` is a day later than its `to`: an inverted range returns an empty page, so both sides are `0` and the assertion needs no Sunday case.
- `active_tutor_count` is the number of `tutors` rows with `is_active = true`. **For an admin-or-above caller it equals the `total` of `GET /api/tutors?is_active=true`** — same column, same predicate, same treatment of the deactivated set.
- `active_client_count` is the number of `guardians` rows with `is_active = true`, equal to the `total` of `GET /api/clients?is_active=true` on the same terms and under the same role qualifier. A *client* is a `guardian`: neither `children` nor `homes` enters this count.
- **The role qualifier is load-bearing.** `GET /api/tutors` is scoped to "own profile only" for a tutor, so its `total` on a tutor token is 1, and `GET /api/bookings` is scoped to "own bookings only", so its `total` on that token counts that tutor's sessions rather than the system's. Only `admin` and `developer` can observe both sides of any of these equalities, and only they can call this endpoint at all — which is what makes the equality statable without a caveat rather than in spite of one.
- The aggregate and the list endpoint **must share one predicate per resource**: one function producing the filter that both the count query and the page query use, so the two cannot drift. Observable equality is what a test can assert; a shared predicate is what makes the equality hold for reasons rather than by coincidence.
- The equality is verified by test once both endpoints exist. Neither of them does today.
- The two active counts are counts of rows and are unaffected by `date`; the two session counts are functions of it by construction. All four equalities are with `total`, which counts matching rows before paging, so none of them depends on `page_size`.

**`recent_bookings` is a bare JSON array of at most five objects, not a page envelope.** [The envelope rule](#list-responses--the-page-envelope) governs endpoints whose response *is* a list; this response is an object with a list field, exactly like the `homes` array nested in `GET /api/clients/{id}` that [Soft deletes and the `is_active` filter](#soft-deletes-and-the-is_active-filter) already names as not a list endpoint.

**`GET /api/slots/available` does not govern here**, and it must be said, because a reader will find that precedent and it points the other way: it is capped at five and carries the full envelope. The difference is that its *entire response* is the capped list, and its `total` earns its place by letting the bot say "showing 5 of 8". There is no equivalent question here — the number a dashboard wants beside a recent-activity feed is not the count of all bookings ever, and `page: 1` of an object that cannot be paged reports nothing.

- **Ordering is `created_at` descending, tie-broken by `id` descending.** This is a feed of what was just booked, not of what happens next; the two session counts above already answer what happens next. `created_at` is an absolute instant, so ordering by it needs no zone this system does not have, unlike `scheduled_date + start_time`, which is a bare date beside a bare time and has no offset to order by. The `id` tie-break is there because ids are `gen_random_uuid()` and carry no insertion order — without it, two bookings created in the same transaction have no defined order and the endpoint is not deterministic.
- **Every status appears, `cancelled` and `completed` included.** That deliberately differs from the session counts above: the counts answer what is live, the feed answers what just happened, and a booking cancelled ten minutes ago is exactly the recent activity an admin opened the page to see. Each row's `status` field reports which it is.
- **Five is fixed and there is no parameter.** The widget is "last 5". A caller wanting more wants paging over an ordered `GET /api/bookings`, which is a change to that endpoint and not to this one.
- **Each object is identical to a [`GET /api/bookings`](#get-apibookings) item** — the same nine fields, the same nesting, the same names. That is deliberate: a second booking-summary shape is a second thing to keep in step.

**What this endpoint deliberately does not carry.** The dashboard's today's-sessions widget is a count *and a list*; only the count is here. The list is `GET /api/bookings?status=pending&status=confirmed&from=<date>&to=<date>`, which already exists in this contract, already pages and already returns the envelope. **The status filter is not optional decoration:** without it the list returns that day's cancellations too, and the widget renders a count above a list of different rows. Scoped this way the two agree, and the equality above says so. An aggregate endpoint returns aggregates: a second unbounded copy of a booking list inside this one would be a second path to the same rows, which is what this endpoint exists to remove rather than to add.

---

## Conversations

```
GET    /api/conversations
GET    /api/conversations/{id}
GET    /api/conversations/{id}/messages
POST   /api/conversations/{id}/takeover
DELETE /api/conversations/{id}/takeover
POST   /api/conversations/{id}/read
POST   /api/conversations/{id}/reactivation/approve
POST   /api/conversations/{id}/reactivation/deny
POST   /api/conversations/{id}/handled
```

Every WhatsApp conversation the bot has ever had, readable by an admin, and steppable into. A
conversation is keyed on the phone number rather than on the guardian, because the bot is talking
before a guardian row exists — intake collects the name several messages in. A `guardian` of `null`
therefore means intake has not got that far, not that something went wrong, and those are the
conversations an admin most wants to read.

Admin or above on all nine. A `tutor` token gets **403** on every one of them; chat is an admin
surface and there is no tutor-scoped view of it to fall back to.

### `GET /api/conversations`

Returns conversations in the standard page envelope, ordered by `last_message_at` descending so the
list reads as an inbox.

**Query Parameters**

| Param | Required | Description |
|---|---|---|
| status | No | `bot` or `human` — who is answering right now |
| unread | No | `true` restricts to conversations with messages newer than `last_read_at` |
| flagged | No | `true` restricts to conversations with a non-null `flag_reason` |
| q | No | Free-text match over the phone number and the linked guardian's name |

**Response**
```json
{
  "items": [
    {
      "id": "uuid",
      "phone_number": "+1234567890",
      "guardian": { "id": "uuid", "name": "Jane Doe" },
      "status": "human",
      "taken_over_by": { "id": "uuid", "email": "admin@tutorlink.com" },
      "last_message_at": "2026-08-20T14:31:02Z",
      "last_message_preview": "Could we move Tommy to Thursday?",
      "unread": true,
      "flag_reason": null
    }
  ],
  "total": 42,
  "page": 1,
  "page_size": 20
}
```

`unread` is computed against `conversations.last_read_at`, which is one watermark shared by every
admin rather than one per admin. This is a shared inbox for a small team, and a takeover is already
a shared act — the conversation is claimed by a person but visible to all of them. Per-admin unread
state would need a junction row per admin per conversation to deliver a personal badge nobody has
asked for.

`flag_reason` is `stuck`, `parse_error`, `guardian_link_request`, `reactivation_request` or `null`,
independent of `status` — a flagged conversation can still be `bot` (unattended) or already `human`
(an admin took over before reading why). `?flagged=true` restricts the list to conversations where
it is not null, which is what lets an admin triage the queue instead of scanning the whole inbox for
one. A flag stays until an admin marks the conversation handled or, for `reactivation_request`,
approves or denies the request; a later flag replaces an earlier one and re-stamps `flagged_at`.

### `GET /api/conversations/{id}`

The same object as a list item, plus the message counts the thread header shows. An unknown `id`
returns **404**.

**Response**
```json
{
  "id": "uuid",
  "phone_number": "+1234567890",
  "guardian": { "id": "uuid", "name": "Jane Doe" },
  "status": "human",
  "taken_over_by": { "id": "uuid", "email": "admin@tutorlink.com" },
  "taken_over_at": "2026-08-20T14:29:40Z",
  "last_message_at": "2026-08-20T14:31:02Z",
  "last_read_at": "2026-08-20T14:30:00Z",
  "flag_reason": null,
  "flagged_at": null,
  "reactivation_request": null,
  "message_count": 412,
  "unread_count": 3,
  "created_at": "2026-06-02T09:14:00Z"
}
```

`reactivation_request` is `{"child": {"id", "name", "is_active"}}` while a request is pending on
this conversation, `null` otherwise.

### `GET /api/conversations/{id}/messages`

The thread, in the standard page envelope with the same `page` and `page_size` as everywhere else,
ordered **newest first**. An unknown `id` returns **404**.

**Query Parameters**

| Param | Required | Description |
|---|---|---|
| before | No | ISO timestamp — return only messages older than this marker |

**Response**
```json
{
  "items": [
    {
      "id": "uuid",
      "author_kind": "admin",
      "author": { "id": "uuid", "email": "admin@tutorlink.com" },
      "body": "Thursday at 4pm works — I've moved it.",
      "status": "delivered",
      "created_at": "2026-08-20T14:31:02Z"
    },
    {
      "id": "uuid",
      "author_kind": "client",
      "author": null,
      "body": "Could we move Tommy to Thursday?",
      "status": "received",
      "created_at": "2026-08-20T14:29:11Z"
    }
  ],
  "total": 412,
  "page": 1,
  "page_size": 20
}
```

Newest first is the opposite of the rest of the API and is deliberate. A thread is read from its
end: page 1 has to be what the admin sees when the conversation opens, and oldest-first would make
that page the first twenty messages of a year-old conversation, reachable only by paging to a number
the client has to compute from `total`.

`before` is what makes paging back through a live thread stable. Offsets are counted from the newest
message, so a message arriving between two requests shifts every row down one and page 3 becomes a
different set that repeats one message and skips none-to-several. Passing the `created_at` of the
oldest message already on screen pins the window to a fixed point in the thread, and the arriving
messages land above it where they belong. It is a paging marker, not a filter on the conversation:
`total` still counts every message in the conversation before paging, which is what the envelope
contract requires and what lets the thread header say how much history there is.

There is no `direction` field. Inbound and outbound are derivable from `author_kind` — `client` is
inbound, `bot` and `admin` are outbound — and carrying both invites a row where they disagree.
`author` is populated only for `author_kind = 'admin'`; a bot message has no user behind it, and a
client message is identified by the conversation.

### `POST /api/conversations/{id}/takeover`

Claim the conversation. Sets `status` to `human`, `taken_over_by_user_id` to the caller and
`taken_over_at` to now, which pauses the bot: from this point `POST /webhook/whatsapp` records
inbound messages and answers with an empty TwiML document until the claim is released. No request
body. Returns the conversation object. An unknown `id` returns **404**.

**Response**
```json
{
  "id": "uuid",
  "phone_number": "+1234567890",
  "status": "human",
  "taken_over_by": { "id": "uuid", "email": "admin@tutorlink.com" },
  "taken_over_at": "2026-08-20T14:29:40Z"
}
```

A conversation already held by **another** admin returns **409** naming the holder. This is the same
reasoning as [`PATCH /api/exceptions/{id}`](#patch-apiexceptionsid): silently reassigning the claim
would let a second admin take a live conversation out from under the first with no trace, and the
first would go on typing into a thread they no longer own. The **409** names the holder because the
only useful next step is to go and ask them.

A conversation already held by the **caller** is a no-op **200** returning the unchanged
conversation. A double-click, or a retry after a dropped response, is not a conflict, and answering
it with a **409** would put an error in front of an admin whose state is exactly what they asked
for.

### `DELETE /api/conversations/{id}/takeover`

Release the conversation back to the bot. Clears `status`, `taken_over_by_user_id` and
`taken_over_at` together — the schema's CHECK ties them, so a holder without a pause, or a pause
without a holder, is unrepresentable. Returns the conversation. An unknown `id` returns **404**.

Any admin may release, not only the holder. The asymmetry with claiming is intentional: a claim that
only its owner can undo means an admin who closes their laptop for the day leaves a client talking
to nobody until that person comes back. Releasing is the safe direction — it hands the conversation
to the bot, which will answer — so the cost of letting anyone do it is far below the cost of a
conversation stuck in a pause.

Releasing a conversation that is already `bot` is a no-op **200**, for the same reason a duplicate
claim by the holder is: the caller asked for a state the conversation is already in.

The bot resumes from a fresh flow state, not from wherever it was when the takeover began — see
[`POST /webhook/whatsapp`](#post-webhookwhatsapp).

### `POST /api/conversations/{id}/read`

Sets `last_read_at` to now. No request body. Returns the conversation, so the caller gets the
recomputed `unread_count` without a second request. An unknown `id` returns **404**.

### `POST /api/conversations/{id}/reactivation/approve` and `.../reactivation/deny`

Resolve a pending reactivation request. Approve sets the child active; deny leaves it inactive.
Neither requires the caller to hold a takeover. No request body. Returns the conversation (**200**)
and publishes `conversation.updated` after the commit, exactly as takeover/release do. An unknown
conversation is **404** `Conversation not found`; no request pending is **409**
`No reactivation request is pending`. Nothing is sent to the guardian.

### `POST /api/conversations/{id}/handled`

Clears `flag_reason` and `flagged_at` on a flagged conversation. Body:

```json
{ "flagged_at": "2026-09-23T10:15:02.418367Z" }
```

`flagged_at` is the value the admin is looking at, timezone-qualified, echoed exactly as
`GET /api/conversations/{id}` returned it. The server compares it under a row lock: if the flag has
changed since (the bot flagged the thread again), the request is refused **409** `The flag changed
since you opened this conversation; review it and try again` and nothing changes, so a flag nobody
has seen is never cleared. A conversation that is not flagged returns **200** unchanged. A
`reactivation_request` flag is not cleared here — **409** `Approve or deny the reactivation request
instead` — and when another reason is cleared while a reactivation request is still pending on the
conversation, the flag returns to `reactivation_request` rather than to null, so a pending request
never leaves the flagged list. No takeover is needed; nothing is sent to the client and no message
is written. Returns the conversation (**200**) and publishes `conversation.updated`. An unknown
conversation is **404**; a malformed or timezone-less `flagged_at` is **400**.

---

## WebSocket

### `WS /api/conversations/stream`

One socket per admin session, carrying every conversation. The list screen and the open thread share
it; there is no per-conversation socket to open when the admin clicks into a thread and close when
they click out. An admin watching the inbox needs updates for conversations they have not opened,
so the socket has to be conversation-wide anyway, and a second per-thread socket would only add a
connection lifecycle to get wrong.

**Authentication reuses the access JWT and nothing else.** The first frame the client sends must be:

```json
{
  "type": "auth",
  "access_token": "<jwt>"
}
```

The server validates it exactly as the `Authorization` header is validated on `/api/*`, checks the
role is admin or above, and replies `{"type": "ready"}`. No other frame is accepted before then, and
a socket that has not authenticated within ten seconds is closed with `1008`.

The handshake exists because a browser cannot set an `Authorization` header on a WebSocket upgrade —
the API is a `new WebSocket(url)` call and nothing else. The two alternatives were both rejected.
Putting the token in the query string is the common workaround and writes a live credential into
every proxy log, access log and browser history entry along the path. Issuing a separate short-lived
ticket for the socket is a second credential scheme to mint, expire, revoke and audit, for a
transport that is already answering to the same users as the REST API. Sending the JWT as the first
frame keeps one credential, one validator and one role gate, and moves only the transport.

When the access token expires the server closes with `1008`. The client refreshes through
`POST /auth/refresh` and reconnects; the refresh token stays in its HttpOnly cookie and is never
seen by the socket, which is the reason the socket takes the access token rather than the long-lived
one.

**Frames from the client**

| type | Payload | Meaning |
|---|---|---|
| `auth` | `access_token` | First frame, always |
| `send` | `conversation_id`, `body`, `client_message_id` | Send an admin message to the client |

**Frames from the server**

| type | Payload | Meaning |
|---|---|---|
| `ready` | — | Authenticated |
| `message.created` | The message object, plus `conversation_id`, and `client_message_id` when echoing a send | A message was recorded, whatever its author |
| `message.updated` | The message object, plus `conversation_id` | Twilio reported a delivery status change |
| `conversation.updated` | The conversation object | Takeover claimed or released, or `last_message_at` moved |
| `error` | `detail` | Same shape as a REST error body |

A `send` naming a conversation that is not in `human` status is refused with an `error` frame. An
admin must claim the conversation before speaking into it, so that the client never receives an
admin line interleaved with a bot line answering the same message — the pause is what makes the
admin the only voice on the outbound side.

**Sending lives on the socket, and there is no REST twin.** A `POST /api/conversations/{id}/messages`
doing the same job would be a second path into the same state transition — insert the message, send
it through Twilio, broadcast it — and the two would drift the first time one of them grew a rule.
The socket already has to carry the message back to every other connected admin, so putting the send
on it makes the write an extra frame on a connection that exists, rather than a request whose only
purpose is to be echoed back down that same connection.

`client_message_id` is the client's own idempotency key, and it is the socket's counterpart to
`twilio_sid` on the inbound side. It comes back on the `message.created` echo, which is how the
composer matches its optimistic bubble to the persisted row instead of rendering the message twice,
and how a resend after a reconnect is recognised as the message that was already delivered rather
than sent a second time.

**The socket is not a delivery guarantee.** On reconnect the client refetches
`GET /api/conversations/{id}/messages` for the open thread and `GET /api/conversations` for the
list, rather than assuming the gap contained nothing. Reconnection is exponential backoff from one
second to a thirty-second ceiling. REST is the source of truth and the socket is how the client
learns it should ask — designing it the other way round means every dropped frame is permanent data
loss in the UI, recoverable only by a reload the admin has to think to perform.

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
| 400 | Bad request — a schema or type validation failure: a malformed body, a missing required field, a non-boolean where a boolean belongs. Every framework validation error arrives here, converted, so a client never sees a raw 422 from validation |
| 401 | Missing or invalid JWT |
| 403 | Forbidden — invalid Twilio signature, or a role reaching an endpoint or another tutor's data it is not entitled to |
| 404 | Resource not found |
| 409 | Conflict — e.g. slot already booked, or a client phone number that already exists |
| 422 | Unprocessable — a **semantic** refusal of a well-formed request, always raised deliberately and never produced by validation: e.g. a tutor's ceiling for the subject is below the child's grade. The distinction from 400 is whether the request was understood: 400 could not be read, 422 was read and refused |
| 500 | Internal server error |