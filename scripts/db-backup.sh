#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${ENV_FILE:-.env}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:18}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.yml}"
DEPLOYMENT_VARIANT="${DEPLOYMENT_VARIANT:-}"

fail() {
  printf '[db-backup] ERROR: %s\n' "$*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "Docker is required"
[[ -f "$ENV_FILE" ]] || fail "Environment file not found: $ENV_FILE"

if [[ -z "$DEPLOYMENT_VARIANT" && -f .oblidog-deployment-variant ]]; then
  DEPLOYMENT_VARIANT="$(<.oblidog-deployment-variant)"
fi
DEPLOYMENT_VARIANT="${DEPLOYMENT_VARIANT:-external}"
[[ "$DEPLOYMENT_VARIANT" == "external" || "$DEPLOYMENT_VARIANT" == "standalone" ]] \
  || fail "DEPLOYMENT_VARIANT must be external or standalone"

for name in POSTGRES_SERVER POSTGRES_PORT POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD; do
  value="$(sed -n "s/^${name}=//p" "$ENV_FILE" | tail -n 1)"
  [[ -n "$value" ]] || fail "$name is missing in $ENV_FILE"
  printf -v "$name" '%s' "$value"
done

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
tag="$(sed -n 's/^TAG=//p' "$ENV_FILE" | tail -n 1)"
mkdir -p "$BACKUP_DIR"
backup_dir_abs="$(cd "$BACKUP_DIR" && pwd)"
backup_path="${backup_dir_abs}/oblidog-${POSTGRES_DB}-${timestamp}.dump"
metadata_path="${backup_path}.metadata"

printf '[db-backup] Creating %s\n' "$backup_path"
if [[ "$DEPLOYMENT_VARIANT" == "standalone" ]]; then
  [[ -f "$COMPOSE_FILE" ]] || fail "Compose file not found: $COMPOSE_FILE"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db \
    pg_dump \
      --username "$POSTGRES_USER" \
      --dbname "$POSTGRES_DB" \
      --format custom \
      --no-owner \
      --no-acl \
    >"$backup_path"
  schema_version="$(
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T db \
      psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
        --no-align --tuples-only --command 'SELECT version_num FROM alembic_version' \
      | tr -d '[:space:]'
  )"
else
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    --env PGPASSWORD="$POSTGRES_PASSWORD" \
    --volume "$backup_dir_abs:/backup" \
    "$POSTGRES_IMAGE" \
    pg_dump \
      --host "$POSTGRES_SERVER" \
      --port "$POSTGRES_PORT" \
      --username "$POSTGRES_USER" \
      --dbname "$POSTGRES_DB" \
      --format custom \
      --no-owner \
      --no-acl \
      --file "/backup/$(basename "$backup_path")"
  schema_version="$(
    docker run --rm \
      --env PGPASSWORD="$POSTGRES_PASSWORD" \
      "$POSTGRES_IMAGE" \
      psql \
        --host "$POSTGRES_SERVER" \
        --port "$POSTGRES_PORT" \
        --username "$POSTGRES_USER" \
        --dbname "$POSTGRES_DB" \
        --no-align --tuples-only \
        --command 'SELECT version_num FROM alembic_version' \
      | tr -d '[:space:]'
  )"
fi

cat >"$metadata_path" <<EOF
created_at_utc=$timestamp
application_tag=${tag:-unknown}
alembic_revision=${schema_version:-unknown}
database_name=$POSTGRES_DB
postgres_image=$POSTGRES_IMAGE
deployment_variant=$DEPLOYMENT_VARIANT
EOF
chmod 600 "$backup_path" "$metadata_path"

printf '[db-backup] Backup complete: %s\n' "$backup_path"
printf '[db-backup] Metadata: %s\n' "$metadata_path"
