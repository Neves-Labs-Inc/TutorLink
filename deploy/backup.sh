#!/usr/bin/env bash
set -euo pipefail

TUTORLINK_ROOT="${TUTORLINK_ROOT:-/opt/tutorlink}"
ENV_FILE="$TUTORLINK_ROOT/.env"
S3_PREFIX="postgres"

workdir=""

main() {
    local bucket timestamp key dump local_bytes remote_bytes

    if [ ! -r "$ENV_FILE" ]; then
        fail "cannot read $ENV_FILE"
    fi

    bucket="${BACKUP_BUCKET:-$(env_value BACKUP_BUCKET)}"
    if [ -z "$bucket" ]; then
        fail "BACKUP_BUCKET is set neither in the environment nor in $ENV_FILE"
    fi

    timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    key="$S3_PREFIX/${timestamp:0:4}/${timestamp:4:2}/tutorlink-$timestamp.dump"

    workdir="$(mktemp -d)"
    trap cleanup EXIT
    dump="$workdir/tutorlink-$timestamp.dump"

    # `exec -T` is required: without it this fails with "the input device is not a TTY" under
    # systemd, which has no terminal.
    if ! compose exec -T postgres sh -c "$(dump_script)" >"$dump"; then
        fail "pg_dump failed; nothing was uploaded to s3://$bucket/$key"
    fi

    local_bytes="$(wc -c <"$dump" | tr -d '[:space:]')"
    if [ "$local_bytes" -eq 0 ]; then
        fail "pg_dump produced a zero-byte dump; nothing was uploaded to s3://$bucket/$key"
    fi

    if ! aws s3 cp "$dump" "s3://$bucket/$key" --only-show-errors; then
        fail "upload of $local_bytes bytes to s3://$bucket/$key failed"
    fi

    if ! remote_bytes="$(head_object_size "$bucket" "$key")"; then
        fail "s3://$bucket/$key is not readable after a successful upload"
    fi

    if [ "$remote_bytes" -eq 0 ]; then
        fail "s3://$bucket/$key exists but is zero bytes"
    fi

    if [ "$remote_bytes" -ne "$local_bytes" ]; then
        fail "s3://$bucket/$key is $remote_bytes bytes, expected $local_bytes: upload truncated"
    fi

    echo "backup.sh: uploaded s3://$bucket/$key ($remote_bytes bytes)"
}

compose() {
    docker compose \
        -f "$TUTORLINK_ROOT/docker-compose.yml" \
        -f "$TUTORLINK_ROOT/docker-compose.prod.yml" \
        --env-file "$ENV_FILE" \
        "$@"
}

# The container's own shell expands the password from the container's own environment, so the
# secret never reaches a host command line, where `ps` would expose it to every local user.
dump_script() {
    cat <<'SCRIPT'
PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"
SCRIPT
}

env_value() {
    sed -n "s/^[[:space:]]*$1=//p" "$ENV_FILE" |
        tail -n 1 |
        sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

head_object_size() {
    aws s3api head-object --bucket "$1" --key "$2" --query ContentLength --output text
}

fail() {
    echo "backup.sh: FAILED: $1" >&2
    exit 1
}

cleanup() {
    if [ -n "$workdir" ]; then
        rm -rf "$workdir"
    fi
}

main "$@"
