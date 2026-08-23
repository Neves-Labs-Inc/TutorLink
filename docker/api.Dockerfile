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
# `app/routers/auth.py` buckets by client address. With that default an attacker rotates the
# header and lands in a fresh bucket every request, so the per-IP limit stops existing. Under
# the Phase 8 topology (nginx terminating TLS on the same host) the peer *is* loopback, so the
# bypass arms itself exactly when the endpoint becomes public.
#
# Re-enable proxy headers only together with the reverse proxy from #2, and only with
# `forwarded_allow_ips` set to that proxy's specific address. Never `FORWARDED_ALLOW_IPS=*`.
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload", "--no-proxy-headers"]
