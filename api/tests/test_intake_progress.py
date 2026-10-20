"""Intake progress: whether a chat still has a Guardian, a Home and a Child to collect.

Run against a live PostgreSQL through the `db` fixture. Each Guardian here holds the number
their thread is keyed on, because `owner_id` treats a Guardian who does not hold it as no one.
"""

import uuid

import pytest
from sqlalchemy.orm import Session

from app.models.child import Child
from app.models.conversation import Conversation
from app.models.guardian import ChildGuardian, Guardian
from app.models.home import GuardianHome, Home
from app.services import conversation_service, intake_progress as intake_module
from app.services.intake_progress import intake_in_progress_for, intake_progress


def test_a_thread_with_no_guardian_is_missing_everything(db: Session) -> None:
    conversation = _make_conversation(db)

    progress = intake_progress(db, conversation=conversation)

    assert progress.in_progress is True
    assert progress.missing == ("guardian_name", "home", "child")


def test_a_guardian_with_a_home_but_no_child_is_missing_the_child(db: Session) -> None:
    conversation = _make_conversation(db, with_guardian=True)
    _add_home(db, conversation)

    progress = intake_progress(db, conversation=conversation)

    assert progress.in_progress is True
    assert progress.missing == ("child",)


def test_a_guardian_with_a_child_but_no_home_is_missing_the_home(db: Session) -> None:
    conversation = _make_conversation(db, with_guardian=True)
    _add_child(db, conversation)

    progress = intake_progress(db, conversation=conversation)

    assert progress.in_progress is True
    assert progress.missing == ("home",)


def test_a_guardian_with_a_home_and_a_child_is_done(db: Session) -> None:
    conversation = _make_conversation(db, with_guardian=True)
    _add_home(db, conversation)
    _add_child(db, conversation)

    progress = intake_progress(db, conversation=conversation)

    assert progress.in_progress is False
    assert progress.missing == ()


def test_an_archived_child_still_counts_as_a_child(db: Session) -> None:
    conversation = _make_conversation(db, with_guardian=True)
    _add_home(db, conversation)
    _add_child(db, conversation, is_archived=True)

    assert intake_progress(db, conversation=conversation).in_progress is False


def test_a_guardian_who_left_the_number_counts_as_no_guardian(db: Session) -> None:
    conversation = _make_conversation(db, with_guardian=True)
    _add_home(db, conversation)
    _add_child(db, conversation)
    conversation.phone_number = f"+1{uuid.uuid4().int % 10**10:010d}"
    db.flush()

    assert intake_progress(db, conversation=conversation).in_progress is True


def test_the_batched_read_agrees_with_the_single_read_for_every_thread(db: Session) -> None:
    anonymous = _make_conversation(db)
    homeless = _make_conversation(db, with_guardian=True)
    _add_child(db, homeless)
    childless = _make_conversation(db, with_guardian=True)
    _add_home(db, childless)
    done = _make_conversation(db, with_guardian=True)
    _add_home(db, done)
    _add_child(db, done)
    threads = [anonymous, homeless, childless, done]

    batched = intake_in_progress_for(db, [thread.id for thread in threads])

    assert batched == {
        anonymous.id: True,
        homeless.id: True,
        childless.id: True,
        done.id: False,
    }


def test_the_batched_read_of_no_threads_is_empty(db: Session) -> None:
    assert intake_in_progress_for(db, []) == {}


def _make_conversation(db: Session, *, with_guardian: bool = False) -> Conversation:
    phone_number = f"+1{uuid.uuid4().int % 10**10:010d}"
    guardian = None
    if with_guardian:
        guardian = Guardian(name="Maria Lopez", phone_number=phone_number, is_archived=False)
        db.add(guardian)
        db.flush()
    conversation = Conversation(
        phone_number=phone_number, guardian_id=None if guardian is None else guardian.id
    )
    db.add(conversation)
    db.flush()

    return conversation


def _add_home(db: Session, conversation: Conversation) -> None:
    home = Home(address="1 Elm St", is_archived=False)
    db.add(home)
    db.flush()
    db.add(GuardianHome(guardian_id=conversation.guardian_id, home_id=home.id))
    db.flush()


def _add_child(db: Session, conversation: Conversation, *, is_archived: bool = False) -> None:
    child = Child(name="Tommy", school_name="Test School", is_archived=is_archived)
    db.add(child)
    db.flush()
    db.add(ChildGuardian(child_id=child.id, guardian_id=conversation.guardian_id))
    db.flush()


def test_a_listed_thread_missing_from_the_batch_defaults_to_in_progress(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Reproduces a number-change merge deleting a thread between the page query and the batch.
    conversation = _make_conversation(db)
    monkeypatch.setattr(intake_module, "intake_in_progress_for", lambda db, ids: {})

    items, _ = conversation_service.list_conversations(
        db, status=None, unread=None, flagged=None, q=conversation.phone_number, limit=5, offset=0
    )

    assert [item.intake_in_progress for item in items] == [True]
