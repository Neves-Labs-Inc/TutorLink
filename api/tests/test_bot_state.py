"""`bot_state` — the 30-minute flow state, kept in `bot_flow_state` (REQ-072, REQ-076).

Against the rolled-back `db` fixture and a real PostgreSQL, rather than a double: the two
mechanisms this module leans on — the upsert's `ON CONFLICT` and the database clock's `now()` —
are exactly the things a fake session would have to reimplement to be worth trusting.

Two tests matter beyond their own assertion:

- `test_an_expired_row_reads_as_no_state_rather_than_raising` is REQ-076. Expiry mid-flow is the
  normal case, not an error case, and an unreaped row surfacing here would hand the parent's
  thirty-one-minutes-later message a stale flow instead of a fresh start.
- `test_loading_a_state_does_not_touch_the_row` backs the takeover rule at `erd.md:501-504`: a
  read has no business refreshing the expiry a write is the only thing meant to restart.
"""

import datetime

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models.bot_flow_state import BotFlowState
from app.services.bot_state import (
    FLOW_STATE_TTL_SECONDS,
    FlowState,
    clear_state,
    load_state,
    save_state,
)

PHONE_NUMBER = "+15555550123"


def _db_now(db: Session) -> datetime.datetime:
    """`now()`'s value for the fixture's transaction — fixed at its start and therefore stable
    across every statement in one test, which is what makes an exact expiry assertion possible."""
    return db.execute(select(func.now())).scalar_one()


def _expires_at(db: Session, *, phone_number: str) -> datetime.datetime:
    return db.execute(
        select(BotFlowState.expires_at).where(BotFlowState.phone_number == phone_number)
    ).scalar_one()


def _expire(db: Session, *, phone_number: str) -> None:
    """Push a row's `expires_at` into the past, against the same clock `load_state` reads —
    the database's, not Python's, which the fixture's transaction can be seconds behind."""
    db.execute(
        update(BotFlowState)
        .where(BotFlowState.phone_number == phone_number)
        .values(expires_at=func.now() - func.make_interval(0, 0, 0, 0, 1))
    )


def test_a_saved_state_round_trips_through_the_table(db: Session) -> None:
    save_state(
        db,
        phone_number=PHONE_NUMBER,
        state=FlowState(step="book_date", collected_data={"book_subject_id": "x"}, misses=1),
    )

    loaded = load_state(db, phone_number=PHONE_NUMBER)

    assert loaded == FlowState(
        step="book_date", collected_data={"book_subject_id": "x"}, misses=1, prompt=""
    )


def test_a_missing_row_reads_as_no_state_rather_than_raising(db: Session) -> None:
    assert load_state(db, phone_number=PHONE_NUMBER) is None


def test_an_expired_row_reads_as_no_state_rather_than_raising(db: Session) -> None:
    """REQ-076.1. A message arriving after the TTL starts the flow over, with no error."""
    save_state(db, phone_number=PHONE_NUMBER, state=FlowState(step="book_date"))
    _expire(db, phone_number=PHONE_NUMBER)

    assert load_state(db, phone_number=PHONE_NUMBER) is None


def test_every_write_sets_the_expiry_thirty_minutes_from_now(db: Session) -> None:
    save_state(db, phone_number=PHONE_NUMBER, state=FlowState(step="menu"))

    expires_at = _expires_at(db, phone_number=PHONE_NUMBER)

    assert FLOW_STATE_TTL_SECONDS == 30 * 60
    assert expires_at == _db_now(db) + datetime.timedelta(seconds=FLOW_STATE_TTL_SECONDS)


def test_a_second_write_restarts_the_expiry_rather_than_leaving_the_first_one_running(
    db: Session,
) -> None:
    """The window is thirty minutes of silence, which is what makes a long intake possible."""
    save_state(db, phone_number=PHONE_NUMBER, state=FlowState(step="intake_name"))
    _expire(db, phone_number=PHONE_NUMBER)

    save_state(db, phone_number=PHONE_NUMBER, state=FlowState(step="intake_address"))

    expires_at = _expires_at(db, phone_number=PHONE_NUMBER)

    assert expires_at == _db_now(db) + datetime.timedelta(seconds=FLOW_STATE_TTL_SECONDS)


def test_loading_a_state_does_not_touch_the_row(db: Session) -> None:
    save_state(db, phone_number=PHONE_NUMBER, state=FlowState(step="menu"))
    expires_at = _expires_at(db, phone_number=PHONE_NUMBER)

    load_state(db, phone_number=PHONE_NUMBER)

    assert _expires_at(db, phone_number=PHONE_NUMBER) == expires_at


def test_clearing_removes_the_row_so_the_next_message_opens_a_new_flow(db: Session) -> None:
    save_state(db, phone_number=PHONE_NUMBER, state=FlowState(step="menu"))

    clear_state(db, phone_number=PHONE_NUMBER)

    assert load_state(db, phone_number=PHONE_NUMBER) is None


def test_loading_after_a_save_does_not_return_a_stale_held_instance(db: Session) -> None:
    """A `BotFlowState` fetched through the identity map before the save must not leak its
    now-stale attributes, or its `collected_data` dict, into what `load_state` returns."""
    save_state(db, phone_number=PHONE_NUMBER, state=FlowState(step="menu"))
    held = db.get(BotFlowState, PHONE_NUMBER)

    save_state(
        db,
        phone_number=PHONE_NUMBER,
        state=FlowState(step="book_date", collected_data={"book_subject_id": "x"}),
    )

    loaded = load_state(db, phone_number=PHONE_NUMBER)

    assert loaded.step == "book_date"
    assert loaded.collected_data == {"book_subject_id": "x"}
    assert loaded.collected_data is not held.collected_data


def test_two_phone_numbers_hold_two_independent_flows(db: Session) -> None:
    save_state(db, phone_number=PHONE_NUMBER, state=FlowState(step="menu"))
    save_state(db, phone_number="+15555550999", state=FlowState(step="book_date"))

    clear_state(db, phone_number=PHONE_NUMBER)

    assert load_state(db, phone_number=PHONE_NUMBER) is None
    assert load_state(db, phone_number="+15555550999").step == "book_date"


def test_the_stored_row_holds_step_and_collected_data(db: Session) -> None:
    """REQ-072.1's payload, plus the machine's own counters — and nothing from anywhere else."""
    save_state(
        db,
        phone_number=PHONE_NUMBER,
        state=FlowState(step="menu", collected_data={"guardian_name": "Ada"}),
    )

    row = db.get(BotFlowState, PHONE_NUMBER)

    assert row.step == "menu"
    assert row.collected_data == {"guardian_name": "Ada"}


def test_a_re_prompt_leaves_step_and_collected_data_untouched(db: Session) -> None:
    """REQ-078.2's bail-out is `bot_service`'s to drive, but the guarantee it rests on is that
    a save carrying the same `step` and `collected_data` leaves both exactly as they were."""
    collected = {"book_subject_id": "x"}
    save_state(
        db, phone_number=PHONE_NUMBER, state=FlowState(step="book_date", collected_data=collected)
    )

    save_state(
        db,
        phone_number=PHONE_NUMBER,
        state=FlowState(step="book_date", collected_data=collected, misses=1),
    )

    reloaded = load_state(db, phone_number=PHONE_NUMBER)

    assert reloaded.step == "book_date"
    assert reloaded.collected_data == collected
    assert reloaded.misses == 1
