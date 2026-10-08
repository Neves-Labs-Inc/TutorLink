"""A WhatsApp block belongs to one Guardian on one phone number (#119).

WhatsApp's `system` opt-out (63050/63033 on a Booking reminder) blocks the Guardian while they
hold the number the reminder went to. Only that Guardian's own START, button tap or Intake yes
from that number lifts it. A START from another number neither lifts it nor counts toward it,
a Guardian moved to a new number is not blocked there, and a number given to another Guardian
does not carry the block to them.

Seams: the client PATCH and reminders routes, the signed inbound and status webhooks with
`fake_twilio`, and `reminder_service.due_guardians` / `run_week`. **No test here calls
Anthropic**: a START needs no parse, and the parser raises if reached, except in the Intake
yes case, which scripts its one parse.

Every write in a test shares one transaction, so `now()` ties them; `_time_passes` moves the
consent rows written so far an hour back, the way real time would separate the steps.
"""

import datetime
import random
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.booking_reminder import BookingReminder
from app.models.child import Child
from app.models.conversation import Conversation
from app.models.enums import (
    ConsentAction,
    ConsentSource,
    ConversationStatus,
    Language,
    ReminderSkipReason,
    ReminderStatus,
    UserRole,
)
from app.models.guardian import ChildGuardian, Guardian
from app.models.reminder_consent import ReminderConsent
from app.models.system_setting import SystemSetting
from app.models.user import User
from app.schemas.bot import BotIntent, ParsedIntent, ReminderButton
from app.security import create_access_token
from app.services import bot_service, parser_service
from app.services.bot_state import FlowState, save_state
from app.services.reminder_service import ReminderCandidate, due_guardians, run_week
from tests.fake_twilio import FakeTwilio

# Sunday 2026-10-11, 6 PM, and the Sunday after: two weekly runs.
NOW = datetime.datetime(2026, 10, 11, 18, 0)
NEXT_WEEK = NOW + datetime.timedelta(days=7)
EN_SID = "HXenglish000000000000000000000000"
OPT_OUT_CODES = ("63050", "63033")
# Written out rather than imported, so a reworded message is a deliberate test change.
BLOCKED_ERROR = (
    "WhatsApp reported this Guardian blocked our number; only the Guardian can turn reminders "
    "back on by messaging START from this number."
)
# Valid US numbers, unlike a random `+1` string, so the PATCH route's normaliser accepts them.
AREA_CODES = ("202", "212", "312", "415", "617")
SUBSCRIBER_NUMBERS = 10_000


