from redis import Redis
from redis.exceptions import RedisError

from app.config import get_settings

redis_client = Redis.from_url(get_settings().redis_url, decode_responses=True)


def get_redis() -> Redis:
    """FastAPI dependency handing out the shared client.

    One process-wide client, not one per request: `Redis` is a handle onto a connection pool,
    already thread-safe, and building one per request would open a fresh TCP connection for
    every login. The indirection exists so a route can take Redis via `Depends` and a test can
    override it with a double, the same way `get_db` is overridden — a module-level import
    gives a test nothing to replace short of monkeypatching the module.
    """
    return redis_client


def check_redis() -> bool:
    try:
        reachable = bool(redis_client.ping())
    except RedisError:
        reachable = False

    return reachable
