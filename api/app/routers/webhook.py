"""Twilio's inbound WhatsApp webhook: `POST /webhook/whatsapp` and its status callback.

`/webhook/*` is **not** under `/api/*` and therefore carries **no** auth dependency from
`app/dependencies.py` — CONSTITUTION.md §13 does not reach it; Twilio's own request signature
is the only thing in front of it (`docs/api-design.md:446-450`, epic #9's Traps). This module
must not take `TutorScope` either (§15) — there is no tutor-owned table in its path.

**The consequence of that second fact, stated so nobody adds an assertion to compensate
(decision P7-T).** With no scope dependency the `do_orm_execute` guard is never armed on this
`Session` (`dependencies.py:237-255`), so a wrong `tutor_id` here would fail silent-200 rather
than loud-500. That is accepted: this router resolves no `tutor_id` of its own and must not
start — it applies a `BotTurn` and commits — and every booking write the bot makes goes through
`booking_write_service`, whose `_resolve` refuses a retired tutor with a 400 and whose rule 1
validates the booking against the `tutor_availability` row named by `availability_id`.

**The broadcast runs after the commit.** `broadcast_service.publish` fails open and logs rather
than raising, which is only safe because the write it announces is already durable: raising
would turn a database error on the notify into a 500 that Twilio retries for hours while the
parent waits on a reply this API is refusing to return.
"""

from collections.abc import Mapping
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.message import Message
from app.schemas.message import MessageRead
from app.services import webhook_service
from app.services.broadcast_service import MessageCreated, MessageUpdated, publish

INVALID_SIGNATURE_ERROR = "Invalid Twilio signature"
MISSING_FIELD_ERROR = "{field} is required"

TWIML_MEDIA_TYPE = "application/xml"
SIGNATURE_HEADER = "X-Twilio-Signature"


async def get_twilio_form(request: Request) -> dict[str, str]:
    """Twilio's whole form body, which is what the signature is computed over.

    Async while both routes below are sync, which FastAPI resolves independently and this
    endpoint needs in both directions. `Request.form()` has no synchronous form, and an
    `async def` route would run the bot's database work — and its LLM call — on the event loop.
    Declaring `From`/`Body`/`MessageSid` as `Form(...)` parameters instead would hand the
    signature check a *subset* of the parameters Twilio signed over, and every signature on the
    endpoint would fail.
    """
    form = await request.form()

    return {key: str(value) for key, value in form.items()}


DbSession = Annotated[Session, Depends(get_db)]
TwilioForm = Annotated[dict[str, str], Depends(get_twilio_form)]

router = APIRouter(prefix="/webhook", tags=["webhook"])


@router.post("/whatsapp")
def receive_whatsapp(request: Request, form: TwilioForm, db: DbSession) -> Response:
    # REQ-071 is an ordering property, not a validation property: the signature check precedes
    # **every** side effect on this path — state reads, database writes and the outbound reply.
    # Nothing below may be hoisted above this line; a refactor that did would be a security
    # regression no functional test catches.
    _require_twilio_signature(request, form)

    turn = webhook_service.handle_inbound(
        db,
        twilio_from=_required(form, "From"),
        body=form.get("Body", ""),
        twilio_sid=_required(form, "MessageSid"),
    )

    db.commit()

    # Record, commit, send, attach: the notice is a line in the thread before it is sent.
    notice = None
    if turn.notice is not None:
        notice = webhook_service.send_notice(db, notice=turn.notice)
        db.commit()

    for message in (*turn.recorded, notice):
        if message is not None:
            publish(_message_created(message))

    return Response(content=turn.twiml, media_type=TWIML_MEDIA_TYPE)


@router.post("/whatsapp/status", status_code=status.HTTP_204_NO_CONTENT)
def receive_status(request: Request, form: TwilioForm, db: DbSession) -> Response:
    _require_twilio_signature(request, form)

    advanced = webhook_service.handle_status(
        db,
        twilio_sid=_required(form, "MessageSid"),
        twilio_status=form.get("MessageStatus", ""),
        error_code=form.get("ErrorCode") or None,
        twilio_to=form.get("To") or None,
    )

    db.commit()

    if advanced is not None:
        publish(_message_updated(advanced))

    return Response(status_code=status.HTTP_204_NO_CONTENT)


def signed_request_url(request: Request) -> str:
    """The absolute URL Twilio signed, rebuilt from the ASGI scope and from nowhere else.

    Twilio computes its signature over the **full request URL, scheme included**, so a URL that
    says `http://` where Twilio said `https://` fails every signature on this endpoint. Behind
    a TLS terminator that is the default outcome rather than an edge case: the terminator
    speaks HTTPS to Twilio and plain HTTP to this process. It bites in local ngrok development
    first, which is the early warning.

    `request.url` reads `scope["scheme"]`, and `scope["scheme"]` is what `ProxyHeadersMiddleware`
    rewrites from `X-Forwarded-Proto` when — and only when — the peer is named in
    `TRUSTED_PROXIES` (`main.create_app`). Reading it from there is what makes this endpoint
    correct behind Caddy with no code change (REQ-083, decision P8-F). Building the URL from
    `request.headers["host"]` plus a literal scheme, or reading `X-Forwarded-Proto` here
    directly, would move the trust decision out of the one place that owns it and re-arm
    exactly what `--no-proxy-headers` in `docker/api.Dockerfile` exists to prevent.

    This is the only place in the codebase that reconstructs the request URL, which is what
    makes that claim auditable and what bounds a change of TLS terminator to one function.
    """
    return str(request.url)


def _require_twilio_signature(request: Request, form: Mapping[str, str]) -> None:
    if not webhook_service.signature_is_valid(
        url=signed_request_url(request),
        params=form,
        signature=request.headers.get(SIGNATURE_HEADER),
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, INVALID_SIGNATURE_ERROR)


def _required(form: Mapping[str, str], field: str) -> str:
    value = form.get(field)

    if not value:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, MISSING_FIELD_ERROR.format(field=field))

    return value


def _message_created(message: Message) -> MessageCreated:
    return MessageCreated(conversation_id=message.conversation_id, message=_serialised(message))


def _message_updated(message: Message) -> MessageUpdated:
    return MessageUpdated(conversation_id=message.conversation_id, message=_serialised(message))


def _serialised(message: Message) -> dict[str, object]:
    # `author` stays empty: only the id crosses the channel, and the pump reads the author back.
    return MessageRead(
        id=message.id,
        author_kind=message.author_kind,
        author=None,
        body=message.body,
        status=message.status,
        created_at=message.created_at,
        system_kind=message.system_kind,
        error_code=message.error_code,
        reminder_child_names=None,
    ).model_dump(mode="json")
