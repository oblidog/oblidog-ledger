# Oblidog - Frontend

React/Vite frontend for Oblidog. It uses Bun; run the following commands from the repository root.

## Requirements

- [Bun](https://bun.sh/)

## Quick Start

```bash
bun install --frozen-lockfile
bun run --filter frontend dev
```

Open <http://localhost:5173>. The local dev server is the recommended frontend workflow; Docker Compose is useful for testing the full stack.

## TypeScript compiler and generator API

Type checking uses TypeScript 7.0.2 through the `@typescript/native` npm alias:

```bash
bun run --filter frontend typecheck
```

The `typescript` dependency is an alias for Microsoft's
`@typescript/typescript6` compatibility package. `@hey-api/openapi-ts` still
uses the legacy compiler API (including `SyntaxKind`), which TypeScript 7.0
no longer exposes. Keep the compatibility package until the generator supports
the new API. It does not select the compiler used by `typecheck` or `build`.

The typecheck script invokes the native alias explicitly because Bun's isolated
workspace installation does not reliably link an aliased compiler's `tsc` binary.
Do not replace it with an unqualified `tsc` or `tsc6`: that can choose the wrong
compiler or fail to find the executable. Both TypeScript versions are development
tools and are not included in the frontend runtime image.

## Application Version

The frontend exposes the build version through `VITE_APP_VERSION` and renders it in the page footer. The value is compiled into the Vite bundle, so displaying it does not require an API request.

Local development can omit the variable; the UI then displays `dev`:

```bash
bun run --filter frontend dev
```

To verify a versioned build locally, provide the exact release tag:

```bash
VITE_APP_VERSION=v0.12.4 bun run --filter frontend build
```

The frontend Dockerfile accepts the same value as a build argument:

```bash
docker build \
  --build-arg VITE_APP_VERSION=v0.12.4 \
  -f frontend/Dockerfile \
  .
```

Release container builds set `VITE_APP_VERSION` from the same Git tag (`vX.Y.Z`) that is used as the immutable GHCR image tag. This keeps the version shown in the UI aligned with the served frontend artifact.

## Generate Client

### Automatically

* Activate the backend virtual environment.
* From the top level project directory, run the script:

```bash
bash ./scripts/generate-client.sh
```

* Commit the changes.

### Manually

* Start the Docker Compose stack.

* Download the OpenAPI JSON file from `http://localhost/api/v1/openapi.json` and copy it to a new file `openapi.json` at the root of the `frontend` directory.

* To generate the frontend client, run:

```bash
bun run --filter frontend generate-client
```

* Commit the changes.

Notice that every time the backend OpenAPI schema changes, you should regenerate the frontend client.

## Current Frontend Scope

- No public signup flow.
- Admin user management is limited to superusers.
- Ledger, membership sharing, and category management are available.

## Fast Frontend Tests

Pure date, filter serialization, formatting, and action-eligibility rules use Bun's built-in test runner. They do not require Docker, PostgreSQL, or a running API:

```bash
bun run --filter frontend test:unit
```

Keep deterministic domain and interaction rules in the fast suite. Use Playwright for cross-layer workflows that need the browser, API, authentication, or database.

## End-to-End Testing with Playwright

The frontend includes end-to-end tests using Playwright. Run them in the dedicated, isolated Compose project:

```bash
make e2e
```

This project has its own Docker network and PostgreSQL volume, and does not publish the API port on the host. It can therefore run while `make dev-b` is serving the manual test environment.

To remove the isolated stack and its test data:

```bash
make e2e-down
```

To update the tests, navigate to the tests directory and modify the existing test files or add new ones as needed.

For more information on writing and running Playwright tests, refer to the official [Playwright documentation](https://playwright.dev/docs/intro).

### Public demo previews

Demo navigation exposes ledger settings, account settings, integrations and
System Run. Settings and sensitive actions remain disabled with an inline
explanation; backend capability checks still reject these writes. Integration
reads use the normal ledger access checks and the seeded demo records, including
run history. System Run uses explicitly labelled presentation data and never
requests administrator-only history on behalf of the demo account.

The authenticated layout shows a compact `DEMO` information button in the desktop
and mobile headers. The full notice stays on the login page; read-only mode also
has a persistent label. Marketing screenshots hide only the indicator with
Playwright's screenshot `style` option, leaving demo mode and its restrictions
active. The API-mocked desktop/mobile regression tests run with
`bun run test:i18n` and do not connect to a backend or database.
