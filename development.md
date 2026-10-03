# Oblidog Ledger - Development

## Current Assumptions

- This is a private application.
- Public signup is disabled.
- Users are admin-managed only.
- Local backend workflow is based on `uv`.
- Local frontend workflow is based on Bun.
- The application is expected to connect to the external PostgreSQL configuration from `.env`.

## Docker Compose

* Start the local stack with Docker Compose:

```bash
docker compose watch
```

* Now you can open your browser and interact with these URLs:

Frontend, built with Docker, with routes handled based on the path: <http://localhost:5173>

Backend, JSON based web API based on OpenAPI: <http://localhost:8000>

Automatic interactive documentation with Swagger UI (from the OpenAPI backend): <http://localhost:8000/docs>

Adminer, database web administration: <http://localhost:8080>

Traefik UI, to see how the routes are being handled by the proxy: <http://localhost:8090>

**Note**: The first time you start your stack, it might take a minute for it to be ready. While the backend waits for the database to be ready and configures everything. You can check the logs to monitor it.

To check the logs, run (in another terminal):

```bash
docker compose logs
```

To check the logs of a specific service, add the name of the service, e.g.:

```bash
docker compose logs backend
```

## Mailcatcher

Mailcatcher is a simple SMTP server that catches all emails sent by the backend during local development. Instead of sending real emails, they are captured and displayed in a web interface.

This is useful for:

* Testing email functionality during development
* Verifying email content and formatting
* Debugging email-related functionality without sending real emails

The backend is automatically configured to use Mailcatcher when running with Docker Compose locally (SMTP on port 1025). All captured emails can be viewed at <http://localhost:1080>.

## Local Development

The Docker Compose files are configured so that each of the services is available in a different port in `localhost`.

For the backend and frontend, they use the same port that would be used by their local development server, so, the backend is at `http://localhost:8000` and the frontend at `http://localhost:5173`.

This way, you could turn off a Docker Compose service and start its local development service, and everything would keep working, because it all uses the same ports.

For example, you can stop that `frontend` service in the Docker Compose, in another terminal, run:

```bash
docker compose stop frontend
```

And then start the local frontend development server:

```bash
bun run --filter frontend dev
```

Or you could stop the `backend` Docker Compose service:

```bash
docker compose stop backend
```

And then you can run the local development server for the backend:

```bash
cd backend
fastapi dev app/main.py
```

## Docker Compose files and env vars

There is a main `compose.yml` file with all the configurations that apply to the whole stack, it is used automatically by `docker compose`.

And there's also a `compose.override.yml` with overrides for development, for example to mount the source code as a volume. It is used automatically by `docker compose` to apply overrides on top of `compose.yml`.

These Docker Compose files use the `.env` file containing configurations to be injected as environment variables in the containers.

They also use some additional configurations taken from environment variables set in the scripts before calling the `docker compose` command.

After changing variables, make sure you restart the stack:

```bash
docker compose watch
```

## The .env file

The `.env` file is the one that contains all your configurations, generated keys and passwords, etc.

Depending on your workflow, you could want to exclude it from Git, for example if your project is public. In that case, you would have to make sure to set up a way for your CI tools to obtain it while building or deploying your project.

One way to do it could be to add each environment variable to your CI/CD system, and updating the `compose.yml` file to read that specific env var instead of reading the `.env` file.

## Python version

The backend uses Python 3.14 in Docker, CI, local development, and the Vercel
demo. The root `.python-version` pins the uv workspace interpreter;
`backend/.python-version` also pins deployments with `backend/` as their project
root.

Install the interpreter and sync the workspace from the repository root:

```bash
uv python install 3.14
uv sync --frozen
```

An existing virtual environment created with an older Python version will be
recreated by uv when syncing. The host system Python does not determine the
interpreter inside the backend Docker image.

## Pre-commit and Commitizen

The repository uses `.pre-commit-config.yaml` for local git hooks and `commitizen`
for conventional commits.

Configured hooks currently cover:

- frontend `biome check`
- backend `ruff check`
- backend `ruff format`
- backend `mypy`
- frontend SDK regeneration when backend API files change
- `commitizen` commit message validation on the `commit-msg` hook

The `Backend Quality` GitHub Actions workflow also runs `backend/scripts/lint.sh`
on every pull request, including release and back-sync PRs. It checks all backend
Python files with strict mypy, then checks application lint and formatting with
Ruff. The check fails on errors and does not require a database or apply fixes.

Run the same checks locally from `backend/`:

```bash
uv run --locked bash scripts/lint.sh
```

#### Install hooks

The backend dev dependencies include both `pre-commit` and `commitizen`.

After syncing backend dependencies, install the hooks from `backend/`:

```bash
uv sync
uv run pre-commit install --hook-type pre-commit --hook-type commit-msg
```

Now normal `git commit` runs the pre-commit hooks, and the final commit message is
validated by `commitizen`.

#### Running hooks manually

To run all hooks on the current repository:

```bash
uv run pre-commit run --all-files
```

To validate or create conventional commit messages manually:

```bash
uv run cz check --message "feat: add example"
uv run cz commit
```

From the repository root you can use the helper wrapper:

```bash
bash ./scripts/cz.sh check --message "feat: add example"
bash ./scripts/cz.sh commit
```

There is also a root `Makefile` for common shortcuts:

```bash
make cmt
make dev-b
make dev-f
make pre
make test
make cov
```

## URLs

The production or staging URLs would use these same paths, but with your own domain.

### Development URLs

Development URLs, for local development.

Frontend: <http://localhost:5173>

Backend: <http://localhost:8000>

Automatic Interactive Docs (Swagger UI): <http://localhost:8000/docs>

Automatic Alternative Docs (ReDoc): <http://localhost:8000/redoc>

Adminer: <http://localhost:8080>

Traefik UI: <http://localhost:8090>

MailCatcher: <http://localhost:1080>
