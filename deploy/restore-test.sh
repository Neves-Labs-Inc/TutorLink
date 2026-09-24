#!/usr/bin/env bash
#
# This is not test scaffolding and must not be deleted with the tests. It is also the migration
# mechanism REQ-081 depends on: the dump it restores is a portable logical backup that loads into
# a new box or into a managed PostgreSQL, which a platform snapshot cannot do.
#
# Usage: restore-test.sh [s3-key]     default: the newest key under the postgres/ prefix
set -euo pipefail

TUTORLINK_ROOT="${TUTORLINK_ROOT:-/opt/tutorlink}"
ENV_FILE="$TUTORLINK_ROOT/.env"
S3_PREFIX="postgres"
SCRATCH_DB="${SCRATCH_DB:-tutorlink_restore_test}"
COUNTED_TABLES=(users tutors bookings conversations messages)
MIN_NON_EMPTY_TABLES=4

workdir=""
non_empty_tables=0

main() {
    local bucket production_db key dump

    if [ ! -r "$ENV_FILE" ]; then
        fail "cannot read $ENV_FILE"
    fi

    bucket="${BACKUP_BUCKET:-$(env_value BACKUP_BUCKET)}"
    if [ -z "$bucket" ]; then
        fail "BACKUP_BUCKET is set neither in the environment nor in $ENV_FILE"
    fi

    if ! production_db="$(compose exec -T postgres printenv POSTGRES_DB | tr -d '\r')"; then
        fail "cannot read POSTGRES_DB from the postgres container; is the stack up?"
    fi

    if [ "$SCRATCH_DB" = "$production_db" ]; then
        fail "refusing to run: the scratch database is '$SCRATCH_DB', which is the production database. This script drops and recreates its target."
    fi

    if [ "$#" -gt 0 ]; then
        key="$1"
    elif ! key="$(latest_key "$bucket")"; then
        fail "listing s3://$bucket/$S3_PREFIX/ failed"
    fi

    if [ -z "$key" ] || [ "$key" = "None" ]; then
        fail "no dump found under s3://$bucket/$S3_PREFIX/"
    fi

    workdir="$(mktemp -d)"
    trap cleanup EXIT
    dump="$workdir/restore.dump"

    if ! aws s3 cp "s3://$bucket/$key" "$dump" --only-show-errors; then
        fail "download of s3://$bucket/$key failed"
    fi

    psql_exec postgres "DROP DATABASE IF EXISTS \"$SCRATCH_DB\" WITH (FORCE)" >/dev/null
    psql_exec postgres "CREATE DATABASE \"$SCRATCH_DB\"" >/dev/null

    # `exec -T` is required: without it this fails with "the input device is not a TTY", and here
    # it is also what lets the dump be piped into the container's pg_restore over stdin.
    if ! compose exec -T postgres sh -c "$(restore_script)" sh "$SCRATCH_DB" <"$dump"; then
        fail "pg_restore of s3://$bucket/$key into $SCRATCH_DB failed; the scratch database is left in place for inspection"
    fi

    echo "restore-test.sh: restored s3://$bucket/$key into $SCRATCH_DB on $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    print_row_counts

    if [ "$non_empty_tables" -lt "$MIN_NON_EMPTY_TABLES" ]; then
        fail "only $non_empty_tables of ${#COUNTED_TABLES[@]} counted tables have rows, fewer than the $MIN_NON_EMPTY_TABLES required: a pg_restore of an empty dump also exits 0. The scratch database is left in place for inspection."
    fi

    psql_exec postgres "DROP DATABASE IF EXISTS \"$SCRATCH_DB\" WITH (FORCE)" >/dev/null
    echo "restore-test.sh: $non_empty_tables of ${#COUNTED_TABLES[@]} counted tables are non-empty; scratch database $SCRATCH_DB dropped"
}

print_row_counts() {
    local present table count

    present="$(psql_exec "$SCRATCH_DB" "SELECT tablename FROM pg_tables WHERE schemaname = 'public'")"

    printf '  %-16s %s\n' "TABLE" "ROWS"
    for table in "${COUNTED_TABLES[@]}"; do
        if ! grep -qx "$table" <<<"$present"; then
            printf '  %-16s %s\n' "$table" "MISSING"
            continue
        fi

        count="$(psql_exec "$SCRATCH_DB" "SELECT count(*) FROM public.$table")"
        printf '  %-16s %s\n' "$table" "$count"

        if [ "$count" -gt 0 ]; then
            non_empty_tables=$((non_empty_tables + 1))
        fi
    done
}

latest_key() {
    aws s3api list-objects-v2 \
        --bucket "$1" \
        --prefix "$S3_PREFIX/" \
        --query "sort_by(Contents, &Key)[-1].Key" \
        --output text
}

psql_exec() {
    compose exec -T postgres sh -c "$(psql_script)" sh "$1" "$2"
}

# The container's own shell expands the password from the container's own environment, so the
# secret never reaches a host command line, where `ps` would expose it to every local user.
restore_script() {
    cat <<'SCRIPT'
PGPASSWORD="$POSTGRES_PASSWORD" exec pg_restore --exit-on-error --no-owner --no-privileges \
    -U "$POSTGRES_USER" -d "$1"
SCRIPT
}

psql_script() {
    cat <<'SCRIPT'
PGPASSWORD="$POSTGRES_PASSWORD" exec psql -v ON_ERROR_STOP=1 -qtAX -U "$POSTGRES_USER" -d "$1" -c "$2"
SCRIPT
}

compose() {
    docker compose \
        -f "$TUTORLINK_ROOT/docker-compose.yml" \
        -f "$TUTORLINK_ROOT/docker-compose.prod.yml" \
        --env-file "$ENV_FILE" \
        "$@"
}

env_value() {
    sed -n "s/^[[:space:]]*$1=//p" "$ENV_FILE" |
        tail -n 1 |
        sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

fail() {
    echo "restore-test.sh: FAILED: $1" >&2
    exit 1
}

cleanup() {
    if [ -n "$workdir" ]; then
        rm -rf "$workdir"
    fi
}

main "$@"
