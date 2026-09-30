#!/usr/bin/env bash
# Runs the real deploy/remote-deploy.sh against stub aws and docker executables and checks how
# it renders .env from Parameter Store: the WhatsApp bot parameters are all-or-nothing, and the
# fixed production settings are always written. Needs bash 4+ (the deploy script does); on macOS,
# run it in a container:
#
#   docker run --rm -v "$PWD:/repo" -w /repo bash:5 deploy/test-remote-deploy.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_SCRIPT="$REPO_ROOT/deploy/remote-deploy.sh"
PARAMETER_PATH="/tutorlink/prod/"
SITE_ADDRESS="tutorlink.example.com"
API_IMAGE="123456789012.dkr.ecr.us-east-1.amazonaws.com/tutorlink-api:abc"
WEB_IMAGE="123456789012.dkr.ecr.us-east-1.amazonaws.com/tutorlink-web:abc"
PLACEHOLDER="unset"
ENV_SENTINEL="SENTINEL=previous deploy"
BOT_PARAMETERS=(TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_WHATSAPP_NUMBER ANTHROPIC_API_KEY)
REAL_BOT_VALUES=(
  "ACtest0123456789abcdef0123456789ab"
  "twilio-auth-token-secret-value"
  "+15551234567"
  "sk-ant-test-secret-value"
)
REQUIRED_PARAMETER_LINES=(
  "POSTGRES_USER	tutorlink"
  "POSTGRES_PASSWORD	postgres-password-secret-value"
  "POSTGRES_DB	tutorlink"
  "SECRET_KEY	secret-key-secret-value"
  "SITE_ADDRESS	$SITE_ADDRESS"
)
ALWAYS_WRITTEN_LINES=(
  "TWILIO_STATUS_CALLBACK_URL=https://$SITE_ADDRESS/webhook/whatsapp/status"
  "API_DOCS_ENABLED=false"
  "COOKIE_SECURE=true"
  "TRUSTED_PROXIES="
)

if ((BASH_VERSINFO[0] < 4)); then
  echo "FAIL: needs bash 4+ (this is $BASH_VERSION); see the usage line at the top" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d)"
STUB_DIR="$WORK_DIR/bin"
DATA_DIR="$WORK_DIR/data"
ENV_FILE="$DATA_DIR/app/.env"
OUTPUT_FILE="$WORK_DIR/output"
export STUB_PARAMETERS_FILE="$WORK_DIR/parameters.tsv"
export STUB_CALL_LOG="$WORK_DIR/calls"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $1" >&2
  if [[ -f "$OUTPUT_FILE" ]]; then
    echo "--- deploy output ---" >&2
    cat "$OUTPUT_FILE" >&2
  fi
  exit 1
}

pass() {
  echo "  ok  $1"
}

write_stubs() {
  mkdir -p "$STUB_DIR"
  cat >"$STUB_DIR/aws" <<'EOF'
#!/usr/bin/env bash
echo "aws $*" >>"$STUB_CALL_LOG"
case "$1 $2" in
  "ssm get-parameters-by-path") cat "$STUB_PARAMETERS_FILE" ;;
  "ecr get-login-password") echo "dummy-ecr-token" ;;
  *) echo "stub aws: unexpected call: $*" >&2; exit 1 ;;
esac
EOF
  cat >"$STUB_DIR/docker" <<'EOF'
#!/usr/bin/env bash
echo "docker $*" >>"$STUB_CALL_LOG"
# Drain the password piped into `docker login --password-stdin`.
if [[ "$1" == login ]]; then
  cat >/dev/null
fi
EOF
  chmod +x "$STUB_DIR/aws" "$STUB_DIR/docker"
}

# Resets the data dir and call log, then writes the canned parameters: the required ones plus
# one line per "<KEY>=<value>" argument.
prepare_case() {
  rm -rf "$DATA_DIR" "$STUB_CALL_LOG" "$OUTPUT_FILE"
  mkdir -p "$DATA_DIR/app"
  echo "services: {}" >"$DATA_DIR/app/docker-compose.prod.yml"
  echo "$ENV_SENTINEL" >"$ENV_FILE"
  : >"$STUB_CALL_LOG"
  local line assignment
  {
    for line in "${REQUIRED_PARAMETER_LINES[@]}"; do
      echo "$PARAMETER_PATH$line"
    done
    for assignment in "$@"; do
      printf '%s%s\t%s\n' "$PARAMETER_PATH" "${assignment%%=*}" "${assignment#*=}"
    done
  } >"$STUB_PARAMETERS_FILE"
}

