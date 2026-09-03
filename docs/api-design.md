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

**The four collection endpoints this governs, named:** `GET /api/users`, `GET /api/tutors`, `GET /api/subjects`, `GET /api/clients` — every collection whose resource carries an `is_active` column. It is stated once here rather than on each because a rule written four times reads four different ways, and a dashboard table cannot explain to a user why one screen hides deactivated rows and another does not.

**Fetching one row by id ignores the flag.** `GET /api/{resource}/{id}` takes no `?is_active` and returns the row whatever its flag, and where the response carries `is_active` it reports the real state (not every by-id response documents the field today, so a caller that must distinguish a deactivated row needs it added to that endpoint's schema first). Three reasons: an id is an address and not a query, so there is no set to filter; the admin surface that deactivated a row is the surface that must be able to open it again in order to reactivate it; and a 404 for a deactivated row would make a soft delete indistinguishable from a hard one, which is the entire distinction the flag exists to draw. This is not the 403-not-404 rule from [Role-Based Access Control](#role-based-access-control-rbac) wearing a different hat — that rule is about *denial*, and a deactivated row is a state the response reports rather than something withheld.

**Two resources carry `is_active` and are deliberately outside this rule:**

- `tutor_availability` — `GET /api/tutors/{id}/availability` returns the tutor's full weekly schedule, inactive slots included, because this endpoint's purpose is to feed an availability editor, and an editor that hid disabled slots by default would leave them unreachable for re-enabling. Unlike the four collection endpoints above, this one deliberately does not filter. `PATCH /api/availability/{id}` toggles the flag.
- `homes` — homes are returned nested inside `GET /api/clients/{id}` and have no collection endpoint of their own. A nested list inside a single-resource response is not a list endpoint and this rule does not reach it.

**Some resources carry no flag at all, and that is also deliberate: junctions, plus these entities.** Junction tables are hard deleted and carry no `is_active`: `child_guardians`, `child_homes`, `guardian_homes`, `tutor_subjects`. A junction is a link rather than an entity, so unlinking a guardian after a custody change is a `DELETE` that takes effect immediately. `children` carries no flag either. Neither does `tutor_availability_exceptions`: `DELETE /api/exceptions/{id}` really erases the row, because a time-off request that was withdrawn or refused has no state worth keeping. Do not add one to any of them to make the rule look uniform — the rule is about entities an admin retires, and a link that still exists is a claim that is still true.

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
against a live Redis, thirty-two simultaneous attempts at a limit of five were all admitted
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

Counting is backed by Redis, and **an unreachable Redis fails open** — the request is allowed
through unthrottled rather than refused. Making Redis a hard dependency of login would turn a
Redis blip into a total authentication outage, which is worse and far likelier than the
unthrottled state that preceded the limiter. Setting either `max_attempts` to `0` disables that
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
> resolves a name, so `TRUSTED_PROXIES=caddy` would trust nothing while looking configured — the
> setting refuses that too. The value must be an IP address or a CIDR block.
>
> uvicorn's own proxy-header handling stays off (`--no-proxy-headers` in
> `docker/api.Dockerfile`), so that exactly one place decides trust. Caddy from #2 proxies to
> `api:8000` by Docker service name, so it is a container on the compose network and the peer is
> a container address — not loopback, and not the same host. `X-Forwarded-Proto` is honored on
> the same terms; it has no consumer today, since the refresh cookie keys off `COOKIE_SECURE`
> rather than the scheme, but the Phase 7 Twilio webhook will validate signatures over the full
> request URL, scheme included, and will be its first reader.
>
> `TRUSTED_PROXIES` ships unset. This repository contains no Caddy service and no fixed network,
> so the value cannot be chosen here. Whoever stands Caddy up sets it to Caddy's address on the
> network the two containers share, and confirms Caddy is setting both headers.

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
| `GET /api/conversations` | ✓ | ✓ | ✗ |
| `GET /api/conversations/{id}` | ✓ | ✓ | ✗ |
| `GET /api/conversations/{id}/messages` | ✓ | ✓ | ✗ |
| `POST/DELETE /api/conversations/{id}/takeover` | ✓ | ✓ | ✗ |
| `POST /api/conversations/{id}/read` | ✓ | ✓ | ✗ |
| `WS /api/conversations/stream` | ✓ | ✓ | ✗ |
| `GET /api/subjects` | ✓ | ✓ | ✓ |
| `POST/PATCH/DELETE /api/subjects` | ✓ | ✓ | ✗ |
| `GET /api/users` | ✓ | ✓ | ✗ |
| `POST/PATCH/DELETE /api/users` | ✓ | ✓ (not `developer`) | ✗ |
| `GET /api/settings` | All fields | Admin-visible fields only | ✗ |
| `PATCH /api/settings` | All fields | Admin-visible fields only | ✗ |
| `GET /api/stats/overview` | ✓ | ✓ | ✗ |

