# Oblidog Ledger

<p align="center">
  <img src="frontend/public/assets/images/oblidog-logo.svg" alt="Oblidog Ledger" width="280" />
</p>

<p align="center"><strong>A calm, self-hosted home for recurring payments and obligations.</strong></p>

> **Early development:** Oblidog Ledger is actively evolving. The core ledger,
> category, obligation, and access-control workflows are usable, while
> integrations, automation, analytics, and parts of the product experience are
> still being shaped.

Oblidog Ledger is a self-hosted application for keeping recurring household or
small-team obligations under control. It is deliberately not another banking
or budgeting dashboard: the central object is an **obligation** — something
that needs to be known, prepared, paid, and eventually closed.

You keep control of the application and its data, can share a ledger with other
users, and can progressively automate data collection through the API without
making external integrations part of the core application.

## What it does today

- Organises recurring costs into category groups and categories.
- Uses categories as templates for creating obligations for billing periods.
- Creates and tracks obligations through an explicit lifecycle.
- Supports shared ledgers with owner, editor, and viewer access.
- Highlights upcoming and overdue payments while keeping completed obligations
  clearly separated.
- Stores structured, category-specific data alongside obligations.
- Supports obligation components, so a total can be represented by individual
  items such as invoices or charge components.
- Exposes API operations intended for external integrations and automation.
- Supports scoped API keys for machine-to-machine access to a ledger.

For the precise obligation-state rules and available lifecycle actions, see the
[obligation lifecycle](docs/obligation-lifecycle.md).

For category-specific structured data and the JSON Schema used to validate it,
see [category data records](docs/category-data-records.md).

## Core concepts

### Ledger

A ledger is the shared workspace. It owns categories and obligations and defines
who can access them.

### Category

A category describes a recurring type of obligation. Categories belong to
category groups and provide the metadata used when obligations are created.
They can also define a schema for structured data collected for that type of
obligation.

### Obligation

An obligation represents one concrete payment or responsibility for a billing
period. Its lifecycle separates incomplete data from an item that is ready to
pay, paid, canceled, or reopened.

### Components and structured data

Not every obligation is just a single amount. Components allow an obligation to
carry a breakdown of its total, while category-defined structured data can hold
domain-specific information such as invoice details, consumption, readings, or
other integration-provided values.

## Automation and integrations

Oblidog Ledger is designed so integrations can live outside the main
application. A mail processor, provider-specific scraper, or scheduled job can
use the API instead of being coupled to the backend.

The integration surface is built around ledger-scoped API keys and explicit
obligation operations. This keeps the core application useful on its own while
allowing automation to be added incrementally.

