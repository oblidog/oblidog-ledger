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

## Demo database deployment lifecycle (#276)

After the backend `dev` Preview deployment succeeds, open GitHub Actions ->
**Demo Database Lifecycle** -> **Run workflow**, select branch `dev`, and choose:

| Action | Effect |
| --- | --- |
| `migrate` (default) | Run `alembic upgrade head` for a normal update; keep existing demo data. |
| `initialize` | Run migrations, create/update the dedicated demo admin, and run the canonical `app.demo_seed` entry point. This replaces the demo user's ledger. Enter `replace-demo-ledger` in the confirmation field. |

The workflow file must also exist on the default `main` branch for GitHub to
show the manual trigger; the database job itself is restricted to `dev`.

Create the GitHub Actions environment `demo-preview` and add these **environment
secrets** (not repository secrets): `DEMO_POSTGRES_URL` (the direct, unpooled
connection URL for the isolated Neon database), `DEMO_NEON_HOST` (its exact
unpooled hostname, entered separately), `DEMO_FIRST_SUPERUSER_PASSWORD`, and
`DEMO_USER_PASSWORD`. Use the same admin and disposable demo passwords as
backend Vercel Preview. Keep the dedicated demo superuser. Do not put the URL or
passwords in workflow inputs or Git. Restrict who can administer this GitHub
environment and, if available on your plan, require approval for its jobs.

The workflow accepts only the `dev` ref. Its runner checks that the URL points
to the exact independently configured unpooled Neon host and `neondb` database
before running any database command, and forces `ENVIRONMENT=demo`. It never
copies the production VPS connection. Steps fail the job if Alembic, admin setup,
or seeding fails;
inspect the failed step's logs and rerun the workflow after fixing the cause.
No password or complete URL is printed. The generated signing key applies only
to the short-lived runner process, not to Vercel.

Vercel's Git integration deploys the code on `dev`; this manual database job is
the deliberate follow-up to a successful backend Preview deployment. For a
schema change that is incompatible with the currently deployed backend, plan
the migration and deployment ordering before merging. Seeding is never part of
normal deploys or function startup. Periodic reset remains tracked in #278.

## Demo reset (#278)

The backend has a hidden `GET /api/v1/demo/reset` operator endpoint. Configure
`CRON_SECRET` (a unique random value of at least 16 characters) and
`DEMO_NEON_HOST` (the exact **unpooled** Neon hostname) in backend Vercel
**Preview**. Keep both values on the server; never put them in a Vite variable.
Redeploy Preview after changing environment variables. The endpoint returns
404 outside `ENVIRONMENT=demo`, 401 for missing/incorrect authorization, 503
for missing configuration or an unexpected database target, and 409 when
another reset is already running. It never applies migrations. A failed seed
returns 500 and records the exception in function logs.

For an intentional manual reset of the isolated demo, call the backend `dev`
branch alias with `Authorization: Bearer <CRON_SECRET>` from a trusted shell.
Keep the secret out of shell history and log files; use an environment variable
read from a private local file or a password manager. Verify the demo ledger
after the response. This replaces the current demo user's ledger and changes
its ID; concurrent visitor edits may be lost.

`backend/vercel.json` schedules the same endpoint once daily for the 03:00 UTC
hour (Hobby may invoke it later within that hour), the maximum supported
frequency on Hobby. Vercel Cron runs **only on Production**;
it will not fire on the current `dev` Preview. Keep the Production block in
place until the remaining #91 stages are ready. At go-live, configure the same
`CRON_SECRET`, `DEMO_NEON_HOST`, `DEMO_USER_PASSWORD`, and isolated Neon URL for
the intended demo Production deployment, then verify a manual call and the
first scheduled invocation in Vercel Logs. The schedule is a single line in
`backend/vercel.json` and can be changed in a reviewed PR. #278 remains open
until the scheduled run is verified.

## One-time database setup

For manual recovery on a trusted machine with Bash, Python 3 and `uv`, check out
`dev` and run the helper from the repository root:

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
