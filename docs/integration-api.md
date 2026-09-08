# Integration registry API

The registry tracks one configured external job per ledger, for example
`nju-mario` and `nju-second`. Both may use the same existing ledger-scoped API
key. Provider credentials, category mapping and cron/Task scheduling stay with
the runner. This backend feature does not yet add runner reporting or a UI.

## Register and manage an instance

Use the normal user token. Only the ledger owner can create or update an
instance; members with ledger view access can read it.

- `POST /api/v1/ledgers/{ledger_id}/integrations` creates an instance (201).
- `GET /api/v1/ledgers/{ledger_id}/integrations` lists instances (`data`, `count`,
  `limit` 1–100 and nonnegative `offset`).
- `GET /api/v1/ledgers/{ledger_id}/integrations/{integration_id}` reads one.
- `PATCH /api/v1/ledgers/{ledger_id}/integrations/{integration_id}` updates its
  name, category associations, enabled flag or monitoring limits.

Example creation body:

```json
{
  "key": "nju-mario",
  "provider": "nju",
  "name": "Mario's phone",
  "category_ids": [],
  "enabled": true,
  "stale_after_seconds": 93600,
  "run_timeout_seconds": 1800
}
```

Keys and provider identifiers are immutable lowercase slugs, at most 64
characters. The key is unique within its ledger. Categories must belong to the
same ledger; associations are descriptive and do not change API permissions.
There is no delete endpoint; disable an instance to retire it.

Every accepted mutation increments `revision`. Updates require
`expected_revision` from the latest read. Omit unchanged properties; explicit
nulls and unknown properties are rejected. Time limits must be positive, timeout
must be smaller than the reporting limit, and limits cannot change during an
unfinished run inside its timeout. Disabling remains allowed during execution.

## Report a run using the existing API key

Send `Authorization: Bearer <OBLIDOG_API_KEY>`. Ledger identity comes exclusively
from that key. Read requires `ledger:read`; start and finish require
`ledger:write`. No additional scope or per-instance credential is needed.

1. `GET /api/v1/integration/instances/{integration_key}` reads configuration,
   `revision`, latest execution and derived health.
2. `POST /api/v1/integration/instances/{integration_key}/start` accepts:

   ```json
   {
     "run_id": "6a1af7e0-0799-43bf-a8c1-497bcf827ac1",
     "expected_revision": 0
   }
   ```

3. After provider work and all intended synchronization complete,
   `POST /api/v1/integration/instances/{integration_key}/finish` accepts:

   ```json
   {
     "run_id": "6a1af7e0-0799-43bf-a8c1-497bcf827ac1",
     "result": "success",
     "changes_detected": false,
     "error": null
   }
   ```

A success with no invoice or changes is healthy. `changes_detected: null` means
unknown. On failure send `result: "failure"`, `changes_detected: null` and an
`error` object: `{"code": "provider_failed", "message": "Provider unavailable"}`.
Error codes use lowercase letters, digits and underscores (1–64 characters,
starting with a letter); messages are nonblank and at most 1000 characters.
The caller must sanitize messages: never send credentials, raw provider responses
or tracebacks. A partially completed synchronization is a failed run, even if
some business writes already committed.

All reporting success responses are 200 and return current public state.
Timestamps come from the server. Identical retries of the current start or
finish do not advance them or revision. Never reuse run IDs, never rerun a
finished invocation, and never blindly refresh the revision to replay an old
start. A finish must match the current run. After another start supersedes a
timed-out run, its delayed finish is rejected. A late finish is accepted if its
run is still current. Idempotency is limited to that retained current run.

Conflicts return 409 with `detail.code`: `duplicate_key`, `revision_conflict`,
`integration_disabled`, `run_in_progress`, or `run_conflict`. Unknown/cross-ledger
instances or categories return 404, malformed bodies return 422, and key
failures/missing scopes retain the existing 401/403 behavior. All registry
operations are disabled in demo mode.

## Read operational health

`execution_state` is `never_run`, `running`, `timed_out` or `finished`.
`last_result` describes the latest completed attempt and survives a new start.
`last_success_at` advances on every success, including a no-op, and survives
subsequent failures. Success clears the previous error message.

An unfinished run times out at `current_started_at + run_timeout_seconds`.
`is_stale` becomes true at the later of `enabled_at` and `last_finished_at`, plus
`stale_after_seconds`. Starts and retries do not reset that reporting deadline.
Disabled instances are not stale; re-enabling starts a new reporting grace period.

`health` applies this precedence: disabled, timed out, stale, running, never run,
last attempt failed (`error`), otherwise `healthy`. These values are derived at
read time without a scheduler. Repeated failures remain errors despite recent
reporting. Timeout means no received completion, not a proven provider failure.

Disabling blocks new starts but permits the matching in-flight completion. It
does not stop a container, revoke API access, or change any obligation. Host
locks and process timeouts remain necessary: the registry protects health state,
not concurrent business writes. There is no run history or automatic alerting.

## Rollout

Apply the normal Alembic migration before deploying this backend. Existing keys,
observations, component sources and obligations are unchanged. No historic
success is inferred from existing API-key usage. Register instances before
opting runners into reporting through `OBLIDOG_INTEGRATION_KEY` in the later
runner-adoption step. Python and frontend clients are generated from these API
contracts; the separate Python client adds the public reporting facade.
