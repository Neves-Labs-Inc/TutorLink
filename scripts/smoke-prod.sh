#!/usr/bin/env bash
# Runs the production compose stack on https://localhost and checks the routing contract:
# Caddy serves the dashboard (with SPA fallback), 404s stale hashed assets, sends the security
# headers, and proxies /api/*, /auth/*, /health* and /webhook/* to FastAPI on the same origin.
# Needs Docker, curl, openssl, and host ports 80 and 443 free.
#
#   scripts/smoke-prod.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_NAME="tutorlink-smoke"
API_IMAGE="tutorlink-api:smoke"
WEB_IMAGE="tutorlink-web:smoke"
POSTGRES_IMAGE="postgres:17-alpine"
BASE_URL="https://localhost"
STARTUP_TIMEOUT_SECONDS=60
APP_ROOT_MARKER='<div id="root"></div>'
MISSING_ASSET_PATH="/assets/index-does-not-exist.js"
# Header lines every response must carry, matched case-insensitively at the start of a line.
REQUIRED_HEADERS=(
  "Strict-Transport-Security: max-age=31536000"
  "X-Content-Type-Options: nosniff"
  "X-Frame-Options: DENY"
  "Referrer-Policy: strict-origin-when-cross-origin"
  "Content-Security-Policy: frame-ancestors 'none'"
)

WORK_DIR="$(mktemp -d)"
DATA_DIR="$WORK_DIR/data"
RESPONSE_BODY="$WORK_DIR/response-body"
RESPONSE_HEADERS="$WORK_DIR/response-headers"
INDEX_BODY="$WORK_DIR/index-body"
TWILIO_TEST_AUTH_TOKEN="$(openssl rand -hex 16)"
STATUS_WEBHOOK_SID="SM00000000000000000000000000000000"

compose() {
  docker compose -p "$PROJECT_NAME" -f "$WORK_DIR/docker-compose.prod.yml" \
    -f "$WORK_DIR/docker-compose.postgres.yml" "$@"
}