# Runs the deploy script and sets EXIT_CODE; stdout and stderr land in $OUTPUT_FILE.
run_deploy() {
  EXIT_CODE=0
  PATH="$STUB_DIR:$PATH" TUTORLINK_DATA_DIR="$DATA_DIR" \
    "$DEPLOY_SCRIPT" "$API_IMAGE" "$WEB_IMAGE" >"$OUTPUT_FILE" 2>&1 || EXIT_CODE=$?
}

assert_env_line() {
  local label="$1" line="$2"
  grep -qxF -- "$line" "$ENV_FILE" || fail "$label: .env has no line '$line'"
}

assert_succeeded() {
  local label="$1" line
  [[ "$EXIT_CODE" == 0 ]] || fail "$label: expected exit 0, got $EXIT_CODE"
  for line in "${ALWAYS_WRITTEN_LINES[@]}"; do
    assert_env_line "$label" "$line"
  done
  pass "$label: deploys and writes the fixed production settings"
}

assert_bot_unconfigured() {
  local label="$1" key
  for key in "${BOT_PARAMETERS[@]}"; do
    assert_env_line "$label" "$key="
  done
  grep -qF "WhatsApp bot not configured" "$OUTPUT_FILE" || fail "$label: no 'not configured' log line"
  pass "$label: writes the bot keys blank and logs that the bot is off"
}

# Checks the some-set failure: non-zero exit, each given parameter named by full path, the old
# .env untouched, and nothing pulled.
assert_rejected() {
  local label="$1" key
  shift
  [[ "$EXIT_CODE" != 0 ]] || fail "$label: expected a non-zero exit"
  for key in "$@"; do
    grep -qF "$PARAMETER_PATH$key" "$OUTPUT_FILE" || fail "$label: failure does not name $PARAMETER_PATH$key"
  done
  [[ "$(cat "$ENV_FILE")" == "$ENV_SENTINEL" ]] || fail "$label: .env was rewritten"
  ! grep -q '^docker pull' "$STUB_CALL_LOG" || fail "$label: images were pulled"
  pass "$label: fails naming $*, before .env is written or anything is pulled"
}

bot_assignments() {
  local values=("$@") index
  for index in "${!BOT_PARAMETERS[@]}"; do
    echo "${BOT_PARAMETERS[$index]}=${values[$index]}"
  done
}

write_stubs

echo "==> Bot parameters all '$PLACEHOLDER'"
mapfile -t assignments < <(bot_assignments "$PLACEHOLDER" "$PLACEHOLDER" "$PLACEHOLDER" "$PLACEHOLDER")
prepare_case "${assignments[@]}"
run_deploy
assert_succeeded "all placeholders"
assert_bot_unconfigured "all placeholders"

echo "==> Bot parameters all missing"
prepare_case
run_deploy
assert_succeeded "all missing"
assert_bot_unconfigured "all missing"

echo "==> Bot parameters all set"
mapfile -t assignments < <(bot_assignments "${REAL_BOT_VALUES[@]}")
prepare_case "${assignments[@]}"
run_deploy
assert_succeeded "all set"
for assignment in "${assignments[@]}"; do
  assert_env_line "all set" "$assignment"
done
pass "all set: writes the four real values"
for secret in "${REAL_BOT_VALUES[@]}" postgres-password-secret-value secret-key-secret-value; do
  ! grep -qF -- "$secret" "$OUTPUT_FILE" || fail "all set: output contains the secret '$secret'"
done
pass "all set: prints no secret value"

echo "==> ANTHROPIC_API_KEY still '$PLACEHOLDER'"
mapfile -t assignments < <(bot_assignments "${REAL_BOT_VALUES[@]:0:3}" "$PLACEHOLDER")
prepare_case "${assignments[@]}"
run_deploy
assert_rejected "one placeholder" ANTHROPIC_API_KEY

echo "==> Only TWILIO_ACCOUNT_SID set"
prepare_case "TWILIO_ACCOUNT_SID=${REAL_BOT_VALUES[0]}"
run_deploy
assert_rejected "three missing" TWILIO_AUTH_TOKEN TWILIO_WHATSAPP_NUMBER ANTHROPIC_API_KEY

echo "==> Deploy env rendering test passed"
