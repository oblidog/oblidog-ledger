#!/usr/bin/env bash

# One-time setup for the isolated Neon demo database. Never use a VPS URL here.
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

if ! command -v uv >/dev/null 2>&1; then
  printf 'uv is required to run the backend commands.\n' >&2
  exit 1
fi

printf 'Use the unpooled connection string from the oblidog-demo Neon project.\n'
IFS= read -r -s -p 'Neon unpooled URL: ' POSTGRES_URL
printf '\n'
IFS= read -r -s -p 'Preview FIRST_SUPERUSER_PASSWORD: ' FIRST_SUPERUSER_PASSWORD
printf '\n'
IFS= read -r -s -p 'Preview DEMO_USER_PASSWORD: ' DEMO_USER_PASSWORD
printf '\n'

if [[ -z "$POSTGRES_URL" || -z "$FIRST_SUPERUSER_PASSWORD" || -z "$DEMO_USER_PASSWORD" ]]; then
  printf 'All three inputs are required. No database operation was started.\n' >&2
  exit 1
fi

export POSTGRES_URL FIRST_SUPERUSER_PASSWORD DEMO_USER_PASSWORD
export PROJECT_NAME='Oblidog Demo' ENVIRONMENT='demo'
export FIRST_SUPERUSER='demo-admin@oblidog.com'
# Only the one-time local processes use this key; Vercel keeps its own SECRET_KEY.
export SECRET_KEY="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"

python3 - <<'PY'
import os
from urllib.parse import urlsplit

url = urlsplit(os.environ['POSTGRES_URL'])
host = url.hostname or ''
database = url.path.lstrip('/')
if (
    url.scheme not in {'postgres', 'postgresql', 'postgresql+psycopg'}
    or not host.endswith('.neon.tech')
    or '-pooler' in host.split('.')[0]
    or not url.username
    or not url.password
    or not database
):
    raise SystemExit('Expected a complete, unpooled Neon PostgreSQL URL. No database operation was started.')

print(f'Target: {host}/{database}')
PY

printf 'This will migrate the database, set up the demo admin, and replace any existing demo ledger.\n'
IFS= read -r -p 'Confirm this is the oblidog-demo database by typing oblidog-demo: ' confirmation
if [[ "$confirmation" != 'oblidog-demo' ]]; then
  printf 'Cancelled. No database operation was started.\n' >&2
  exit 1
fi

uv run --locked alembic upgrade head
uv run --locked python -m app.initial_data
uv run --locked python -m app.demo_seed
printf 'Demo database setup completed.\n'
