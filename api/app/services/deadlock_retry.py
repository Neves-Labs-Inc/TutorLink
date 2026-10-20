"""One retry for a Staff write that PostgreSQL aborted as a deadlock.

A Staff write that creates a Guardian at a number can deadlock with a bot turn finishing
Intake at that number: the turn holds its new Guardian row and waits for the chat's row lock at
its end, while the Staff write holds the chat and waits on the turn's Guardian. PostgreSQL
aborts one of them. When it aborts the Staff write, running it once more from a clean
transaction usually ends cleanly, most often as the 409 for a number the turn just took, rather
than a 500.

Only for request handlers whose whole transaction is the retried call: the rollback discards
everything the session did before it. Never inside a bot turn, whose deadlock is an outage.
"""

import logging
from collections.abc import Callable

from psycopg.errors import DeadlockDetected
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def retry_on_deadlock[T](db: Session, operation: Callable[[], T]) -> T:
    """`operation()`, run once more after a rollback if PostgreSQL aborted it as a deadlock.
    Any other error, or a second deadlock, propagates."""
    try:
        result = operation()
    except OperationalError as exc:
        if not isinstance(exc.orig, DeadlockDetected):
            raise
        logger.warning("a Staff write was aborted as a deadlock; rolling back and retrying once")
        db.rollback()
        result = operation()

    return result