The Python client is maintained separately in the
[`oblidog-client-python`](https://github.com/oblidog/oblidog-client-python)
repository and is generated from the Ledger OpenAPI specification.

For registering external jobs and reporting their operational state using the
existing ledger-scoped API keys, see the [integration registry API](docs/integration-api.md).
The [integration lifecycle design](docs/integration-lifecycle.md) documents the
model and the planned runner-adoption and monitoring-UI stages.

## Screenshots

The UI is still moving quickly, so screenshots are intentionally postponed
until the main desktop and mobile navigation settles.

## Run it yourself

Two self-hosted Docker Compose variants are supported:

- **Standalone** (recommended for a new installation) includes PostgreSQL,
  persistent database storage, and a self-contained private network. Only the
  frontend and API ports are published.
- **External** keeps PostgreSQL and the reverse proxy outside this project. It
  retains the existing `firefly_net` network and legacy
  `findog-ledger-frontend` / `findog-ledger-backend` aliases for compatibility.

Both variants use prebuilt images and require an immutable release tag. Docker
Engine with the Compose plugin is the only prerequisite for the standalone
variant.

### Install

Create a deployment directory and run the installer. There is no need to clone
the application source code. The default is the standalone variant.

```bash
mkdir oblidog-ledger
cd oblidog-ledger
curl -fsSL https://raw.githubusercontent.com/oblidog/oblidog-ledger/main/scripts/install.sh | bash
```

The installer downloads `compose.yml`, a matching `.env` template, and the
configuration validator. It also records the selected variant and refuses to
replace it with another variant in the same directory. When updating an older,
unmarked installation, pass its existing variant explicitly on the first run.

Then:

1. Edit `.env`. Replace all placeholder secrets and review the public URLs and
   bind addresses. Use a published release for `TAG`, never `latest`.
2. Validate the configuration, pull the images, and start the stack. PostgreSQL
   must become healthy before `prestart` runs migrations; the application only
   starts after migrations succeed.

```bash
./validate-deployment.sh standalone
docker compose pull
docker compose up -d
```

With the template defaults, open `http://localhost:8080`; the API is available
at `http://localhost:8000`. To make the ports reachable only through a reverse
proxy on the Docker host, set both `*_BIND_ADDRESS` values to `127.0.0.1` and
set the public `FRONTEND_HOST`, `BACKEND_CORS_ORIGINS`, and `VITE_API_URL` URLs.
The database has no published host port.

Confirm that the services are healthy:

```bash
docker compose ps
```

PostgreSQL data is stored in the named `postgres-data` volume and survives
container recreation and `docker compose down`. Do not use
`docker compose down --volumes` unless you intentionally want to delete it.
The volume is not a backup. Before upgrading, follow the
[database backup and recovery runbook](docs/operations/database-recovery.md),
including its isolated restore-and-upgrade drill.

#### External database and reverse proxy

Existing deployments can continue using the external variant unchanged. For a
new external installation, pass `external` to the installer:

```bash
curl -fsSL https://raw.githubusercontent.com/oblidog/oblidog-ledger/main/scripts/install.sh | bash -s -- external
```

Set the external PostgreSQL connection values in `.env`, create the external
`firefly_net` Docker network, and configure the reverse proxy to reach the
legacy service aliases. Then validate and start it:

```bash
./validate-deployment.sh external
docker compose pull
docker compose up -d
```

### System Run scheduler

The production stack includes a dedicated `scheduler` service. It stays running
and uses cron to start a separate, one-shot System Run at each scheduled time;
the one-shot process is limited by its timeout and records the run result in
the application.

By default, the run starts at 00:05 every day. Its schedule is
`5 0 * * *` and it is evaluated in the configured `Europe/Warsaw` timezone.
Configure these values in `.env` before starting or recreating the stack:

```dotenv
SYSTEM_RUN_SCHEDULE=5 0 * * *
SYSTEM_RUN_TIMEZONE=Europe/Warsaw
SYSTEM_RUN_TIMEOUT_SECONDS=3600
SYSTEM_RUN_STALE_AFTER_MINUTES=120
```

`SYSTEM_RUN_SCHEDULE` is a standard five-field cron expression (minute, hour,
day of month, month, day of week). Cron evaluates it in
`SYSTEM_RUN_TIMEZONE`, including timezone changes such as daylight saving
time. `SYSTEM_RUN_TIMEOUT_SECONDS` limits each one-shot execution;
`SYSTEM_RUN_STALE_AFTER_MINUTES` determines when an interrupted run can be
recovered as stale.

Each System Run task has one of three modes: `disabled` never runs,
`manual_only` can only be selected for a manual run, and `scheduled` runs on
the cron schedule. Legacy import is `disabled` by default. To enable it, set
`LEGACY_IMPORT_MODE` to `manual_only` or `scheduled`; both modes also require
`LEGACY_IMPORT_LEDGER_ID`, `DROPBOX_API_KEY`, and a protected legacy-import
configuration file referenced by `LEGACY_IMPORT_CONFIG_PATH`. See
[`backend/config/legacy-import.example.yaml`](backend/config/legacy-import.example.yaml)
for the configuration-file format. Mount the real file read-only at that path
in both the `backend` and `scheduler` services.

For day-two checks, confirm that the scheduler container is running and inspect
its cron and one-shot output:

```bash
docker compose ps scheduler
docker compose logs scheduler
```

In the application, open a ledger's **System Run** entry from the ledger menu
to inspect run and per-step history, including skipped and failed tasks.

### Upgrade

Change `TAG` to the desired immutable release and run:

```bash
./validate-deployment.sh standalone # or: external
docker compose pull
docker compose up -d
```

Keep database backups and migration compatibility in mind before rolling a
version back.

### Releases

Commitizen prepares a version bump and `CHANGELOG.md` on a release branch.
After its pull request is merged, the finalizer creates an annotated tag and a
draft GitHub Release containing the matching changelog section and integration
OpenAPI asset. Publishing the reviewed draft builds the immutable backend and
frontend images in GHCR and starts Python client regeneration.

## Project status

Oblidog Ledger is currently an early-stage project rather than a finished
consumer product. The direction is to keep the core ledger small and predictable
while building richer UX, external integrations, reporting, and automation on
top of it.

The project is developed in public under the
[`oblidog`](https://github.com/oblidog) GitHub organisation.

## Branding and compatibility

Oblidog is the current product name. The legacy `findog-legacy-adapter` and
its repository remain in use only to import historical data. PostgreSQL names,
Docker volumes, deployed network aliases, and secrets also retain their legacy
identifiers until a separately coordinated infrastructure migration.
