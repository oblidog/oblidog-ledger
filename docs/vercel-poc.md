# Vercel proof of concept (#274)

The FastAPI project on Vercel uses `backend/` as its root directory. The
`oblidog-demo` Neon database is connected to **Preview only**. The existing
self-hosted deployment continues to use `POSTGRES_SERVER`, `POSTGRES_USER`,
`POSTGRES_PASSWORD`, and `POSTGRES_DB`. When Neon supplies `POSTGRES_URL`, the
backend uses that complete URL (including TLS options) with the psycopg driver.

## Preview configuration

Set these backend variables in the Vercel **Preview** environment:

| Name | Purpose |
| --- | --- |
| `PROJECT_NAME` | Display name, e.g. `Oblidog Demo` |
| `ENVIRONMENT` | `demo`, to disable external services and sensitive operations |
| `SECRET_KEY` | Stable, randomly generated JWT signing key; keep private |
| `FIRST_SUPERUSER` | Dedicated demo admin email, never a real account |
| `FIRST_SUPERUSER_PASSWORD` | Strong, private password for that admin |
| `SESSION_COOKIE_SECURE` | `true` for HTTPS |
| `SESSION_COOKIE_SAMESITE` | `none` for the cross-site frontend/backend session |
| `FRONTEND_HOST` | `https://oblidog-ledger-frontend-git-dev-oblidog.vercel.app` |

Neon supplies `POSTGRES_URL` for this environment. Do not put the URL or any
password in Git, build logs, or a frontend variable. `DEMO_USER_PASSWORD` is
needed for the optional sample dataset. The current `public-config` endpoint
returns that demo password to the browser, so it must be a **dedicated disposable
password**, never reused by another account. The frontend Preview uses
`frontend/` as its root directory, the Vite preset, and Preview-only
`VITE_API_URL=https://project-gs28u-git-dev-oblidog.vercel.app`.

The backend `project-gs28u-git-dev-oblidog.vercel.app` branch alias has a
Deployment Protection Exception. That alias is **publicly accessible**, while
other protected backend deployment URLs retain their protection. Vercel
Authentication intercepted cross-origin browser API requests with `302`/`401`
responses lacking CORS headers. An OPTIONS allowlist alone cannot fix the
blocked GET and POST requests. The frontend branch URL may remain protected by
Vercel Authentication; the demo API and disposable demo credentials are public.
Keep the database isolated and do not reuse any demo password.

Changes to Vercel environment variables require a new Preview deployment.
The FastAPI function does not run migrations or seed data on startup.

## One-time database setup

On a trusted machine with Bash, Python 3 and `uv`, check out the PoC branch and
run the helper from the repository root:

```sh
bash backend/scripts/prepare_vercel_demo.sh
```

The first run creates `.env.neon-demo.local` in the repository root with mode
600. Fill in its three `KEY=VALUE` lines without shell quotes; this file is
Git-ignored. On later runs, the helper reuses those values, so a failed migration
does not require re-entering them. Keep this file on your trusted machine and
do not share it or paste its contents into an issue.

In the Vercel project, open Storage -> `oblidog-demo` -> Open in Neon Console.
Copy its connection string from **Connect** with **Connection pooling disabled**.
Use the exact admin and demo passwords stored for Preview. The helper accepts
only a direct `*.neon.tech` URL, checks that both passwords have 8 to 128
characters, checks file permissions, displays the target
host and database, and requires confirmation before writing. The local
`SECRET_KEY` is temporary; the Vercel value stays unchanged. The script runs
Alembic, initial admin setup, then the demo seed. The seed replaces the demo
user's existing sample ledger, so run this only for intentional setup or
refresh. Verify that the displayed target belongs to `oblidog-demo`; the URL
alone cannot prove the Neon project name. Never use the private VPS database.

## Observed PoC result (2026-09-24)

- The backend Preview served `/api/v1/utils/health-check/` and
  `/api/v1/utils/readiness-check/` (`true`); Swagger login and
  `GET /api/v1/ledgers/` returned one `Oblidog Demo` ledger.
- The Vite frontend Preview served `/login` on Vercel. From the frontend `dev`
  branch alias, browser login succeeded, the authenticated ledger loaded, and
  sample obligations were visible with the public demo banner. This verifies
  the frontend API URL, CORS, session cookie, and authenticated read in the
  tested browser.
- The demo database migrations, initial admin setup, and seed were run with
  the one-time helper against the dedicated Neon project. These operations do
  not run in a Vercel Function at startup. Periodic reset and production
  controls belong to later demo issues.
- The cross-origin request to a Vercel-authenticated backend Preview was the
  deployment blocker. The branch-domain protection exception resolves this
  for the PoC but makes that backend alias publicly reachable. Preserve this
  constraint when designing the final public demo. No Production database
  connection or final demo domain was configured for this PoC.