> A `pending` exception is visible to both the tutor and admins but does not block bookings — only an `approved` one subtracts from availability. See [Availability](#availability) and `docs/erd.md`.

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

Redis is untouched by a takeover. Live bot flow state keeps its 30-minute TTL and will usually
expire during a handoff of any length, so when the bot is released the client resumes from a fresh
state — the same behaviour as any other client who went quiet for half an hour. Freezing the TTL for
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
when the status is `failed`. An outbound message is written `queued` when it is sent and reaches
`sent`, `delivered` or `failed` only through this callback; an inbound message is written `received`
and never moves.

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

**The two counts apply different predicates, and that is deliberate.** `home_count` counts only homes with `is_active = true`; `child_count` counts every linked child, because `children` carries no `is_active` column at all and [must not be given one](#soft-deletes-and-the-is_active-filter). Making the two "consistent" is not possible in one direction and not correct in the other.

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
      "age": 12,
      "grade_level": 7,
      "school_name": "Lincoln Middle School"
    }
  ]
}
```

The nested `homes` list carries `is_active` and returns **every** linked home, deactivated ones included — a nested list inside a single-resource response is not a list endpoint and the collection filter does not reach it, as [Soft deletes and the `is_active` filter](#soft-deletes-and-the-is_active-filter) states. The field is what lets a caller tell which of these homes `home_count` on [`GET /api/clients`](#get-apiclients) left out, since that count excludes the inactive ones. `homes` is an entity table with its own identity and is not a junction: `child_homes` and `guardian_homes` are the junctions, and they correctly carry no flag.

`homes` and `children` are two flat, uncorrelated lists: this response does not say which home a given child is tutored at. That is a known limitation of the shape rather than an omission from it — a caller choosing a home for a booking must let `POST /api/bookings` rule 6 adjudicate, which refuses a home the child does not live at with **422**.

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

Update client info (name, active status, phone number). Address and access code belong to a home and are edited through the home, not here.

`phone_number` may be updated — a guardian changes handset, or the number was mistyped at intake. The edit moves `guardians.phone_number` only. It does **not** move the client's existing conversation thread, which stays on the number it was actually held with; the next inbound message from the new number opens a second thread carrying the same client. See [`conversations`](../docs/erd.md#conversations).

A `phone_number` that **another** client already holds — active or deactivated — is refused with **409** and the same `detail` string `A client with that phone number already exists` that `POST /api/clients` returns: the duplicate-phone case has two entry points and one rule, so it has one message. **"Another client" excludes this one** — a `PATCH` carrying the client's own current number is a no-op on that field and returns 200, never a conflict with itself, including a `PATCH` that changes only the name and echoes the existing number back.

### `GET /api/clients/{id}/bookings`

Returns all bookings for a client across all their children, in the standard page envelope. Supports filtering: `?status=confirmed&from=2026-08-01`. Every filter [`GET /api/bookings`](#get-apibookings) defines — `?status=` including its repeated form, `?tutor_id=`, and `?from=`/`?to=` including the empty page for an inverted range — carries the same meaning here, applied within this client's bookings.

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

Remove a recurring slot. **This is a soft delete**: the row is kept with `is_active = false` and returned with **200**, not a 204. It cannot be anything else — `bookings.availability_id` is `NOT NULL`, so erasing the row would either fail against its own foreign key or orphan booking history. The slot stops being offered by `GET /api/slots/available` immediately; bookings already made against it are unaffected and stay valid. `GET /api/tutors/{id}/availability` still returns the row so the editor can re-enable it.

### `GET /api/tutors/{id}/exceptions`

Returns all exceptions for a tutor, including still-`pending` requests. A `pending` row is shown to both
the tutor and admins but has no effect on availability until it is approved — see rule 2 in
[Availability Query Logic](../docs/erd.md).

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

Returns all bookings. Supports filtering: `?status=confirmed&tutor_id=uuid&from=2026-08-01&to=2026-08-31`

**`?status=` may be repeated**, and repeated values are ORed: `?status=pending&status=confirmed` returns every booking in either status. A single `?status=confirmed` is the one-element case and means what it has always meant, and omitting `status` still returns every status. Repetition rather than a comma-separated list, because every filter in this contract carries one value per key: a comma inside a value slot would need an escaping rule that then has to be documented for every parameter, and a repeated key needs none. This is the first multi-value parameter in this contract, and the form is chosen here rather than improvised later.

**`from` and `to` are inclusive bounds on `scheduled_date`** — the date the session happens, not the date the booking was created. `?from=2026-08-10&to=2026-08-10` is exactly the sessions scheduled on 10 August. Either bound may be given without the other. **An inverted range — `from` later than `to` — is not an error: it selects nothing, so the response is the ordinary page envelope with `items: []` and `total: 0`.** It is neither refused nor special-cased. A caller that computes its window arithmetically can hand over whatever that arithmetic produced, including a window that collapsed to nothing, and read the answer off `total`; a 400 here would move that check into every caller and make `total` unavailable for exactly the case where `0` is the right answer.

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
      "start_time": "09:00:00",
      "end_time": "10:00:00",
      "status": "confirmed",
      "notes": null
    }
  ],
  "total": 42,
  "page": 1,
  "page_size": 20
}
```

