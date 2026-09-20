# Oblidog Ledger - Backend

## Branding and compatibility

Public backend configuration, generated emails, and full OpenAPI metadata use
the Oblidog name. Oblidog Ledger is retained for technical repository and
integration API naming. Existing database names, Docker volumes and network
aliases, legacy-import packages, and persisted data identifiers are retained
for deployment and data compatibility; they are not public branding.

## Requirements

* [Docker](https://www.docker.com/).
* [uv](https://docs.astral.sh/uv/) for Python package and environment management.

## General Workflow

By default, the dependencies are managed with [uv](https://docs.astral.sh/uv/), go there and install it.

From `./backend/` you can install all the dependencies with:

```console
$ uv sync
```

Then you can activate the virtual environment with:

```console
$ source .venv/bin/activate
```

Make sure your editor is using the correct Python virtual environment, with the interpreter at `backend/.venv/bin/python`.

## Current Backend Structure

- `app/api` for route modules
- `app/core` for configuration, security, and DB bootstrap
- `app/models` for SQLModel tables
- `app/schemas` for request/response schemas
- `app/repositories` for persistence helpers
- `app/services` for orchestration and future domain logic

## Current Product Rules

- Public registration is disabled.
- Users are provisioned by a superuser only.
- Admin-only user management remains available under `/api/v1/users`.
- Demo `Item` endpoints have been removed.
- Payment obligations support lifecycle actions for data collection, readiness,
  payment, cancellation, and reopening.

## Browser authentication

The frontend signs in through `POST /api/v1/login/session`. The backend stores
the JWT in a host-only `HttpOnly` cookie and exposes only a per-session CSRF
token in the `X-CSRF-Token` response header. Credentialed browser requests must
send that header for `POST`, `PUT`, `PATCH`, and `DELETE`. CORS accepts only
`FRONTEND_HOST` and `BACKEND_CORS_ORIGINS`; the production frontend and API may
use separate hostnames as long as both origins are configured.

`SESSION_COOKIE_SAMESITE` defaults to `lax`. `SESSION_COOKIE_SECURE` defaults to
enabled in staging and production and disabled locally; explicitly enable it
for HTTPS demo deployments. `SameSite=none` is rejected unless Secure is also
enabled. The frontend deletes the legacy `localStorage.access_token` during
startup. Users therefore sign in again once after upgrading from a bearer-token
frontend release.

`POST /api/v1/login/access-token` remains available for non-browser user API
clients and test tooling. Integration connection keys continue to use their
independent Bearer flow and are not session cookies.

## Temporary legacy workbook import

For the migration window, a ledger owner can start a legacy import with
`POST /api/v1/ledgers/{ledger_id}/legacy-import`. It returns `202 Accepted`
immediately. Read progress and the final counts with
`GET /api/v1/ledgers/{ledger_id}/legacy-import`, which returns the most recent
job for that ledger. Only one legacy import can be active at a time; progress
is logged every 50 obligations. The
backend downloads the workbook from Dropbox with `DROPBOX_API_KEY`. Configure
its path and monitored columns in YAML; start from
[`config/legacy-import.example.yaml`](config/legacy-import.example.yaml), store
the real file outside the repository, and set `LEGACY_IMPORT_CONFIG_PATH` to it.
Legacy import is disabled by default. Set the single authoritative switch
`LEGACY_IMPORT_MODE=manual_only` to allow the manual endpoint, or
`LEGACY_IMPORT_MODE=scheduled` when a system runner is configured.
For System Run, both enabled modes also require `LEGACY_IMPORT_LEDGER_ID` to
identify the one ledger receiving the configured workbook; runner execution is
never broadcast to all active ledgers. The existing manual endpoint continues
to use its ledger URL parameter.
Each monitored category header must have a unique four-letter category code in
its comment.

The selected ledger is the legacy PaymentBook, worksheets become category
groups, and payment categories become categories. Existing categories are
matched by code; their obligations are replaced atomically. The importer keeps
only the current and earlier periods, marks unpaid entries as `ready` with
confirmed values, and paid entries as `paid`. Imported values have source
`legacy`.

## Database

- Use Alembic migrations for schema changes.
- Internal database primary keys remain UUIDs and are intentionally separate from future business/public identifiers.
- The backend is expected to run against the external PostgreSQL configuration from `.env`.

## Docker Compose

Start the local development environment with Docker Compose following the guide in [../development.md](../development.md).

## VS Code

There are already configurations in place to run the backend through the VS Code debugger, so that you can use breakpoints, pause and explore variables, etc.

The setup is also already configured so you can run the tests through the VS Code Python tests tab.

## Docker Compose Override

During development, you can change Docker Compose settings that will only affect the local development environment in the file `compose.override.yml`.

The changes to that file only affect the local development environment, not the production environment. So, you can add "temporary" changes that help the development workflow.

For example, the directory with the backend code is synchronized in the Docker container, copying the code you change live to the directory inside the container. That allows you to test your changes right away, without having to build the Docker image again. It should only be done during development, for production, you should build the Docker image with a recent version of the backend code. But during development, it allows you to iterate very fast.

There is also a command override that runs `fastapi run --reload` instead of the default `fastapi run`. It starts a single server process (instead of multiple, as would be for production) and reloads the process whenever the code changes. Have in mind that if you have a syntax error and save the Python file, it will break and exit, and the container will stop. After that, you can restart the container by fixing the error and running again:

```console
$ docker compose watch
```

There is also a commented out `command` override, you can uncomment it and comment the default one. It makes the backend container run a process that does "nothing", but keeps the container alive. That allows you to get inside your running container and execute commands inside, for example a Python interpreter to test installed dependencies, or start the development server that reloads when it detects changes.

To get inside the container with a `bash` session you can start the stack with:

```console
$ docker compose watch
```

and then in another terminal, `exec` inside the running container:

```console
$ docker compose exec backend bash
```

You should see an output like:

```console
root@7f2607af31c3:/app#
```

that means that you are in a `bash` session inside your container, as a `root` user, under the `/app` directory, this directory has another directory called "app" inside, that's where your code lives inside the container: `/app/app`.

There you can use the `fastapi run --reload` command to run the debug live reloading server.

```console
$ fastapi run --reload app/main.py
```

...it will look like:

```console
root@7f2607af31c3:/app# fastapi run --reload app/main.py
```

and then hit enter. That runs the live reloading server that auto reloads when it detects code changes.

Nevertheless, if it doesn't detect a change but a syntax error, it will just stop with an error. But as the container is still alive and you are in a Bash session, you can quickly restart it after fixing the error, running the same command ("up arrow" and "Enter").

...this previous detail is what makes it useful to have the container alive doing nothing and then, in a Bash session, make it run the live reload server.

## Backend tests

To test the backend run:

```console
$ bash ./scripts/test.sh
```

The tests run with Pytest, modify and add tests to `./backend/tests/`.

Backend tests require a dedicated database configured via `TEST_SQLALCHEMY_DATABASE_URI`.
This URL must point to a different database than the main `SQLALCHEMY_DATABASE_URI`.
The test suite will fail fast if the test DB URL is missing or points at the main DB.

If you use GitHub Actions the tests will run automatically.

### Test running stack

If your stack is already up and you just want to run the tests, you can use:

```bash
docker compose exec backend bash scripts/tests-start.sh
```

That `/app/scripts/tests-start.sh` script just calls `pytest` after making sure that the rest of the stack is running. If you need to pass extra arguments to `pytest`, you can pass them to that command and they will be forwarded.

For example, to stop on first error:

```bash
docker compose exec backend bash scripts/tests-start.sh -x
```

### Test Coverage

When the tests are run, a file `htmlcov/index.html` is generated, you can open it in your browser to see the coverage of the tests.

## Migrations

As during local development your app directory is mounted as a volume inside the container, you can also run the migrations with `alembic` commands inside the container and the migration code will be in your app directory (instead of being only inside the container). So you can add it to your git repository.

Make sure you create a "revision" of your models and that you "upgrade" your database with that revision every time you change them. As this is what will update the tables in your database. Otherwise, your application will have errors.

* Start an interactive session in the backend container:

```console
$ docker compose exec backend bash
```

* Alembic is configured against the SQLModel modules under `./backend/app/models/`.

* After changing a model (for example, adding a column), inside the container, create a revision, e.g.:

```console
$ alembic revision --autogenerate -m "Add column last_name to User model"
```

* Commit to the git repository the files generated in the alembic directory.

* After creating the revision, run the migration in the database (this is what will actually change the database):

```console
$ alembic upgrade head
```

If you don't want to use migrations at all, uncomment the lines in the file at `./backend/app/core/db.py` that end in:

```python
SQLModel.metadata.create_all(engine)
```

and comment the line in the file `scripts/prestart.sh` that contains:

```console
$ alembic upgrade head
```

If you don't want to start with the default models and want to remove them / modify them, from the beginning, without having any previous revision, you can remove the revision files (`.py` Python files) under `./backend/app/alembic/versions/`. And then create a first migration as described above.

## Email Templates

The email templates are in `./backend/app/email-templates/`. Here, there are two directories: `build` and `src`. The `src` directory contains the source files that are used to build the final email templates. The `build` directory contains the final email templates that are used by the application.

Before continuing, ensure you have the [MJML extension](https://github.com/mjmlio/vscode-mjml) installed in your VS Code.

Once you have the MJML extension installed, you can create a new email template in the `src` directory. After creating the new email template and with the `.mjml` file open in your editor, open the command palette with `Ctrl+Shift+P` and search for `MJML: Export to HTML`. This will convert the `.mjml` file to a `.html` file and now you can save it in the build directory.
