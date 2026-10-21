from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


# Statement parameters (phone numbers, Children's names, message bodies) never reach error text,
# and so never reach the logs.
engine = create_engine(get_settings().database_url, pool_pre_ping=True, hide_parameters=True)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

# The bot worker's own pool, so turns waiting on the model never hold the connections HTTP
# requests need. Each of the worker's four concurrent turns holds at most two connections at
# once (its advisory-lock connection, then its turn or marker-clear session), plus one for the
# poll.
BOT_WORKER_POOL_SIZE = 9
BOT_WORKER_MAX_OVERFLOW = 3
bot_worker_engine = create_engine(
    get_settings().database_url,
    pool_pre_ping=True,
    hide_parameters=True,
    pool_size=BOT_WORKER_POOL_SIZE,
    max_overflow=BOT_WORKER_MAX_OVERFLOW,
)
BotWorkerSessionLocal = sessionmaker(
    bind=bot_worker_engine, autoflush=False, expire_on_commit=False
)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def check_database() -> bool:
    try:
        with SessionLocal() as session:
            session.execute(text("SELECT 1"))
    except SQLAlchemyError:
        reachable = False
    else:
        reachable = True

    return reachable
