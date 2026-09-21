#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${OBLIDOG_INSTALL_BASE_URL:-https://raw.githubusercontent.com/oblidog/oblidog-ledger/main}"
variant="${1:-standalone}"

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
