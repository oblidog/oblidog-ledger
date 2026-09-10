#!/usr/bin/env bash
set -Eeuo pipefail

REPO="${REPO:-oblidog/oblidog-ledger}"
ENV_FILE="${ENV_FILE:-.env}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.production.yml}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"

log() {
  printf '[deploy] %s\n' "$*"
}

fail() {
  printf '[deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

read_tag() {
  local file="$1"
  sed -n 's/^TAG=//p' "$file" | tail -n 1
}

write_tag() {
  local file="$1"
  local tag="$2"
  local tmp

  tmp="$(mktemp "${file}.XXXXXX")"

  awk -v tag="$tag" '
    BEGIN { updated = 0 }
    /^TAG=/ && !updated {
      print "TAG=" tag
      updated = 1
      next
    }
    { print }
    END {
      if (!updated) {
        print "TAG=" tag
      }
    }
  ' "$file" >"$tmp"

  chmod --reference="$file" "$tmp" 2>/dev/null || true
  mv "$tmp" "$file"
}

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

wait_for_backend_health() {
  local deadline container_id status
  deadline=$((SECONDS + HEALTH_TIMEOUT))

  while (( SECONDS < deadline )); do
    container_id="$(compose ps -q backend 2>/dev/null || true)"

    if [[ -n "$container_id" ]]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"

      case "$status" in
        healthy)
          log "Backend is healthy."
          return 0
          ;;
        unhealthy|exited|dead)
          fail "Backend entered state: $status"
          ;;
      esac
    fi

    sleep 2
  done

  fail "Backend did not become healthy within ${HEALTH_TIMEOUT}s"
}

require_command curl
require_command jq
require_command docker

[[ -f "$ENV_FILE" ]] || fail "Environment file not found: $ENV_FILE"
[[ -f "$COMPOSE_FILE" ]] || fail "Compose file not found: $COMPOSE_FILE"
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required"

current_tag="$(read_tag "$ENV_FILE")"
[[ -n "$current_tag" ]] || fail "TAG is missing in $ENV_FILE"

log "Current version: $current_tag"
log "Checking latest GitHub release for $REPO..."

latest_tag="$(
  curl --fail --silent --show-error \
    -H 'Accept: application/vnd.github+json' \
    -H 'X-GitHub-Api-Version: 2022-11-28' \
    "https://api.github.com/repos/${REPO}/releases/latest" \
  | jq -er '.tag_name'
)"

[[ "$latest_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] \
  || fail "Unexpected release tag returned by GitHub: $latest_tag"

log "Latest release: $latest_tag"

if [[ "$current_tag" == "$latest_tag" ]]; then
  log "Already up to date. Nothing to deploy."
  exit 0
fi

backup_file="$(mktemp "${ENV_FILE}.backup.XXXXXX")"
cp -p "$ENV_FILE" "$backup_file"

rollback() {
  local exit_code=$?
  trap - ERR

  printf '[deploy] Deployment failed. Restoring TAG=%s and attempting container rollback...\n' "$current_tag" >&2
  cp -p "$backup_file" "$ENV_FILE"

  if compose pull && compose up -d --remove-orphans; then
    printf '[deploy] Containers restored to %s. Database migrations are not automatically rolled back.\n' "$current_tag" >&2
  else
    printf '[deploy] ERROR: automatic container rollback failed. Manual intervention required.\n' >&2
  fi

  rm -f "$backup_file"
  exit "$exit_code"
}

trap rollback ERR

log "Switching $ENV_FILE to $latest_tag..."
write_tag "$ENV_FILE" "$latest_tag"

log "Pulling release images..."
compose pull

log "Recreating production containers..."
compose up -d --remove-orphans

log "Waiting for backend health check..."
wait_for_backend_health

trap - ERR
rm -f "$backup_file"

log "Deployment completed: $current_tag -> $latest_tag"
