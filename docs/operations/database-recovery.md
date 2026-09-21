# Database backup, restore, and migration recovery

Container rollback and database rollback are separate operations. Oblidog runs
Alembic migrations from the `prestart` service before the backend starts. A
failed deployment can therefore leave the database at the new schema revision
even when the deployment helper restores the previous image tag.

## Responsibilities and prerequisites

For an externally managed PostgreSQL service, the provider is responsible only
for the availability, snapshots, point-in-time recovery, and retention that its
contract explicitly includes. The Oblidog operator must verify those features,
keep independent backups when the recovery objective requires them, protect
database credentials, encrypt backup storage, restrict access, define retention,
and periodically prove that a backup can be restored.

For the standalone Compose variant, the operator owns all of the above. The
`postgres-data` volume is persistent storage, not a backup. Keep backup copies
off the Docker host.

The supplied helpers require Docker. The source PostgreSQL server must accept a
connection from the Docker host, and its user needs permission to read all
application objects. Use a PostgreSQL client image with the same major version
as the server (PostgreSQL 18 by default).

## Create a backup

Run from the deployment directory before every release that may migrate the
schema:

```bash
ENV_FILE=.env BACKUP_DIR=/secure/oblidog-backups \
  ./scripts/db-backup.sh
```

The installer records `standalone` or `external` in
`.oblidog-deployment-variant`, which the helper detects automatically. In a
source checkout without that marker it defaults to `external`; set
`DEPLOYMENT_VARIANT=standalone` (and `COMPOSE_FILE` if it is not `compose.yml`)
when backing up the bundled PostgreSQL service.

The helper creates a custom-format `pg_dump` with no ownership or ACL commands
and publishes the mode-`0600` metadata before atomically moving the completed
dump into place. Failed or interrupted attempts remove their temporary files,
so a final dump name never identifies a partial backup. The metadata records the
UTC timestamp, application image tag, Alembic revision, database name, and
PostgreSQL client image. Copy both files together. Encrypt them at rest and
apply the locally defined retention policy. A successful `pg_dump` is not proof
of recoverability; run the drill below.

Before a deployment, record and retain together:

- the dump and its metadata file;
- the immutable backend/frontend image tag;
- the `.env` configuration, stored separately from the dump with secrets
  protected;
- the Compose file and reverse-proxy configuration used by that release.

## Isolated restore and upgrade drill

The drill creates a new internal Docker network and disposable PostgreSQL
container. It publishes no port and never reads `.env`, so it cannot select the
production database. It restores the dump, checks the schema and representative
users/access configuration, obligations, components, and category data, then
runs `alembic upgrade head` using the chosen backend image and repeats the
checks.

Use the image being evaluated for the next deployment:

```bash
./scripts/db-restore-drill.sh \
  --dump /secure/oblidog-backups/oblidog-findog_ledger-20260921T120000Z.dump \
  --backend-image ghcr.io/oblidog/oblidog-ledger-backend:v0.16.0
```

The backup must contain representative rows in `user`, `ledger`, `obligation`,
`obligation_component`, and `category_data`; otherwise the drill fails. The
`ledger_membership` table and a non-empty `alembic_version` are also required.
This deliberately rejects an empty smoke-test database that cannot demonstrate
the acceptance path.

Run the drill at least after a migration-bearing release is built and on the
regular recovery schedule chosen by the operator. It proves logical restore and
upgrade compatibility, not provider snapshot recovery, DNS/network recovery,
secret availability, available disk capacity, or an application-level login.
Those remain separate operational tests.

## Failed deployment decision procedure

1. Stop automated deployment attempts and prevent traffic from reaching an
   unhealthy backend. Do not run `alembic downgrade` as a reflex.
2. Inspect the `prestart` logs and query `SELECT version_num FROM
   alembic_version;`. Compare it with the backup metadata and both image tags.
3. If migration did not start, restore the previous immutable tag and restart
   the containers.
4. If migration completed and the old application is explicitly compatible
   with the new schema, the previous containers may be used temporarily. Verify
   readiness and critical reads/writes before restoring traffic.
5. If the old application is not compatible with the migrated schema, prefer a
   forward fix with a new image. This preserves data written after deployment.
6. If a forward fix is unsafe or unavailable, stop writers, preserve a forensic
   dump of the failed state, provision a clean database, restore the pre-deploy
   backup, and start the matching previous image and configuration. Validate it
   before switching traffic. Restoring a backup loses changes made after that
   backup.

Never restore over the live database. Restore into a new database or server,
validate it, then switch the application connection during a controlled outage.
Provider point-in-time recovery should likewise target a new instance when the
provider supports that workflow.

## Post-recovery checks

- `alembic_version` matches the image being run.
- Backend readiness is healthy and logs contain no schema errors.
- A known user can authenticate and access the expected ledger.
- Representative obligations, components, and category data are present.
- Integrations and the scheduler are resumed only after the data checks pass.
- A new backup is taken after the incident is resolved.
