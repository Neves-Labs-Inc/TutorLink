#!/usr/bin/env bash
set -euo pipefail
set -o errtrace

# Issue #31's objection was never to a file on the box: it was to a *checked-in* file and to
# secrets that die with the machine. A 0600 root-owned file generated at deploy time from SSM
# Parameter Store has neither property.
#
# Every variable the production stack reads comes from SSM under /tutorlink/prod/ — secrets as
# SecureString, non-secrets (TRUSTED_PROXIES, COOKIE_SECURE, ECR_REGISTRY, BACKUP_BUCKET, the
# URLs) as plain String. There is no second source: .env.prod.example is the authoritative list
# of names and every one of them is an SSM parameter. This script renders exactly one variable of
# its own, IMAGE_TAG, so that a later `docker compose up` — a boot unit after a reboot, an
# operator debugging by hand — resolves the production overlay's image references without being
# told the tag again.
#
# Every value is written single-quoted, and a value containing a single quote or a newline is
# refused rather than written. This is a security property, not formatting: `docker compose
# --env-file` interpolates an UNQUOTED value, so a password containing `$HOME` or `${ANYTHING}`
# would reach the container silently rewritten — or carrying a value read off the host. Single
# quotes are the one form compose's parser takes literally, with no escape processing.
# Consumers must therefore strip the surrounding quotes, and must keep parsing this file as data:
# it is generated from operator-supplied values and `source`ing it would execute whatever `$(…)`
# one of them happens to contain.

readonly DEPLOY_ROOT="/opt/tutorlink"
readonly SSM_PATH="/tutorlink/prod/"
readonly ENV_FILE="$DEPLOY_ROOT/.env"
readonly REQUIRED_NAMES="SECRET_KEY POSTGRES_PASSWORD TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN ANTHROPIC_API_KEY ECR_REGISTRY BACKUP_BUCKET"
readonly RELEASE_PREFIX="releases"

# The compose files are part of the application, not of the box: they change whenever a service or
# an environment variable changes and they must match the image they run. CI uploads them under
# releases/<image-tag>/, this script fetches that tag's pair, and so a rollback to an older tag
# runs that tag's compose files rather than today's. The alternative — a pair placed once by hand —
# cannot be caught by assert_compose_variables_resolved below, because a stale file does not
# mention the variable the new image needs and there is therefore nothing left unresolved.
readonly COMPOSE_FILES="docker-compose.yml docker-compose.prod.yml"

compose=(
  docker compose
  -f "$DEPLOY_ROOT/docker-compose.yml"
  -f "$DEPLOY_ROOT/docker-compose.prod.yml"
  --env-file "$ENV_FILE"
)

step="startup"
image_tag=""
ecr_registry=""
temp_env_file=""
temp_compose_dir=""

main() {
  if [ "$#" -ne 1 ] || [ -z "${1:-}" ]; then
    echo "usage: $(basename "$0") <image-tag>" >&2
    exit 2
  fi
  image_tag="$1"

  trap cleanup EXIT
  trap 'echo "deploy.sh FAILED during: $step" >&2' ERR

  step="checking preconditions"
  assert_preconditions

  # Every compose call below reads the tag from here rather than from .env, because .env still
  # names the tag that is currently serving and must go on doing so until the swap succeeds.
  export IMAGE_TAG="$image_tag"

  step="fetching configuration from $SSM_PATH"
  render_env_file "$(deployed_image_tag)"

  step="checking the rendered configuration"
  assert_required_names

  # Before anything reads a compose file, and before the pull: a tag with no release prefix has to
  # abort while the box is still exactly as it was, and the variable check below is only worth
  # anything when it runs against the compose files this tag was built with.
  step="fetching the compose files for $image_tag"
  fetch_compose_files "$(env_value BACKUP_BUCKET)"
  assert_compose_files_present

  step="checking the compose files against the rendered configuration"
  assert_compose_variables_resolved

  step="authenticating to ECR"
  ecr_registry="$(env_value ECR_REGISTRY)"
  aws ecr get-login-password | docker login --username AWS --password-stdin "$ecr_registry"

  step="pulling images for $image_tag"
  "${compose[@]}" pull

  # The ordering below is load-bearing, and it is why the migration is its own step rather than
  # an entrypoint or a `depends_on` one-shot. It runs the NEW image's migrations while the
  # PREVIOUS containers are still serving, so a non-zero exit here ends the deploy with the old
  # stack untouched and the database unchanged. Moving it below `up -d` leaves the database
  # half-upgraded under new code, and no test in this repository catches that.
  step="running database migrations"
  "${compose[@]}" run --rm -T api alembic upgrade head

  step="swapping containers"
  "${compose[@]}" up -d --remove-orphans

  # .env is what an unattended `docker compose up` reads — a boot unit after an instance
  # retirement, an operator by hand — so it may only name this tag once this tag is serving. Had
  # it been written before the migration step, a failed migration followed by a reboot would
  # start the NEW containers against the database the deploy deliberately left un-migrated,
  # which is the corruption the ordering above exists to prevent.
  step="recording the deployed tag"
  render_env_file "$image_tag"

  step="reporting"
  report_running_images

  echo "deploy.sh: $image_tag is live"
}

cleanup() {
  if [ -n "$temp_env_file" ]; then
    rm -f "$temp_env_file"
  fi

  if [ -n "$temp_compose_dir" ]; then
    rm -rf "$temp_compose_dir"
  fi
}

