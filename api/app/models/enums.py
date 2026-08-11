"""Native PostgreSQL enum types used across the schema.

The `ENUM` instances below carry `create_type=False`: the types are created and dropped
explicitly by the Alembic migration, because a native PostgreSQL enum survives `DROP TABLE`
and would otherwise be left behind by `alembic downgrade base`.

`postgresql.ENUM` is used rather than `sa.Enum` deliberately — `sa.Enum` accepts a
`create_type` keyword but silently discards it, and its dialect implementation still
reports `create_type=True`.
"""

import enum

from sqlalchemy.dialects import postgresql

USER_ROLE_ENUM_NAME = "user_role"
BOOKING_STATUS_ENUM_NAME = "booking_status"


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    TUTOR = "tutor"


class BookingStatus(str, enum.Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"
    COMPLETED = "completed"


def _values(enum_class: type[enum.Enum]) -> list[str]:
    return [member.value for member in enum_class]


user_role_enum = postgresql.ENUM(
    UserRole,
    name=USER_ROLE_ENUM_NAME,
    create_type=False,
    values_callable=_values,
)

booking_status_enum = postgresql.ENUM(
    BookingStatus,
    name=BOOKING_STATUS_ENUM_NAME,
    create_type=False,
    values_callable=_values,
)

USER_ROLE_VALUES = _values(UserRole)
BOOKING_STATUS_VALUES = _values(BookingStatus)