`start_time`/`end_time` render with seconds — `"09:00:00"`, not `"09:00"` — the same `HH:MM:SS` form the API's exception schema already serialises. One time format across the API beats a booking-shaped response that differs from an exception-shaped one by a trailing `:00`. A `POST`/`PATCH` body may still submit either form; this is a response-serialisation fact, not an input restriction.

### `GET /api/bookings/{id}`

Returns full detail for a single booking, including the address and access code of **the booking's home** — not the guardian's. Once a child has two homes those are different things, and resolving through the guardian returns the wrong house whenever a session is at the other one.

### `POST /api/bookings`

Create a confirmed booking. Called by the bot after the client selects a slot.

**Validation**

The requested range is accepted when it satisfies all of the following:

1. it sits entirely inside an active `tutor_availability` range for that tutor and day
2. it overlaps no existing booking for that tutor with `status IN (pending, confirmed)` — `new.start_time < booking.end_time AND new.end_time > booking.start_time`. This check exists to return a clean 409 with a useful message; the guarantee itself is held by the `excl_bookings_live_overlap` exclusion constraint (see `erd.md`), since a read-then-write check alone races under concurrent requests
3. it is at least `session_gap_minutes` clear of the nearest booking on either side — refused when `new.start_time < booking.end_time + session_gap_minutes AND new.end_time + session_gap_minutes > booking.start_time` holds for any booking counted by rule 2. That is rule 2's comparison with the booking widened by the gap on both sides, and it is the comparison step 3 of `GET /api/slots/available` subtracts by, so the offer surface and this check read the same rows the same way. The inequalities are strict, so clearance of exactly `session_gap_minutes` is accepted
4. it is not blocked by a `tutor_availability_exceptions` row with `status = 'approved'` covering
   `scheduled_date` — the whole day when `start_time`/`end_time` are NULL, or by time overlap when they
   are set. `pending` and `rejected` rows never block a booking.
5. the tutor's `max_grade_level` for the **booked subject** is at or above the booked child's
   `grade_level`. The ceiling is per subject, so this resolves the `(tutor_id, subject_id)` pair from
   `bookings.subject_id` — there is no tutor-wide grade to fall back on. A tutor qualified for the child's
   grade in one subject is still refused for a subject where their ceiling is lower. The boundary is
   inclusive: a ceiling equal to the child's grade is accepted.

   A **missing** `tutor_subjects` row for the booked subject is a refusal, not a pass. With no assignment
   there is no ceiling to compare against, and the tutor does not teach the subject at all. Written as a
   join that silently drops the row, the strongest possible violation would return success.

