"""`app.db`'s engine: a database error never carries the statement's parameters into its text.

Error text ends up in logs (`logger.exception` on a failed tick, uvicorn's unhandled-exception
log), and the parameters are phone numbers, Children's names and message bodies.
"""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.db import engine

SECRET_VALUE = "+15550001234 Ana"


def test_a_database_error_does_not_quote_the_statement_parameters() -> None:
    with engine.connect() as connection:
        with pytest.raises(DBAPIError) as raised:
            # Division by zero: PostgreSQL's own message does not echo the value, so any copy of
            # it in the error text came from SQLAlchemy's parameter dump.
            connection.execute(text("SELECT CAST(:value AS text), 1 / 0"), {"value": SECRET_VALUE})

    assert SECRET_VALUE not in str(raised.value)
