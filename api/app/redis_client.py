import redis
from redis.exceptions import RedisError

from app.config import get_settings

redis_client = redis.Redis.from_url(get_settings().redis_url, decode_responses=True)


def check_redis() -> bool:
    try:
        reachable = bool(redis_client.ping())
    except RedisError:
        reachable = False

    return reachable
