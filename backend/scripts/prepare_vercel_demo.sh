#!/usr/bin/env bash

# One-time setup for the isolated Neon demo database. Never use a VPS URL here.
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
env_file="$repo_root/.env.neon-demo.local"

if [[ ! -e "$env_file" && ! -L "$env_file" ]]; then
  (
    umask 077
    set -C
    cat > "$env_file" <<'EOF'
# Literal KEY=VALUE lines; do not add shell quotes or spaces around =.
POSTGRES_URL=
FIRST_SUPERUSER_PASSWORD=
DEMO_USER_PASSWORD=
EOF
  )
  printf 'Created %s (mode 600). Fill it in and run this script again.\n' "$env_file"
  exit 0
fi

if ! command -v uv >/dev/null 2>&1; then
  printf 'uv is required to run the backend commands.\n' >&2
  exit 1
fi

# Keep the caller's stdin on fd 3; stdin itself carries the Python program.
python3 - "$env_file" "$repo_root/backend" 3<&0 <<'PY'
import os
import secrets
import stat
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

env_file = Path(sys.argv[1])
backend_dir = Path(sys.argv[2])
required = {"POSTGRES_URL", "FIRST_SUPERUSER_PASSWORD", "DEMO_USER_PASSWORD"}

if env_file.is_symlink() or not env_file.is_file():
    raise SystemExit("Expected a regular, non-symlink .env.neon-demo.local file.")
if stat.S_IMODE(env_file.stat().st_mode) & 0o077:
    raise SystemExit("The env file is accessible to others. Run chmod 600 .env.neon-demo.local.")

values = {}
for line_number, line in enumerate(env_file.read_text(encoding="utf-8").splitlines(), 1):
    if not line or line.startswith("#"):
        continue
    key, separator, value = line.partition("=")
    if not separator or key not in required or key in values:
        raise SystemExit(f"Invalid or duplicate key at line {line_number}.")
    values[key] = value
if set(values) != required or any(not value for value in values.values()):
    raise SystemExit("Fill all three values in .env.neon-demo.local before running setup.")
for key in ("FIRST_SUPERUSER_PASSWORD", "DEMO_USER_PASSWORD"):
    if not 8 <= len(values[key]) <= 128:
        raise SystemExit(
            f"{key} must contain 8 to 128 characters. No database operation was started."
        )

try:
    url = urlsplit(values["POSTGRES_URL"])
    host = url.hostname or ""
except ValueError:
    raise SystemExit("Invalid Neon URL. No database operation was started.") from None
database = url.path.lstrip("/")
if (
    url.scheme not in {"postgres", "postgresql", "postgresql+psycopg"}
    or not host.endswith(".neon.tech")
    or "-pooler" in host.split(".")[0]
    or not url.username
    or not url.password
    or not database
):
    raise SystemExit(
        "Expected a complete, unpooled Neon PostgreSQL URL. No database operation was started."
    )

print(f"Target: {host}/{database}")
print("This will migrate the database, set up the demo admin, and replace any existing demo ledger.")
print("Confirm this is the oblidog-demo database by typing oblidog-demo: ", end="", flush=True)
with os.fdopen(3) as confirmation_input:
    confirmation = confirmation_input.readline().rstrip("\r\n")
if confirmation != "oblidog-demo":
    raise SystemExit("Cancelled. No database operation was started.")

environment = os.environ.copy()
environment.pop("UV_ENV_FILE", None)
environment.update(values)
environment.update(
    PROJECT_NAME="Oblidog Demo",
    ENVIRONMENT="demo",
    FIRST_SUPERUSER="demo-admin@oblidog.com",
    # This key is only for these local processes; Vercel keeps its own SECRET_KEY.
    SECRET_KEY=secrets.token_urlsafe(32),
)
for command in (
    ("alembic", "upgrade", "head"),
    ("python", "-m", "app.initial_data"),
    ("python", "-m", "app.demo_seed"),
):
    subprocess.run(["uv", "run", "--locked", *command], cwd=backend_dir, env=environment, check=True)
print("Demo database setup completed.")
PY
