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
| `FRONTEND_HOST` | Exact frontend Preview origin, once it exists |

Neon supplies `POSTGRES_URL` for this environment. Do not put the URL or any
password in Git, build logs, or a frontend variable. `DEMO_USER_PASSWORD` is
needed for the optional sample dataset. The current `public-config` endpoint
returns that demo password to the browser, so it must be a **dedicated disposable
password**, never reused by another account. Protected Preview still requires
Vercel Authentication before a visitor reaches the app.

Changes to Vercel environment variables require a new Preview deployment.
The FastAPI function does not run migrations or seed data on startup.

## One-time database setup

Run these commands once from a trusted environment with the Preview database
URL and the backend variables above available to the process:

```sh
cd backend
uv run alembic upgrade head
uv run python -m app.initial_data
uv run python -m app.demo_seed
```

The last command needs `DEMO_USER_PASSWORD`. It replaces the demo user's
existing sample ledger, so it is an explicit maintenance operation, not part
of a deployment or function startup. Use the Neon **unpooled** URL for schema
migrations if possible; the runtime can retain Neon's pooled `POSTGRES_URL`.
Never point these commands at the private VPS database.

## Verification still required for #274

- After redeploy, check `/api/v1/utils/health-check/` and
  `/api/v1/utils/readiness-check/` on the protected backend Preview URL.
- Deploy the Vite frontend to a separate protected Preview project and set its
  `VITE_API_URL` to the backend Preview origin at build time, or use a same-origin
  `/api/*` rewrite. Verify deep links reload successfully.
- From the frontend origin, check `public-config`, a credentialed login, and an
  authenticated read. Set `FRONTEND_HOST` to that origin; cross-origin cookie
  behavior and Vercel Authentication need browser verification before claiming
  the frontend PoC is complete.
- Do not connect the demo database to Production or publish the final domain as
  part of this PoC.