@pytest.fixture(autouse=True)
def no_parser(monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(**kwargs: object) -> object:
        raise AssertionError("a test here reached the parser")

    monkeypatch.setattr(parser_service, "parse_intent", refuse)


@dataclass
class World:
    """Guardians, the Staff member editing them, and the routes they are driven through."""

    db: Session
    api: TestClient
    fake: FakeTwilio
    guardians: list[Guardian] = field(default_factory=list)
    _staff: User | None = None
    _inbound: int = 0

    def guardian(self) -> Guardian:
        """An opted-in (by Staff) Guardian of one Evaluated Child, on a number of their own."""
        guardian = Guardian(name="Guardian", phone_number=self.fresh_number())
        self.db.add(guardian)
        self.db.flush()
        child = Child(
            name="Ana",
            grade_level=5,
            school_name="Test School",
            evaluated_at=datetime.datetime(2026, 9, 1, tzinfo=datetime.UTC),
            evaluated_by_user_id=self.staff().id,
        )
        self.db.add(child)
        self.db.flush()
        self.db.add(ChildGuardian(child_id=child.id, guardian_id=guardian.id))
        self.db.flush()
        self.guardians.append(guardian)
        assert self.opt_in(guardian).status_code == 201
        self.time_passes()

        return guardian

    def fresh_number(self) -> str:
        taken = set(self.db.scalars(select(Guardian.phone_number)).all()) | set(
            self.db.scalars(select(Conversation.phone_number)).all()
        )
        number = None
        while number is None or number in taken:
            area = random.choice(AREA_CODES)
            number = f"+1{area}555{random.randrange(SUBSCRIBER_NUMBERS):04d}"

        return number

    def staff(self) -> User:
        if self._staff is None:
            self._staff = User(
                email=f"staff-{uuid.uuid4().hex[:12]}@example.com",
                display_name="Test Staff",
                hashed_password="not-a-hash",
                role=UserRole.ADMIN,
            )
            self.db.add(self._staff)
            self.db.flush()

        return self._staff

    def auth(self) -> dict[str, str]:
        staff = self.staff()
        token = create_access_token(user_id=staff.id, role=staff.role, tutor_id=None)

        return {"Authorization": f"Bearer {token}"}

    def block(
        self,
        guardian: Guardian,
        *,
        code: str = "63050",
        now: datetime.datetime = NOW,
        callback_to: str | None = None,
    ) -> None:
        """Remind the Guardian, and have WhatsApp report the number blocked us. `callback_to`
        is the callback's `To` (after `whatsapp:`), the Guardian's number when not given."""
        run_week(self.db, now=now)
        [sent] = [s for s in self.fake.sent if s.to == guardian.phone_number]
        response = self.fake.post_status(
            self.api,
            sid=sent.sid,
            status="undelivered",
            error_code=code,
            to=callback_to or guardian.phone_number,
        )
        assert response.status_code == 204
        self.time_passes()

    def move(self, guardian: Guardian, phone_number: str) -> None:
        response = self.api.patch(
            f"/api/clients/{guardian.id}",
            json={"phone_number": phone_number},
            headers=self.auth(),
        )
        assert response.status_code == 200
        self.db.refresh(guardian)
        self.time_passes()

    def say(self, body: str, *, from_number: str, button: ReminderButton | None = None) -> None:
        self._inbound += 1
        response = self.fake.post_inbound(
            self.api,
            from_number=from_number,
            body=body,
            sid=f"SMin{self._inbound:030d}",
            button_payload=None if button is None else button.value,
        )
        assert response.status_code == 200
        self.time_passes()

    def status(self, guardian: Guardian) -> dict[str, object]:
        response = self.api.get(f"/api/clients/{guardian.id}/reminders", headers=self.auth())
        assert response.status_code == 200
        consent: dict[str, object] = response.json()["consent"]

        return consent

    def opt_in(self, guardian: Guardian) -> Response:
        return self.api.post(
            f"/api/clients/{guardian.id}/reminders/consent",
            json={"action": "opt_in"},
            headers=self.auth(),
        )

    def candidate(
        self, guardian: Guardian, *, now: datetime.datetime = NEXT_WEEK
    ) -> ReminderCandidate | None:
        found = [c for c in due_guardians(self.db, now=now) if c.guardian_id == guardian.id]

        return found[0] if found else None

    def consents(self, guardian: Guardian) -> list[ReminderConsent]:
        return list(
            self.db.scalars(
                select(ReminderConsent)
                .where(ReminderConsent.guardian_id == guardian.id)
                .order_by(ReminderConsent.created_at, ReminderConsent.id)
            ).all()
        )

    def time_passes(self) -> None:
        self.db.execute(
            update(ReminderConsent)
            .where(ReminderConsent.guardian_id.in_([g.id for g in self.guardians]))
            .values(created_at=ReminderConsent.created_at - datetime.timedelta(hours=1))
        )
        self.db.flush()
        self.db.expire_all()


@pytest.fixture
def world(db: Session, api: TestClient, fake_twilio: FakeTwilio) -> World:
    db.execute(
        update(SystemSetting)
        .where(SystemSetting.key == f"reminder_template_sid_{Language.EN.value}")
        .values(value=EN_SID)
    )
    db.flush()

    return World(db=db, api=api, fake=fake_twilio)


def _assert_blocked(world: World, guardian: Guardian) -> None:
    assert world.status(guardian)["blocked_by_whatsapp"] is True
    refused = world.opt_in(guardian)
    assert (refused.status_code, refused.json()) == (409, {"detail": BLOCKED_ERROR})
    candidate = world.candidate(guardian)
    assert candidate is not None
    assert candidate.skip_reason is ReminderSkipReason.BLOCKED_BY_WHATSAPP


def _assert_free(world: World, guardian: Guardian) -> None:
    """Not blocked, opted in, and due with nothing to skip."""
    assert world.status(guardian)["blocked_by_whatsapp"] is False
    candidate = world.candidate(guardian)
    assert candidate is not None
    assert candidate.skip_reason is None


# --- the bypass ------------------------------------------------------------------------------


@pytest.mark.parametrize("code", OPT_OUT_CODES)
def test_a_start_from_a_number_staff_swapped_in_does_not_lift_the_block(
    world: World, code: str
) -> None:
    guardian = world.guardian()
    blocked_number = guardian.phone_number
    world.block(guardian, code=code)
    staff_number = world.fresh_number()

    world.move(guardian, staff_number)
    world.say("START", from_number=staff_number)
    world.move(guardian, blocked_number)

    _assert_blocked(world, guardian)
    run_week(world.db, now=NEXT_WEEK)
    [reminder] = world.db.scalars(
        select(BookingReminder).where(
            BookingReminder.guardian_id == guardian.id,
            BookingReminder.week_start == datetime.date(2026, 10, 19),
        )
    ).all()
    assert (reminder.status, reminder.skip_reason) == (
        ReminderStatus.SKIPPED,
        ReminderSkipReason.BLOCKED_BY_WHATSAPP,
    )
    assert [s.to for s in world.fake.sent].count(blocked_number) == 1


@pytest.mark.parametrize("code", OPT_OUT_CODES)
def test_a_later_start_from_the_swapped_in_number_still_does_not_lift_the_block(
    world: World, code: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    guardian = world.guardian()
    blocked_number = guardian.phone_number
    world.block(guardian, code=code)
    staff_number = world.fresh_number()
    world.move(guardian, staff_number)
    world.say("START", from_number=staff_number)
    world.move(guardian, blocked_number)

    # A thread still linked to the Guardian at the swapped-in number, as one from before threads
    # followed their Guardian (#126) would be. Its START must not reach the Guardian at all: the
    # number is a stranger's now, so it is parsed as an Intake opener.
    world.db.add(
        Conversation(
            phone_number=staff_number,
            guardian_id=guardian.id,
            last_message_at=datetime.datetime.now(datetime.UTC),
        )
    )
    world.db.flush()
    consents_before = [row.id for row in world.consents(guardian)]

    def read_hello(**kwargs: object) -> ParsedIntent:
        return ParsedIntent(
            intent=BotIntent.UNKNOWN, answer=None, fields={}, confidence_is_low=False
        )

    monkeypatch.setattr(parser_service, "parse_intent", read_hello)
    world.say("START", from_number=staff_number)

    assert [row.id for row in world.consents(guardian)] == consents_before
    _assert_blocked(world, guardian)


# --- a genuine number change -----------------------------------------------------------------


def test_a_guardian_moved_to_a_new_number_is_not_blocked_there_and_staff_may_opt_them_in(
    world: World,
) -> None:
    guardian = world.guardian()
    world.block(guardian)

    world.move(guardian, world.fresh_number())

    assert world.status(guardian)["blocked_by_whatsapp"] is False
    assert world.opt_in(guardian).status_code == 201
    world.time_passes()
    _assert_free(world, guardian)


def test_a_start_from_the_guardians_new_number_turns_reminders_back_on(world: World) -> None:
    guardian = world.guardian()
    world.block(guardian)
    new_number = world.fresh_number()
    world.move(guardian, new_number)

    world.say("START", from_number=new_number)

    _assert_free(world, guardian)


# --- a number moved to another Guardian ------------------------------------------------------


def test_a_number_given_to_another_guardian_does_not_carry_the_block_to_them(
    world: World,
) -> None:
    first = world.guardian()
    blocked_number = first.phone_number
    world.block(first)
    world.move(first, world.fresh_number())
    second = world.guardian()

    world.move(second, blocked_number)

    assert world.status(second)["blocked_by_whatsapp"] is False
    assert world.opt_in(second).status_code == 201
    world.time_passes()
    _assert_free(world, second)


# --- the Guardian's own START ----------------------------------------------------------------


def test_a_start_from_the_blocked_number_lifts_the_block(world: World) -> None:
    guardian = world.guardian()
    world.block(guardian)

    world.say("START", from_number=guardian.phone_number)

    _assert_free(world, guardian)


def test_a_start_from_the_blocked_number_written_another_way_lifts_the_block_and_records_it_normalised(
    world: World,
) -> None:
    guardian = world.guardian()
    world.block(guardian)

    world.say("START", from_number=guardian.phone_number.removeprefix("+"))

    _assert_free(world, guardian)
    message = world.consents(guardian)[-1]
    assert (message.source, message.phone_number) == (ConsentSource.MESSAGE, guardian.phone_number)


def test_a_stop_reminders_tap_from_the_blocked_number_lifts_the_block(world: World) -> None:
    guardian = world.guardian()
    world.block(guardian)

    world.say(
        "Stop reminders", from_number=guardian.phone_number, button=ReminderButton.STOP_REMINDERS
    )

    assert world.status(guardian)["blocked_by_whatsapp"] is False
    assert world.opt_in(guardian).status_code == 201


def test_an_intake_yes_from_the_blocked_number_lifts_the_block(
    world: World, monkeypatch: pytest.MonkeyPatch
) -> None:
    guardian = world.guardian()
    world.block(guardian)
    # The thread at the blocked number is waiting on the Intake's reminder question.
    save_state(
        world.db,
        phone_number=guardian.phone_number,
        state=FlowState(step=bot_service.STEP_REMINDERS_OPT_IN, prompt="Weekly reminders?"),
    )

    def read_yes(**kwargs: object) -> ParsedIntent:
        return ParsedIntent(
            intent=BotIntent.UNKNOWN, answer="yes", fields={}, confidence_is_low=False
        )

    monkeypatch.setattr(parser_service, "parse_intent", read_yes)

    world.say("yes", from_number=guardian.phone_number)

    intake = world.consents(guardian)[-1]
    assert (intake.source, intake.action, intake.phone_number) == (
        ConsentSource.INTAKE,
        ConsentAction.OPT_IN,
        guardian.phone_number,
    )
    _assert_free(world, guardian)


# --- precedence ------------------------------------------------------------------------------


def test_a_blocked_guardian_whose_chat_is_taken_over_is_skipped_as_blocked(
    world: World,
) -> None:
    guardian = world.guardian()
    blocked_number = guardian.phone_number
    world.block(guardian)
    staff_number = world.fresh_number()
    world.move(guardian, staff_number)
    world.say("START", from_number=staff_number)
    world.move(guardian, blocked_number)
    thread = world.db.scalars(
        select(Conversation).where(Conversation.phone_number == blocked_number)
    ).one()
    thread.status = ConversationStatus.HUMAN
    thread.taken_over_by_user_id = world.staff().id
    thread.taken_over_at = datetime.datetime.now(datetime.UTC)
    world.db.flush()

    candidate = world.candidate(guardian, now=NEXT_WEEK)

    assert candidate is not None
    assert candidate.skip_reason is ReminderSkipReason.BLOCKED_BY_WHATSAPP


# --- rows carry their number -----------------------------------------------------------------


def test_each_row_records_the_number_its_evidence_came_from(world: World) -> None:
    guardian = world.guardian()
    blocked_number = guardian.phone_number
    world.block(guardian)
    staff_number = world.fresh_number()
    world.move(guardian, staff_number)
    world.say("START", from_number=staff_number)

    assert [(row.source, row.phone_number) for row in world.consents(guardian)] == [
        (ConsentSource.STAFF, None),
        (ConsentSource.SYSTEM, blocked_number),
        (ConsentSource.MESSAGE, staff_number),
    ]


def test_a_system_row_without_a_callback_number_records_the_guardians_current_number(
    world: World,
) -> None:
    guardian = world.guardian()
    run_week(world.db, now=NOW)
    [sent] = [s for s in world.fake.sent if s.to == guardian.phone_number]

    response = world.fake.post_status(
        world.api, sid=sent.sid, status="undelivered", error_code="63050"
    )

    assert response.status_code == 204
    [system] = [row for row in world.consents(guardian) if row.source is ConsentSource.SYSTEM]
    assert system.phone_number == guardian.phone_number


@pytest.mark.parametrize(
    "spelled",
    [
        # `whatsapp:` is added by the fake: these are what follows it.
        lambda number: f"{number[1]} {number[2:5]} {number[5:8]} {number[8:]}",
        lambda number: f"({number[2:5]}) {number[5:8]}-{number[8:]}",
        lambda number: number.removeprefix("+"),
    ],
    ids=["spaces", "national", "no-plus"],
)
def test_a_callback_number_in_another_format_is_recorded_normalised_and_the_block_holds(
    world: World, spelled: Callable[[str], str]
) -> None:
    guardian = world.guardian()

    world.block(guardian, callback_to=spelled(guardian.phone_number))

    [system] = [row for row in world.consents(guardian) if row.source is ConsentSource.SYSTEM]
    assert system.phone_number == guardian.phone_number
    assert world.status(guardian)["blocked_by_whatsapp"] is True
    refused = world.opt_in(guardian)
    assert (refused.status_code, refused.json()) == (409, {"detail": BLOCKED_ERROR})


def test_a_reminder_refused_at_send_records_the_number_it_was_sent_to(world: World) -> None:
    guardian = world.guardian()
    world.fake.fail_next(code="63050")

    run_week(world.db, now=NOW)

    [system] = [row for row in world.consents(guardian) if row.source is ConsentSource.SYSTEM]
    assert system.phone_number == guardian.phone_number
    assert world.status(guardian)["blocked_by_whatsapp"] is True


@pytest.mark.parametrize(
    ("source", "phone_number"),
    [(ConsentSource.SYSTEM, None), (ConsentSource.STAFF, "+12025550123")],
)
def test_a_row_whose_number_does_not_match_its_source_is_rejected(
    db: Session, source: ConsentSource, phone_number: str | None
) -> None:
    guardian = Guardian(name="Guardian", phone_number="+13125550199")
    db.add(guardian)
    db.flush()

    with pytest.raises(IntegrityError), db.begin_nested():
        db.add(
            ReminderConsent(
                guardian_id=guardian.id,
                action=ConsentAction.OPT_OUT,
                source=source,
                phone_number=phone_number,
            )
        )
        db.flush()
