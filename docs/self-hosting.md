# Self-hosting and operations

The production installer uses prebuilt backend and frontend images from
`ghcr.io/oblidog`. It downloads `compose.yml`, a matching `.env` template, the
configuration validator, and the database recovery tools. A source checkout is
not required. Docker Engine with the Compose plugin is required.

## Choose a deployment variant

- **Standalone** is the default for a new installation. It includes PostgreSQL
  with persistent storage on a private Docker network. Only the frontend and API
  ports are published; the database has no published host port.
- **External** uses an existing PostgreSQL database and reverse proxy network
  named `firefly_net`. Its frontend and backend retain the
  `findog-ledger-frontend` and `findog-ledger-backend` network aliases for
  compatibility with existing proxy deployments.

Create a deployment directory and run the [installer](../scripts/install.sh):

```bash
mkdir oblidog-ledger
cd oblidog-ledger
curl -fsSL https://raw.githubusercontent.com/oblidog/oblidog-ledger/main/scripts/install.sh | bash
```

Pass `external` to the installer for an external database and proxy:

```bash
curl -fsSL https://raw.githubusercontent.com/oblidog/oblidog-ledger/main/scripts/install.sh | bash -s -- external
```

The installer records the variant in `.oblidog-deployment-variant` and refuses
to replace it with another variant in the same directory. For an older,
unmarked installation, pass its existing variant explicitly on the first
installer update.

Edit `.env`: select a published immutable `TAG`, replace placeholder secrets,
and review the public URLs and bind addresses. The external variant also needs
PostgreSQL connection settings and the existing `firefly_net` network. For the
standalone variant, the template serves the frontend on `http://localhost:8080`
and the API on `http://localhost:8000`. To restrict those ports to a reverse
proxy on the Docker host, set both `*_BIND_ADDRESS` values to `127.0.0.1` and
set `FRONTEND_HOST`, `BACKEND_CORS_ORIGINS`, and `VITE_API_URL` to the public
URLs.

Validate and start the selected variant:

```bash
./validate-deployment.sh standalone # use external for the external variant
docker compose pull
docker compose up -d
docker compose ps
```

In standalone deployments, PostgreSQL must become healthy before `prestart`
applies migrations. The application starts after those migrations succeed. The
named `postgres-data` volume survives container recreation and
`docker compose down`. The volume is not a backup; follow the
[database backup and recovery runbook](operations/database-recovery.md),
including its isolated restore and upgrade drill, before an upgrade. Avoid
`docker compose down --volumes` unless you intend to delete the database.

## System Run scheduler

Both production variants include a `scheduler` service. Cron starts a separate,
time-limited System Run process at each scheduled time, and the application
records its result. By default it runs daily at 00:05 in `Europe/Warsaw`.
Configure these values in `.env` before starting or recreating the stack:

```dotenv
SYSTEM_RUN_SCHEDULE=5 0 * * *
SYSTEM_RUN_TIMEZONE=Europe/Warsaw
SYSTEM_RUN_TIMEOUT_SECONDS=3600
SYSTEM_RUN_STALE_AFTER_MINUTES=120
```

`SYSTEM_RUN_SCHEDULE` is a five-field cron expression evaluated in the configured
timezone, including daylight saving changes. The timeout limits a run; the stale
threshold controls recovery of interrupted runs. Scheduled tasks create
obligations, estimate missing amounts, and deliver reports if email is
configured. System Run does not start external provider integrations.

Check `docker compose ps scheduler` and `docker compose logs scheduler` for
scheduler status and output. In the app, open a ledger's **System Run** entry to
inspect run and step history, including skipped or failed tasks.

### Optional legacy import

Legacy import is disabled by default. Set `LEGACY_IMPORT_MODE` to `manual_only`
or `scheduled` to enable it. The import needs `DROPBOX_API_KEY` and a protected
configuration file at `LEGACY_IMPORT_CONFIG_PATH`. System Run also needs
`LEGACY_IMPORT_LEDGER_ID` to select the receiving ledger; the manual endpoint
uses the ledger ID in its URL. Start from
[`backend/config/legacy-import.example.yaml`](../backend/config/legacy-import.example.yaml)
and mount the real file read-only in both the `backend` and `scheduler` services.
See the [backend guide](../backend/README.md#temporary-legacy-workbook-import)
for the import workflow. This migration path and the retained `findog` database
identifiers are compatibility details, not Oblidog branding.

## Upgrade

Change `TAG` to a published immutable release, then run:

```bash
./validate-deployment.sh standalone # or: external
docker compose pull
docker compose up -d
```

Keep database backups and migration compatibility in mind before rolling a
version back. The [recovery runbook](operations/database-recovery.md) covers the
standalone database backup and restore drill.
