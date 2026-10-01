#!/usr/bin/env bash
# Deploys two prebuilt images on the production host: writes .env from SSM Parameter Store,
# pulls, migrates, then swaps the containers. A failed migration exits before api and web are
# recreated, so the previous containers keep serving. Runs as root; the deploy workflow ships
# this script and the prod compose file into APP_DIR through SSM Run Command.
#
#   remote-deploy.sh <api-image-uri> <web-image-uri>
set -euo pipefail

# Production never sets TUTORLINK_DATA_DIR; the override exists so deploy/test-remote-deploy.sh can
# run this script against a temp dir.
readonly DATA_DIR="${TUTORLINK_DATA_DIR:-/srv/tutorlink}"
readonly APP_DIR="$DATA_DIR/app"
readonly COMPOSE_FILE="$APP_DIR/docker-compose.prod.yml"
readonly ENV_FILE="$APP_DIR/.env"
readonly PARAMETER_PATH="/tutorlink/prod/"
readonly REQUIRED_PARAMETERS=(DATABASE_URL SECRET_KEY SITE_ADDRESS)
# The WhatsApp bot's configuration: all four set turns the bot on, none set leaves it off, and a
# mix fails the deploy so a half-configured bot never goes live.
readonly BOT_PARAMETERS=(TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_WHATSAPP_NUMBER ANTHROPIC_API_KEY)
# Terraform creates the bot parameters holding this value (infra/ssm.tf); keep the two in sync.
readonly BOT_PARAMETER_PLACEHOLDER="unset"
# <account>.dkr.ecr.<region>.amazonaws.com/<repo>:<tag>; the region is read from the host part.
readonly ECR_IMAGE_PATTERN='^[0-9]{12}\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com/[a-z0-9._/-]+:[A-Za-z0-9._-]+$'

fail() {
  echo "deploy failed: $1" >&2
  exit 1
}

log() {
  echo "==> $1"
}

compose() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <api-image-uri> <web-image-uri>" >&2
  exit 2
fi
readonly API_IMAGE="$1"
readonly WEB_IMAGE="$2"

[[ "$API_IMAGE" =~ $ECR_IMAGE_PATTERN ]] || fail "api image '$API_IMAGE' is not an ECR image URI"
readonly REGION="${BASH_REMATCH[1]}"
[[ "$WEB_IMAGE" =~ $ECR_IMAGE_PATTERN ]] || fail "web image '$WEB_IMAGE' is not an ECR image URI"
[[ -f "$COMPOSE_FILE" ]] || fail "$COMPOSE_FILE is missing"

cd "$APP_DIR"

log "Reading parameters under $PARAMETER_PATH"
# Held in a variable, not read through a pipe, so a failed AWS call stops the script.
parameters_tsv="$(aws ssm get-parameters-by-path --region "$REGION" --path "$PARAMETER_PATH" \
  --with-decryption --query 'Parameters[].[Name,Value]' --output text)"
declare -A parameters=()
while IFS=$'\t' read -r name value; do
  if [[ -n "$name" ]]; then
    parameters["${name#"$PARAMETER_PATH"}"]="$value"
  fi
done <<<"$parameters_tsv"
for key in "${REQUIRED_PARAMETERS[@]}"; do
  [[ -n "${parameters[$key]:-}" ]] || fail "parameter $PARAMETER_PATH$key is missing or empty"
done

unset_bot_parameters=()
for key in "${BOT_PARAMETERS[@]}"; do
  value="${parameters[$key]:-}"
  if [[ -z "$value" || "$value" == "$BOT_PARAMETER_PLACEHOLDER" ]]; then
    unset_bot_parameters+=("$PARAMETER_PATH$key")
  fi
done
is_bot_configured=false
if ((${#unset_bot_parameters[@]} == 0)); then
  is_bot_configured=true
elif ((${#unset_bot_parameters[@]} < ${#BOT_PARAMETERS[@]})); then
  fail "the WhatsApp bot parameters must be set together; still unset: ${unset_bot_parameters[*]}"
else
  log "WhatsApp bot not configured (all bot parameters unset); deploying without it"
fi
# Blank values tell the app the bot is unconfigured.
bot_env_lines=()
for key in "${BOT_PARAMETERS[@]}"; do
  if [[ "$is_bot_configured" == true ]]; then
    bot_env_lines+=("$key=${parameters[$key]}")
  else
    bot_env_lines+=("$key=")
  fi
done

env_lines=(
  "DATABASE_URL=${parameters[DATABASE_URL]}"
  "SECRET_KEY=${parameters[SECRET_KEY]}"
  "DEBUG=false"
  "SITE_ADDRESS=${parameters[SITE_ADDRESS]}"
  "${bot_env_lines[@]}"
  "TWILIO_STATUS_CALLBACK_URL=https://${parameters[SITE_ADDRESS]}/webhook/whatsapp/status"
  "API_DOCS_ENABLED=false"
  "COOKIE_SECURE=true"
  # The business is in Miami; a hardcoded non-secret, so not an SSM parameter.
  "BUSINESS_TIMEZONE=America/New_York"
  # Empty on purpose: the prod image's uvicorn (--proxy-headers) already trusts Caddy, its only
  # peer, so the app's own proxy-headers middleware stays off.
  "TRUSTED_PROXIES="
  "API_IMAGE=$API_IMAGE"
  "WEB_IMAGE=$WEB_IMAGE"
  "DATA_DIR=$DATA_DIR"
)

log "Writing $ENV_FILE"
# Created 600 from the start and renamed into place, so the secrets are never world-readable
# and a half-written file never replaces the old one.
env_tmp="$(umask 077 && mktemp "$APP_DIR/.env.XXXXXX")"
printf '%s\n' "${env_lines[@]}" >"$env_tmp"
chmod 600 "$env_tmp"
mv -f "$env_tmp" "$ENV_FILE"

log "Pulling images"
aws ecr get-login-password --region "$REGION" |
  docker login --username AWS --password-stdin "${API_IMAGE%%/*}"
if [[ "${WEB_IMAGE%%/*}" != "${API_IMAGE%%/*}" ]]; then
  aws ecr get-login-password --region "$REGION" |
    docker login --username AWS --password-stdin "${WEB_IMAGE%%/*}"
fi
docker pull "$API_IMAGE"
docker pull "$WEB_IMAGE"

log "Running migrations"
if ! compose run --rm api alembic upgrade head; then
  fail "migration failed; api and web are still running the previous images"
fi

log "Starting the new containers"
compose up -d --remove-orphans
# -a also drops earlier sha-tagged images; images the running containers use are kept.
docker image prune -af

log "Deployed $API_IMAGE and $WEB_IMAGE"
