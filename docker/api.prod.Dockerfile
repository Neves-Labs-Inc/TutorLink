# Production API image: no --reload, no bind mount, the built source is what runs.
# Build context is ./api (docker build -f docker/api.prod.Dockerfile api).
FROM python:3.12-slim AS build

COPY --from=ghcr.io/astral-sh/uv:0.9.30 /uv /usr/local/bin/

ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# The runtime stage gets the resolved virtualenv only; uv itself stays in the build stage.
FROM python:3.12-slim

ARG APP_UID=10001

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN useradd --system --uid "$APP_UID" --no-create-home --shell /usr/sbin/nologin app

WORKDIR /app

COPY --from=build /opt/venv /opt/venv
COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app

USER app

EXPOSE 8000

# Trust X-Forwarded-* from any peer so the API sees the client's scheme and IP behind Caddy.
# Safe only because the api publishes no ports: its sole peer is the compose network.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
