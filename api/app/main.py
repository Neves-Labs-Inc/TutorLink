from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.config import get_settings
from app.routers import (
    auth,
    availability,
    booking_status,
    booking_writes,
    bookings,
    children,
    client_bookings,
    clients,
    exceptions,
    health,
    settings,
    slots,
    stats,
    subjects,
    tutor_subjects,
    tutors,
    users,
)


def create_app() -> FastAPI:
    """Build the application, mounting the proxy-header trust boundary last of all.

    The trust boundary lives here rather than on uvicorn's command line because a CLI flag sits
    outside the ASGI application and `TestClient` does not run uvicorn, so no test in this suite
    could ever assert it — and issue #33 says in its own words that this bug is invisible in
    local development. Mounted here it is driven end to end by `tests/test_trusted_proxies.py`,
    and the "half application code, half server configuration" split that `_client_ip`'s
    docstring in `app/routers/auth.py` complains about closes.

    uvicorn's own proxy-header handling must stay off, which is what `--no-proxy-headers` in
    `docker/api.Dockerfile` is for. Its shipped default, `forwarded_allow_ips=127.0.0.1`, needs
    the peer to be loopback to fire, and under the compose topology it is not: Caddy proxies to
    `api:8000` as a container on the compose network. But uvicorn also reads
    `FORWARDED_ALLOW_IPS` from the environment on its own, so without this flag one stray
    variable — or a topology change that does put the proxy on loopback — arms a second trust
    boundary that runs before this middleware and hands it an address a header had already
    chosen. Two trust boundaries with different configurations is worse than either alone.
    Exactly one place decides, and it is this one.

    The mount is **last** on purpose. Starlette's `add_middleware` inserts at the front of
    `user_middleware` and builds the stack so the most recently added middleware is outermost
    (`starlette/applications.py:63-83,104-107`), so anything added after this call would run
    outside it and read the proxy's address instead of the client's. New middleware goes
    **above** this call, never below.

    With `TRUSTED_PROXIES` unset nothing is mounted at all: fail-closed, and it makes the empty
    default a byte-for-byte reproduction of the behaviour before this existed rather than a
    differently-configured version of the new one.
    """
    # No CORS middleware by design (D-012): the browser reaches this API same-origin through the
    # Vite dev proxy. Do not add one.
    app = FastAPI(title="TutorLink API", docs_url="/docs")

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(users.router)
    app.include_router(exceptions.router)
    app.include_router(settings.router)
    app.include_router(subjects.router)
    app.include_router(clients.router)
    app.include_router(client_bookings.router)
    app.include_router(children.router)
    app.include_router(tutors.router)
    app.include_router(tutor_subjects.router)
    app.include_router(availability.router)
    app.include_router(slots.router)
    app.include_router(bookings.router)
    app.include_router(booking_writes.router)
    app.include_router(booking_status.router)
    app.include_router(stats.router)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        first_error = exc.errors()[0]
        location = ".".join(str(part) for part in first_error["loc"] if part != "body")
        message = first_error["msg"]
        detail = f"{location}: {message}" if location else message

        return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content={"detail": detail})

    trusted = get_settings().trusted_proxy_hosts
    if trusted:
        app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=trusted)

    return app


app = create_app()
