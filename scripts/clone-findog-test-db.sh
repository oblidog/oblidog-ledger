#!/usr/bin/env bash
# Replace a target PostgreSQL database with a complete dump from a source database.
#
# Required environment variables:
#   SOURCE_DATABASE_URL       Read-capable URL of the source database.
#   TARGET_ADMIN_DATABASE_URL Admin URL to the target cluster's `postgres` DB.
#   TARGET_DATABASE_NAME      Exact target database to replace.
#   TARGET_DATABASE_OWNER     Owner of the recreated database.
#
# The admin role must be allowed to terminate sessions and create/drop the target.

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  set -a
  source ./scripts/clone-database.env
  set +a
  ./scripts/clone-findog-test-db.sh --confirm-replace-database "$TARGET_DATABASE_NAME"

This permanently drops and recreates TARGET_DATABASE_NAME on the cluster addressed
by TARGET_ADMIN_DATABASE_URL, then restores a full dump from SOURCE_DATABASE_URL.
EOF
}

if [[ "${1:-}" != "--confirm-replace-database" || $# -ne 2 ]]; then
  usage >&2
  exit 2
fi

strip_outer_quotes() {
  local value="$1"
  if [[ ("$value" == \"*\" && "$value" == *\") || ("$value" == \'*\' && "$value" == *\') ]]; then
    value="${value:1:-1}"
  fi
  printf '%s' "$value"
}

: "${SOURCE_DATABASE_URL:?Set SOURCE_DATABASE_URL to the production source database URL.}"
: "${TARGET_ADMIN_DATABASE_URL:?Set TARGET_ADMIN_DATABASE_URL to an administrative postgres URL.}"
TARGET_DATABASE_NAME="${TARGET_DATABASE_NAME:-${POSTGRES_DB:-}}"
TARGET_DATABASE_OWNER="${TARGET_DATABASE_OWNER:-${POSTGRES_USER:-}}"
: "${TARGET_DATABASE_NAME:?Set TARGET_DATABASE_NAME (or POSTGRES_DB) to the database that may be replaced.}"
: "${TARGET_DATABASE_OWNER:?Set TARGET_DATABASE_OWNER (or POSTGRES_USER) to the owner of the recreated database.}"

target_database="$(strip_outer_quotes "$TARGET_DATABASE_NAME")"
target_owner="$(strip_outer_quotes "$TARGET_DATABASE_OWNER")"
source_database_url="$(strip_outer_quotes "$SOURCE_DATABASE_URL")"
target_admin_database_url="$(strip_outer_quotes "$TARGET_ADMIN_DATABASE_URL")"
if [[ "$2" != "$target_database" ]]; then
  echo "Confirmation database name does not match TARGET_DATABASE_NAME." >&2
  exit 2
fi

for command in pg_dump pg_restore dropdb createdb; do
  command -v "$command" >/dev/null || {
    echo "Required PostgreSQL command is unavailable: $command" >&2
    exit 1
  }
done

target_admin_base="${target_admin_database_url%%\?*}"
target_admin_query=""
if [[ "$target_admin_database_url" == *\?* ]]; then
  target_admin_query="?${target_admin_database_url#*\?}"
fi
if [[ "$target_admin_base" != */postgres ]]; then
  echo "TARGET_ADMIN_DATABASE_URL must point to the administrative postgres database." >&2
  exit 2
fi

dump_file="$(mktemp -t findog-production-snapshot.XXXXXX.dump)"
cleanup() {
  rm -f "$dump_file"
}
trap cleanup EXIT

echo "Creating a consistent dump of the source database…"
pg_dump --format=custom --no-owner --no-privileges \
  --file "$dump_file" "$source_database_url"

echo "Dropping ${target_database} on the target cluster…"
dropdb --if-exists --force --maintenance-db="$target_admin_database_url" "$target_database"

echo "Creating ${target_database} on the target cluster…"
createdb --maintenance-db="$target_admin_database_url" \
  --owner="$target_owner" "$target_database"

# pg_restore accepts a database URL, including the desired target database.
target_database_url="${target_admin_base%/postgres}/${target_database}${target_admin_query}"

echo "Restoring the source snapshot into ${target_database}…"
pg_restore --exit-on-error --no-owner --no-privileges \
  --role="$target_owner" \
  --dbname="$target_database_url" "$dump_file"

echo "Clone complete: ${target_database} now matches the source dump."
