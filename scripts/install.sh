#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${OBLIDOG_INSTALL_BASE_URL:-https://raw.githubusercontent.com/oblidog/oblidog-ledger/main}"
variant="${1:-standalone}"
variant_file=".oblidog-deployment-variant"

if [[ -f "$variant_file" ]]; then
  installed_variant="$(<"$variant_file")"
  if [[ "$installed_variant" != "$variant" ]]; then
    echo "This directory contains an '$installed_variant' deployment." >&2
    echo "Refusing to replace it with '$variant'. Use a new directory to change variants." >&2
    exit 1
  fi
elif [[ $# -eq 0 && ( -f .env || -f compose.yml ) ]]; then
  echo "Existing deployment files found, but their variant is unknown." >&2
  echo "Re-run with an explicit matching variant: standalone or external." >&2
  exit 1
fi

case "$variant" in
  standalone)
    compose_source="compose.standalone.yml"
    env_source=".env.standalone.example"
    ;;
  external)
    compose_source="compose.production.yml"
    env_source=".env.production.example"
    ;;
  *)
    echo "Usage: install.sh [standalone|external]" >&2
    exit 2
    ;;
esac

curl -fsSL "$BASE_URL/$compose_source" -o compose.yml
curl -fsSL "$BASE_URL/scripts/validate-deployment.sh" -o validate-deployment.sh
chmod +x validate-deployment.sh
printf '%s\n' "$variant" > "$variant_file"

if [ ! -f .env ]; then
  curl -fsSL "$BASE_URL/$env_source" -o .env
  echo "Created .env from $variant template."
else
  echo ".env already exists; leaving it unchanged."
fi

echo
printf '%s\n' \
  "Oblidog Ledger deployment files are ready." \
  "" \
  "Next steps:" \
  "  1. Edit .env" \
  "  2. ./validate-deployment.sh $variant" \
  "  3. docker compose pull" \
  "  4. docker compose up -d"
