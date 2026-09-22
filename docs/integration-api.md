# Integration API

An integration connects one external job to one category in an Oblidog ledger.
The job runs outside Oblidog; the app stores its configuration, connection keys,
and latest reported health. Provider credentials and scheduling stay with the
external runner. The current API contract is also published as the
[integration OpenAPI specification](../openapi/integration.json).

## Create and manage an integration

The ledger owner can use **Integrations → Add integration** or the user API:

```text
POST /api/v1/ledgers/{ledger_id}/integrations
```

Send a name and one category from that ledger:

```json
{
  "name": "Home electricity",
  "category_id": "00000000-0000-0000-0000-000000000001"
}
```

Creation returns the integration, its first credential, and a `connection_key`.
Copy the full key immediately; it is returned only when created. The owner can
generate another key with
`POST /api/v1/ledgers/{ledger_id}/integrations/{integration_id}/credentials`
and revoke one with
`DELETE /api/v1/ledgers/{ledger_id}/integrations/{integration_id}/credentials/{credential_id}`.
Rotation does not reset the integration's monitoring state.

Ledger members with view access can list or inspect integrations with
`GET /api/v1/ledgers/{ledger_id}/integrations` and
`GET /api/v1/ledgers/{ledger_id}/integrations/{integration_id}`. Only the owner
can update one with `PATCH` on the detail URL. Updates include an
`expected_revision` from the latest read and may change the name, enabled flag,
or monitoring time limits. The category is fixed after creation. Disable an
integration to retire it; there is no delete endpoint.

The default run timeout is 1,800 seconds and the default reporting threshold is
93,600 seconds. `run_timeout_seconds` must be shorter than
`stale_after_seconds`. The Integrations screen shows current health, last run,
last success, and reported changes. It refreshes periodically, but does not
start or schedule external jobs.

## Authenticate a runner

Send the connection key as `Authorization: Bearer <connection_key>` to
`/api/v1/integration/...`. The key resolves the integration, its single category,
and its ledger. The runner does not send a ledger ID, category code, or
integration key to choose its authorization context. A key cannot access a
different category's obligations or records.

`GET /api/v1/integration/context` returns the integration and category context.
The main contextual operations are:

| Operation | Endpoint |
| --- | --- |
| Read or create structured category observations | `GET` / `POST /api/v1/integration/category/data-records` |
| Read the latest observation | `GET /api/v1/integration/category/data-records/latest` |
| Read the active category schema | `GET /api/v1/integration/category/schema` |
| List obligations in this category | `GET /api/v1/integration/obligations` |
| Read or update one billing period | `GET` / `PATCH /api/v1/integration/obligations/{period}` |
| Upsert a bill component | `PUT /api/v1/integration/obligations/{period}/components/upsert` |
| Mark an obligation ready or paid | `PATCH /api/v1/integration/obligations/{period}/ready`; `POST /api/v1/integration/obligations/{period}/mark-paid` |

`{period}` uses `YYYY-MM`, for example `2026-09`. Full obligation keys are
temporarily accepted for client migration, but new clients should use periods.
Other lifecycle and note operations are in the OpenAPI specification. See
[category data records](category-data-records.md) and the
[obligation lifecycle](obligation-lifecycle.md) for their rules.

Component upsert returns `{ "component": ..., "result": ... }`, where `result`
is `created`, `updated`, or `unchanged`. An identical retry is unchanged and
does not add an obligation action entry. A category observation with the same
source and external ID is also idempotent.

## Report a run

Read `GET /api/v1/integration/context` to obtain the current `revision`, then
send a fresh UUID for this invocation:

```text
POST /api/v1/integration/runs/start
{"run_id":"6a1af7e0-0799-43bf-a8c1-497bcf827ac1","expected_revision":0}
```

After all provider work and intended Oblidog updates finish, report the result:

```text
POST /api/v1/integration/runs/finish
{"run_id":"6a1af7e0-0799-43bf-a8c1-497bcf827ac1","result":"success","changes_detected":false,"error":null}
```

A successful check without a new bill may report `changes_detected: false`;
use `null` when the runner cannot determine whether data changed. For a failed
run, send `result: "failure"`, `changes_detected: null`, and an `error` object
with a stable lowercase code and a sanitized message. Never send credentials,
raw provider responses, or tracebacks in that message. If some writes succeeded
before a later failure, report failure.

An identical retry of the current start or finish is safe. Do not reuse run
UUIDs or rerun provider work after an already finished invocation. A finish
must match the current run; an older run superseded after timeout cannot finish
later. The registry retains current state and last result, not a full run
history. Health is derived on read: disabled, timed out, stale, running, never
run, error, or healthy. Disabling an integration blocks new starts but does not
stop a runner process or revoke its key; revoke the key separately if needed.
System Run does not launch integration jobs.
