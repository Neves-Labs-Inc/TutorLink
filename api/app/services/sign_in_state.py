"""Where a user stands on signing in: computed from the password and the Invites ever sent,
never stored.

`active`: has a password (a pending reset leaves them so). `invited`: no password, and at
least one Invite link in any state, since an expired or revoked Invite does not undo having
been invited. `not_invited`: otherwise.

`sign_in_state_expression` is the one definition: the list filters with it and reads select
it, so the filter and the value shown cannot disagree.
"""

import enum
import uuid
from collections.abc import Iterable

from sqlalchemy import ColumnElement, case, exists, select
from sqlalchemy.orm import Session

from app.models.password_link import PasswordLink, PasswordLinkPurpose
from app.models.user import User


class SignInState(str, enum.Enum):
    NOT_INVITED = "not_invited"
    INVITED = "invited"
    ACTIVE = "active"


def sign_in_state_expression() -> ColumnElement[str]:
    has_invite = exists().where(
        PasswordLink.user_id == User.id, PasswordLink.purpose == PasswordLinkPurpose.INVITE
    )

    return case(
        (User.hashed_password.is_not(None), SignInState.ACTIVE.value),
        (has_invite, SignInState.INVITED.value),
        else_=SignInState.NOT_INVITED.value,
    )


def sign_in_states(db: Session, *, user_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, SignInState]:
    """The state of every user in `user_ids`, in one query."""
    ids = list(user_ids)

    if not ids:
        return {}

    rows = db.execute(select(User.id, sign_in_state_expression()).where(User.id.in_(ids))).all()

    return {user_id: SignInState(state) for user_id, state in rows}
