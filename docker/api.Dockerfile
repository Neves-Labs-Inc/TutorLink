FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

# The project environment lives outside /app because compose bind-mounts ./api over /app;
# a venv at /app/.venv would be shadowed at runtime and leak onto the host.
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    UV_FROZEN=1 \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN UV_COMPILE_BYTECODE=1 uv sync --frozen --no-install-project

COPY . .
RUN UV_COMPILE_BYTECODE=1 uv sync --frozen

EXPOSE 8000

# `--no-proxy-headers` is a security flag, not a tuning knob. uvicorn defaults to
# `--proxy-headers` with `forwarded_allow_ips=127.0.0.1`, which means it rewrites the client
# address from `X-Forwarded-For` whenever the peer is loopback — and the login rate limiter in
# `app/routers/auth.py` buckets by client address. Caddy (#2) proxies to `api:8000` by Docker
# service name, so under this compose topology the peer is a container address, never loopback,
# and that shipped default would not fire on its own.
#
# The standing reason the flag still matters: uvicorn reads `FORWARDED_ALLOW_IPS` from the
# environment on its own. Without `--no-proxy-headers`, one stray environment variable — or a
# topology change that does put the proxy on loopback — arms a second trust boundary that runs
# before the application's and hands it an address a header already chose.
#
# The application now owns proxy-header trust: `create_app()` in `app/main.py` mounts
# `ProxyHeadersMiddleware` from `TRUSTED_PROXIES`. If uvicorn also trusted forwarded headers,
# there would be two trust boundaries with two different configurations. Exactly one place
# decides, and it is the one the test suite can reach — dropping this flag re-arms the other
# one.
#
# Trust is configured through `TRUSTED_PROXIES`, deliberately not `FORWARDED_ALLOW_IPS`: uvicorn
# reads that name from the environment itself, and sharing it would let one value arm two
# boundaries at once.
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload", "--no-proxy-headers"]
