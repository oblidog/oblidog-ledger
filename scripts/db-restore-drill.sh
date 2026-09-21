#!/usr/bin/env bash
set -Eeuo pipefail

POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:18}"
BACKEND_IMAGE=""
DUMP_FILE=""

usage() {
  cat <<'EOF'
Usage: db-restore-drill.sh --dump FILE --backend-image IMAGE

Restores FILE into a disposable PostgreSQL container, validates representative
Oblidog data, upgrades the restored schema with IMAGE, and validates it again.
No host port is published and no existing database is contacted.
EOF
}

fail() {
  printf '[db-restore-drill] ERROR: %s\n' "$*" >&2
  exit 1
}

while (($#)); do
  case "$1" in
    --dump)
      [[ $# -ge 2 ]] || fail "--dump requires a value"
      DUMP_FILE="$2"
      shift 2
      ;;
    --backend-image)
      [[ $# -ge 2 ]] || fail "--backend-image requires a value"
      BACKEND_IMAGE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

command -v docker >/dev/null 2>&1 || fail "Docker is required"
[[ -n "$DUMP_FILE" ]] || fail "--dump is required"
[[ -f "$DUMP_FILE" ]] || fail "Dump not found: $DUMP_FILE"
[[ -n "$BACKEND_IMAGE" ]] || fail "--backend-image is required"

DUMP_FILE="$(cd "$(dirname "$DUMP_FILE")" && pwd)/$(basename "$DUMP_FILE")"
suffix="${RANDOM}-$$"
network="oblidog-restore-drill-${suffix}"
database_container="oblidog-restore-drill-db-${suffix}"
password="restore-drill-${suffix}"

cleanup() {
  docker rm -f "$database_container" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

validate_data() {
  local phase="$1"
  printf '[db-restore-drill] Validating representative data (%s)...\n' "$phase"
  docker exec -i \
    --env PGPASSWORD="$password" \
    "$database_container" \
    psql --username oblidog --dbname oblidog_restore_drill --set ON_ERROR_STOP=1 <<'SQL'
DO $$
DECLARE
  table_name text;
  row_count bigint;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'user', 'ledger', 'obligation', 'obligation_component', 'category_data'
  ] LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      RAISE EXCEPTION 'required table % is missing', table_name;
    END IF;
    EXECUTE format('SELECT count(*) FROM %I', table_name) INTO row_count;
    IF row_count = 0 THEN
      RAISE EXCEPTION 'required representative table % is empty', table_name;
    END IF;
  END LOOP;

  IF to_regclass('public.ledger_membership') IS NULL THEN
    RAISE EXCEPTION 'access configuration table ledger_membership is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM alembic_version) THEN
    RAISE EXCEPTION 'alembic_version is empty';
  END IF;
END $$;
SQL
}

docker network create "$network" >/dev/null
docker run -d --name "$database_container" --network "$network" \
  --env POSTGRES_DB=oblidog_restore_drill \
  --env POSTGRES_USER=oblidog \
  --env POSTGRES_PASSWORD="$password" \
  "$POSTGRES_IMAGE" >/dev/null

printf '[db-restore-drill] Waiting for disposable PostgreSQL...\n'
for _ in {1..60}; do
  if docker exec "$database_container" pg_isready -U oblidog -d oblidog_restore_drill >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$database_container" pg_isready -U oblidog -d oblidog_restore_drill >/dev/null \
  || fail "Disposable PostgreSQL did not become ready"

printf '[db-restore-drill] Restoring backup into isolated database...\n'
docker run --rm --network "$network" \
  --env PGPASSWORD="$password" \
  --volume "$DUMP_FILE:/backup/oblidog.dump:ro" \
  "$POSTGRES_IMAGE" \
  pg_restore \
    --host "$database_container" \
    --username oblidog \
    --dbname oblidog_restore_drill \
    --no-owner \
    --no-acl \
    --exit-on-error \
    /backup/oblidog.dump

validate_data restored

printf '[db-restore-drill] Upgrading restored schema with %s...\n' "$BACKEND_IMAGE"
docker run --rm --network "$network" \
  --env PROJECT_NAME=Oblidog \
  --env FIRST_SUPERUSER=restore-drill@example.com \
  --env FIRST_SUPERUSER_PASSWORD=restore-drill-password \
  --env POSTGRES_SERVER="$database_container" \
  --env POSTGRES_PORT=5432 \
  --env POSTGRES_DB=oblidog_restore_drill \
  --env POSTGRES_USER=oblidog \
  --env POSTGRES_PASSWORD="$password" \
  "$BACKEND_IMAGE" \
  alembic upgrade head

validate_data upgraded
printf '[db-restore-drill] Restore and upgrade drill passed.\n'
