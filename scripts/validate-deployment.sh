#!/usr/bin/env bash
set -euo pipefail

variant="${1:-standalone}"

case "$variant" in
  standalone)
    compose_file="compose.standalone.yml"
    env_example=".env.standalone.example"
    ;;
  external)
    compose_file="compose.production.yml"
    env_example=".env.production.example"
    ;;
  *)
    echo "Usage: $0 [standalone|external]" >&2
    exit 2
    ;;
esac

if [[ ! -f .env ]]; then
  echo "Missing .env. Copy $env_example to .env and replace its placeholder secrets." >&2
  exit 1
fi

required=(TAG SECRET_KEY FIRST_SUPERUSER FIRST_SUPERUSER_PASSWORD POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD)
if [[ "$variant" == "external" ]]; then
  required+=(POSTGRES_SERVER POSTGRES_PORT)
fi

for variable in "${required[@]}"; do
  value="$(sed -n "s/^${variable}=//p" .env | tail -n 1)"
  if [[ -z "$value" ]]; then
    echo "Missing required value: $variable" >&2
    exit 1
  fi
  if [[ "$value" == replace-with-* || "$value" == *.example.com ]]; then
    echo "Replace the example value for $variable before starting." >&2
    exit 1
  fi
done

tag="$(sed -n 's/^TAG=//p' .env | tail -n 1)"
if [[ ! "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "TAG must be an immutable release tag such as v0.15.0 (not '$tag')." >&2
  exit 1
fi

docker compose --env-file .env -f "$compose_file" config --quiet
echo "$variant deployment configuration is valid."