assert_preconditions() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "deploy.sh must run as root: it writes $ENV_FILE and drives the system Docker daemon" >&2
    return 1
  fi

  local missing=""
  local name
  for name in aws docker jq; do
    command -v "$name" >/dev/null || missing="$missing $name"
  done

  if [ -n "$missing" ]; then
    echo "deploy root is not provisioned, missing:$missing" >&2
    return 1
  fi
}

# Downloaded to a directory on the deploy root's own filesystem and moved into place only once
# BOTH files have arrived. Moving each download as it lands would leave a failed second fetch with
# the new base file beside the previous overlay — a mismatched pair that the presence assertion
# below cannot see, because both files exist. Aborting with the previous pair untouched leaves
# the box exactly as it was: .env still names the tag that is serving, and those two files are the
# ones that tag was deployed with, so an unattended `docker compose up` after a reboot still
# restarts what was already running.
fetch_compose_files() {
  local bucket="$1"
  local source="s3://$bucket/$RELEASE_PREFIX/$image_tag"
  local name

  temp_compose_dir="$(mktemp -d "$DEPLOY_ROOT/.compose.XXXXXXXX")"

  for name in $COMPOSE_FILES; do
    if ! aws s3 cp "$source/$name" "$temp_compose_dir/$name" --only-show-errors; then
      echo "no release artifact at $source/$name" >&2
      echo "$image_tag has no compose files in S3; a tag built before the compose files became" \
        "release artifacts cannot be deployed by this script." >&2
      return 1
    fi
  done

  for name in $COMPOSE_FILES; do
    mv -f "$temp_compose_dir/$name" "$DEPLOY_ROOT/$name"
  done

  rmdir "$temp_compose_dir"
  temp_compose_dir=""
}

assert_compose_files_present() {
  local missing=""
  local name
  for name in $COMPOSE_FILES; do
    [ -f "$DEPLOY_ROOT/$name" ] || missing="$missing $DEPLOY_ROOT/$name"
  done

  if [ -n "$missing" ]; then
    echo "deploy root is not provisioned, missing:$missing" >&2
    return 1
  fi
}

deployed_image_tag() {
  local previous
  previous="$(env_value IMAGE_TAG)"

  printf '%s' "${previous:-$image_tag}"
}

env_value() {
  local line=""

  if [ -f "$ENV_FILE" ]; then
    line="$(grep -m1 "^$1=" "$ENV_FILE" || true)"
  fi

  line="${line#"$1="}"
  line="${line#\'}"

  printf '%s' "${line%\'}"
}

# Written to a fresh 0600 temp file on the same filesystem and moved into place, so a failure
# anywhere above the `mv` leaves the previous .env intact and the stack still startable.
render_env_file() {
  local recorded_tag="$1"

  temp_env_file="$(mktemp "$DEPLOY_ROOT/.env.XXXXXXXX")"
  chmod 0600 "$temp_env_file"

  aws ssm get-parameters-by-path \
    --path "$SSM_PATH" \
    --recursive \
    --with-decryption \
    --query 'Parameters[].[Name,Value]' \
    --output json \
    | jq -r --arg prefix "$SSM_PATH" '
        .[]
        | (.[0] | ltrimstr($prefix)) as $name
        | .[1] as $value
        | if ($name | test("^[A-Za-z_][A-Za-z0-9_]*$") | not)
          then ("\($name) is not usable as an environment variable name" | halt_error(1))
          elif ($value | test("[\n\u0027]"))
          then ("\($name) holds a newline or a single quote, which this file cannot represent"
                | halt_error(1))
          else "\($name)=\u0027\($value)\u0027"
          end
      ' >"$temp_env_file"

  printf "IMAGE_TAG='%s'\n" "$recorded_tag" >>"$temp_env_file"

  mv -f "$temp_env_file" "$ENV_FILE"
  temp_env_file=""
}

assert_required_names() {
  local missing=""
  local name
  for name in $REQUIRED_NAMES; do
    grep -q "^$name=" "$ENV_FILE" || missing="$missing $name"
  done

  if [ -n "$missing" ]; then
    echo "no parameter under $SSM_PATH for:$missing" >&2
    return 1
  fi
}

# Compose is the authority on which variables the stack needs, so ask it rather than keeping a
# second list here. Only its stderr is read: `config` prints the rendered file, secret values
# and all, and that must never reach a log.
assert_compose_variables_resolved() {
  local warnings
  warnings="$("${compose[@]}" config 2>&1 >/dev/null)"

  if printf '%s' "$warnings" | grep -q "variable is not set"; then
    printf '%s\n' "$warnings" >&2
    return 1
  fi
}

# A tag is a label and a digest is the artifact. If a pull was a no-op because a tag was reused,
# or a stale local image shadowed it, the tag still says the deploy worked and only the digest
# says what is really serving.
report_running_images() {
  "${compose[@]}" ps
  "${compose[@]}" images

  local image
  for image in "$ecr_registry/tutorlink-api:$image_tag" "$ecr_registry/tutorlink-web:$image_tag"; do
    printf '%s ' "$image"
    docker image inspect --format '{{.Id}}{{range .RepoDigests}} {{.}}{{end}}' "$image"
  done
}

main "$@"