6. `home_id` is one of the booked child's homes — a `child_homes` row exists for
   `(child_id, home_id)`. Any other home is refused, including one belonging to a different family.

7. `booked_by_guardian_id`, when present, is one of the booked child's guardians — a `child_guardians`
   row exists for `(child_id, booked_by_guardian_id)`. NULL is always allowed and is the admin path.

Rule 1 failing is **400**. Rules 2, 3 and 4 failing are **409**, the conflict case the error table already
names. Rules 5, 6 and 7 failing are **422** — the request is well-formed and conflicts with nothing, it
just names a combination that is not permitted: a tutor not qualified to teach that child at that grade,
a home the child does not live at, or a guardian not linked to the child.

Rules 6 and 7 are deliberately independent of each other. The home is checked against the **child**, never
against the booking guardian, so a guardian booking a session at the child's *other* home — the co-parent's
house — is accepted; that case is the reason the two columns exist. A rule phrased as "the home must belong
to the booking guardian" would wrongly refuse it. Rule 7 is what keeps that openness safe: a stranger
booking for someone else's child is refused because they hold no `child_guardians` link, and that link is
the only thing separating the two requests. Two siblings sharing a home each pass rule 6 on their own
`child_homes` row.

This enumeration is the authority for what `POST /api/bookings` enforces, and it belongs in one place in
code — a single ordered rule set carrying these issue numbers as comments (rule 4 from #24, rule 5 from #36,
rules 6 and 7 from #38), not prose scattered across issues. The list has been amended three times in two
days; treat it as open and expect a fourth.

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
A start time earlier than `now + min_booking_lead_hours` returns **400**.

**Request**
```json
{
  "child_id": "uuid",
  "tutor_id": "uuid",
  "subject_id": "uuid",
  "availability_id": "uuid",
  "home_id": "uuid",
  "scheduled_date": "2026-08-10",
  "start_time": "09:00",
  "end_time": "10:00",
  "booked_by_guardian_id": null,
  "notes": null
}
```

`home_id` is **required** — `bookings.home_id` is `NOT NULL` and rule 6 validates it against the child's `child_homes` rows. It is not derivable once a child has two homes, which is the case the column exists for. `booked_by_guardian_id` is optional and `null` is the admin path; when present, rule 7 validates it against `child_guardians`.

**Which `is_active` this endpoint honours.** A `tutor_id`, `subject_id`, `home_id` or `booked_by_guardian_id` naming a **deactivated** row is refused with **400**, exactly as a missing one is: a soft delete keeps the row and all its dependents, so an existence check alone would let this endpoint confirm a session against a tutor `GET /api/slots/available` has already stopped offering. That 400 is deliberately not one of the 422s below — 422 refuses a *combination* of two individually valid rows, while a retired reference is a property of one row, which is what rule 1 already answers with 400. `children` is absent from this list because it carries no `is_active` at all, and `tutor_availability.is_active` is rule 1's business rather than a reference failure: a withdrawn range names the wrong times, not the wrong row.

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

That distinction matters because TutorLink configures no business timezone anywhere — not in code, not in config, not in `system_settings` — so those `now` comparisons resolve against whatever zone the API container happens to run in. **That gap is real and this section does not close it.** This endpoint sidesteps the question rather than answering it; the endpoints that must answer it still have to.

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
```

Every WhatsApp conversation the bot has ever had, readable by an admin, and steppable into. A
conversation is keyed on the phone number rather than on the guardian, because the bot is talking
before a guardian row exists — intake collects the name several messages in. A `guardian` of `null`
therefore means intake has not got that far, not that something went wrong, and those are the
conversations an admin most wants to read.

Admin or above on all six. A `tutor` token gets **403** on every one of them; chat is an admin
surface and there is no tutor-scoped view of it to fall back to.

### `GET /api/conversations`

Returns conversations in the standard page envelope, ordered by `last_message_at` descending so the
list reads as an inbox.

**Query Parameters**

| Param | Required | Description |
|---|---|---|
| status | No | `bot` or `human` — who is answering right now |
| unread | No | `true` restricts to conversations with messages newer than `last_read_at` |
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
      "unread": true
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
  "message_count": 412,
  "unread_count": 3,
  "created_at": "2026-06-02T09:14:00Z"
}
```

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