cleanup() {
  echo "==> Tearing down"
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  # Postgres and Caddy write their data as container users the host user may not own.
  docker run --rm -v "$WORK_DIR:/work" "$POSTGRES_IMAGE" rm -rf /work/data >/dev/null 2>&1 || true
  rm -rf "$WORK_DIR"
  docker image rm "$API_IMAGE" "$WEB_IMAGE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

pass() {
  echo "  ok  $1"
}

# Sends one request and sets STATUS and CONTENT_TYPE; the body lands in $RESPONSE_BODY and the
# headers in $RESPONSE_HEADERS.
request() {
  local method="$1" path="$2"
  shift 2
  local written
  written="$(curl -ksS -X "$method" -o "$RESPONSE_BODY" -D "$RESPONSE_HEADERS" \
    -w '%{http_code} %{content_type}' "$@" "$BASE_URL$path")" ||
    fail "$method $path: request failed (no HTTP response)"
  STATUS="${written%% *}"
  CONTENT_TYPE="${written#* }"
}

assert_serves_index() {
  local path="$1"
  request GET "$path"
  [[ "$STATUS" == 200 ]] || fail "GET $path: expected 200, got $STATUS"
  cmp -s "$RESPONSE_BODY" "$INDEX_BODY" || fail "GET $path: body differs from GET /"
  pass "GET $path serves index.html"
}

assert_json() {
  local label="$1" expected_status="$2" expected_pattern="$3"
  [[ "$STATUS" == "$expected_status" ]] || fail "$label: expected $expected_status, got $STATUS"
  [[ "$CONTENT_TYPE" == application/json* ]] || fail "$label: expected JSON, got '$CONTENT_TYPE'"
  # Unquoted on purpose: the expected body is a glob pattern.
  # shellcheck disable=SC2053
  [[ "$(cat "$RESPONSE_BODY")" == $expected_pattern ]] ||
    fail "$label: expected body matching $expected_pattern, got $(cat "$RESPONSE_BODY")"
  pass "$label → $STATUS $(cat "$RESPONSE_BODY")"
}

assert_security_headers() {
  local label="$1" header
  for header in "${REQUIRED_HEADERS[@]}"; do
    grep -qiF -- "$header" "$RESPONSE_HEADERS" || fail "$label: missing header '$header'"
  done
  ! grep -qi '^server:' "$RESPONSE_HEADERS" || fail "$label: leaks a Server header"
  pass "$label sends the security headers"
}

wait_for_site() {
  local deadline=$((SECONDS + STARTUP_TIMEOUT_SECONDS))
  until curl -ksf -o /dev/null "$BASE_URL/health"; do
    ((SECONDS < deadline)) || fail "site did not answer $BASE_URL/health within ${STARTUP_TIMEOUT_SECONDS}s"
    sleep 1
  done
}

echo "==> Building images"
docker build -q -f "$REPO_ROOT/docker/api.prod.Dockerfile" -t "$API_IMAGE" "$REPO_ROOT/api" >/dev/null ||
  fail "building the API image"
docker build -q -f "$REPO_ROOT/docker/web.Dockerfile" -t "$WEB_IMAGE" "$REPO_ROOT" >/dev/null ||
  fail "building the web image"

echo "==> Writing throwaway config to $WORK_DIR"
cp "$REPO_ROOT/docker-compose.prod.yml" "$WORK_DIR/docker-compose.prod.yml"
POSTGRES_PASSWORD="$(openssl rand -hex 32)"
# Production uses RDS; this throwaway Postgres stands in for it, so the prod file stays untouched.
cat >"$WORK_DIR/docker-compose.postgres.yml" <<EOF
services:
  postgres:
    image: $POSTGRES_IMAGE
    environment:
      POSTGRES_USER: tutorlink
      POSTGRES_PASSWORD: $POSTGRES_PASSWORD
      POSTGRES_DB: tutorlink
    volumes:
      - $DATA_DIR/pgdata:/var/lib/postgresql/data
    healthcheck:
      # Over TCP so a first boot isn't healthy until initdb has finished.
      test: ["CMD-SHELL", "pg_isready -h localhost -U tutorlink -d tutorlink"]
      interval: 5s
      timeout: 5s
      retries: 10
  api:
    depends_on:
      postgres:
        condition: service_healthy
EOF
cat >"$WORK_DIR/.env" <<EOF
DATABASE_URL=postgresql+psycopg://tutorlink:$POSTGRES_PASSWORD@postgres:5432/tutorlink
SECRET_KEY=$(openssl rand -hex 32)
DEBUG=false
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=$TWILIO_TEST_AUTH_TOKEN
TWILIO_WHATSAPP_NUMBER=
SITE_ADDRESS=localhost
API_IMAGE=$API_IMAGE
WEB_IMAGE=$WEB_IMAGE
DATA_DIR=$DATA_DIR
EOF

echo "==> Starting postgres and migrating"
compose up -d --wait postgres || fail "postgres did not become healthy"
compose run --rm api alembic upgrade head || fail "alembic upgrade head"

echo "==> Starting the stack"
compose up -d --wait || fail "the stack did not start (are ports 80 and 443 free?)"
wait_for_site

echo "==> Checking the routing contract"
request GET /
[[ "$STATUS" == 200 ]] || fail "GET /: expected 200, got $STATUS"
[[ "$CONTENT_TYPE" == text/html* ]] || fail "GET /: expected HTML, got '$CONTENT_TYPE'"
grep -qF "$APP_ROOT_MARKER" "$RESPONSE_BODY" || fail "GET /: body has no app root ($APP_ROOT_MARKER)"
cp "$RESPONSE_BODY" "$INDEX_BODY"
pass "GET / serves the dashboard"
assert_security_headers "GET /"

assert_serves_index /login
assert_serves_index /dashboard
# The API's own docs stay private: these fall through to the SPA instead of FastAPI.
assert_serves_index /docs
assert_serves_index /openapi.json

request GET /health
assert_json "GET /health" 200 '{"status":"ok"}'
assert_security_headers "GET /health (proxied)"

request GET /health/ready
assert_json "GET /health/ready" 200 '{"database":"ok"}'

request POST /auth/token --data-urlencode "username=nobody@example.com" --data-urlencode "password=wrong-password"
# Only FastAPI's error envelope proves the request reached the API rather than the SPA.
assert_json "POST /auth/token with bad credentials" 401 '{"detail":*}'

request GET /api/users
assert_json "GET /api/users without a token" 401 '{"detail":*}'

# FastAPI builds this redirect from the request URL, so it is https only when uvicorn trusts
# Caddy's X-Forwarded-Proto.
request GET /api/users/
[[ "$STATUS" == 307 ]] || fail "GET /api/users/: expected a 307 slash redirect, got $STATUS"
grep -qi "^location: $BASE_URL/api/users" "$RESPONSE_HEADERS" ||
  fail "GET /api/users/: redirect is not https ($(grep -i '^location:' "$RESPONSE_HEADERS" | tr -d '\r'))"
pass "GET /api/users/ redirects over https (API trusts the proxy)"

request POST /webhook/whatsapp --data-urlencode "Body=hello"
# Only FastAPI's signature check proves the request reached the API rather than the SPA.
assert_json "POST /webhook/whatsapp unsigned" 403 '{"detail":"Invalid Twilio signature"}'

# Twilio signs the full URL plus each form key and value, sorted by key.
STATUS_WEBHOOK_URL="$BASE_URL/webhook/whatsapp/status"
STATUS_SIGNATURE="$(printf '%s' "${STATUS_WEBHOOK_URL}MessageSid${STATUS_WEBHOOK_SID}MessageStatusdelivered" |
  openssl dgst -sha1 -hmac "$TWILIO_TEST_AUTH_TOKEN" -binary | base64)"
request POST /webhook/whatsapp/status -H "X-Twilio-Signature: $STATUS_SIGNATURE" \
  --data-urlencode "MessageSid=$STATUS_WEBHOOK_SID" --data-urlencode "MessageStatus=delivered"
[[ "$STATUS" == 204 ]] || fail "POST /webhook/whatsapp/status signed: expected 204, got $STATUS"
pass "POST /webhook/whatsapp/status signed → 204 (proves Caddy routing and the https URL reconstruction)"

ASSET_PATH="$(grep -oE '/assets/[^"]+\.js' "$INDEX_BODY" | head -n 1)"
[[ -n "$ASSET_PATH" ]] || fail "GET /: index.html references no /assets/*.js"
request GET "$ASSET_PATH"
[[ "$STATUS" == 200 ]] || fail "GET $ASSET_PATH: expected 200, got $STATUS"
[[ "$CONTENT_TYPE" == *javascript* ]] || fail "GET $ASSET_PATH: expected JavaScript, got '$CONTENT_TYPE'"
pass "GET $ASSET_PATH serves the bundle"

# A browser holding an old index.html must get a 404, not index.html under a .js name.
request GET "$MISSING_ASSET_PATH"
[[ "$STATUS" == 404 ]] || fail "GET $MISSING_ASSET_PATH: expected 404, got $STATUS"
pass "GET $MISSING_ASSET_PATH → 404"

echo "==> Smoke test passed"
