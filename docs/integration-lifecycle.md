# Integration lifecycle and health design

Status: implementation contract for [#115](https://github.com/oblidog/oblidog-ledger/issues/115).
The registry models, management/reporting endpoints and generated clients are
implemented in stage 2; see [API usage](integration-api.md). External runner
adoption and the monitoring UI remain follow-up stages.

## Decisions

- An `Integration` is one configured external synchronization instance belonging
  to exactly one ledger. Its current operational state belongs to that instance.
- Keep the existing ledger-scoped API keys and `ledger:read` / `ledger:write`
  scopes. An integration identifier is not another credential.
- Credentials, provider configuration, and scheduling stay with the external
  runner. Ledger stores identity, category associations, and monitoring settings.
- Report start and completion; distinguish successful checks with no changes
  from failures and missing reports. Store current state first, without run history.
- Integration health never implicitly changes obligations or their components.

## Ownership, identity, and configuration

An instance represents one independently configured synchronization job, normally
one provider account. The provider identifies the implementation, not the account.

| Instance key | Provider | Example associated categories |
| --- | --- | --- |
| `ekartoteka-home` | `ekartoteka` | Apartment charges |
| `nju-mario` | `nju` | Mario's phone |
| `nju-second` | `nju` | Second phone |

Use a UUID as the database identity and an immutable `key`, unique within a
ledger, as the runner-facing identity. Keys and provider identifiers use
`^[a-z][a-z0-9-]{0,63}$`. Display names can change. Provider is immutable; changing
the provider or replacing an account with an unrelated account creates a new
instance. Rotating credentials or moving the same job to another host does not.

An instance may have zero or more category associations. Zero is useful during
setup or for a ledger-level job. A category may have several integrations. All
associations must stay within the instance's ledger. They describe ownership of
the synchronization work for display; they do not grant or restrict API access.
Conflicting writers to one category still need explicit coordination outside
this monitoring feature.

The ledger owner creates and configures instances; members with existing ledger
view access can inspect their health. Instance creation is explicit, with no
automatic creation on the first report: a typo must not silently create another
monitored job. Initially, retire an instance by disabling it; a public delete API
and instance-key reuse are outside this version.

| Location | Configuration |
| --- | --- |
| Ledger | Key, display name, provider, category associations, enabled flag, reporting and execution time limits |
| Runner environment | `OBLIDOG_URL`, existing `OBLIDOG_API_KEY`, new `OBLIDOG_INTEGRATION_KEY`, provider credentials and category mapping |
| Deployment | Image version, local state volumes, cron/Task schedule and host execution locks |

The same API key may serve both NJU instances. Ledger resolves the tenant from
`ApiContext.ledger`, then looks up the supplied instance key inside that ledger.
There is no `api_key_id` ownership link on `Integration`; key rotation must not
reset health. A key with write access can report for any instance in its ledger,
so the supplied instance key is an identity claim, not proof of a specific runner.

## Storage proposal

Add an `integration` table and an `integration_category` association table in a
follow-up migration. Keep operational state on `integration`; do not add a
separate `IntegrationState` or historical `IntegrationRun` table initially.

| Field | Meaning |
| --- | --- |
| `id`, `ledger_id` | Instance UUID and owning ledger UUID |
| `key`, `provider`, `name` | Stable instance key, provider identifier, editable display name (1–255 characters) |
| `enabled` | Whether new reported runs are permitted; defaults to true |
| `created_at`, `updated_at`, `enabled_at` | Server timestamps; `enabled_at` resets on re-enabling and is null before the first enable |
| `stale_after_seconds` | Positive maximum gap without a completed report; suggested daily-job default: 93600 (26 hours) |
| `run_timeout_seconds` | Positive monitoring deadline for a started run; suggested default: 1800 (30 minutes) |
| `revision` | Nonnegative integer, initially zero; incremented on each accepted mutation |
| `current_run_id`, `current_started_at`, `current_finished_at` | Latest accepted run UUID and server timestamps; null before first start; finish is null while unfinished |
| `last_finished_at`, `last_result` | Latest accepted completion and `success` / `failure`; retained when another run starts |
| `last_changes_detected` | Nullable boolean describing that completion; null when unknown, including failed runs |
| `last_error_code`, `last_error_message` | Latest completion's error; cleared on success |
| `last_success_at` | Latest successful completion, including a successful check with no changes |

Use timezone-aware UTC server timestamps. Reporter-supplied timestamps must not
drive deadlines or overwrite the last success. No invoice content, credentials,
raw provider responses, or arbitrary error metadata JSON belongs in this table.
Error codes are stable machine identifiers (maximum 64 characters); messages are
sanitized summaries (maximum 1000 characters), not exception dumps.

Enforce unique `(ledger_id, key)` and `(ledger_id, id)` on instances. Associations
contain `ledger_id`, `integration_id`, and `category_id`, with a unique pair and
composite foreign keys to `(ledger_id, id)` on both parents. This enforces tenant
isolation in storage as well as in use cases. Ledger deletion cascades to its
instances and associations. Category archival preserves associations and history;
an eventual hard deletion removes only its association rows.

Enforce positive time limits, `run_timeout_seconds < stale_after_seconds`, and
consistent run timestamp nullability/order. Changes to the two time limits are
allowed only when there is no unfinished run inside its timeout; disabling an
instance remains allowed during execution. All management and
report updates must serialize on the instance row or use an equivalent atomic
compare-and-swap; a read followed by an unguarded write is insufficient.

## Results and derived health

`last_result` answers how the last completed attempt ended. Starting another run
does not erase it or `last_success_at`. A success means the provider check and
all intended Ledger synchronization steps completed, including a valid no-op.
Partial synchronization followed by an error is a failure; already committed
business writes are not rolled back by a health report.

`last_changes_detected` describes meaningful provider/domain changes handled by
the successful run. Writing an identical observation with a new timestamp is
not by itself a change. The provider adapter returns `null` when it cannot
reliably determine this; the wrapper must not guess from HTTP request counts.
A successful check with no available invoice reports `success` and `false`.

Expose independent derived fields:

- `execution_state`: `never_run`, `running`, `timed_out`, or `finished`.
  An unfinished run is `timed_out` when the server time reaches
  `current_started_at + run_timeout_seconds`.
- `is_stale`: for enabled instances, true when server time reaches
  `max(enabled_at, last_finished_at if present) + stale_after_seconds`.
  Starting or retrying a run does not reset this deadline. Disabled instances
  return false; their prior timestamps and results remain visible.
- `health`: the display summary selected in the following precedence order.

| Condition, first matching row wins | Health | Display meaning |
| --- | --- | --- |
| Disabled | `disabled` | Monitoring paused |
| Unfinished run past its timeout | `timed_out` | No completion received for the started run |
| Completion reporting deadline passed | `stale` | No recent completed report, even if a run just started |
| Unfinished run within timeout | `running` | Synchronization in progress |
| No accepted run | `never_run` | Awaiting first run |
| Latest completion failed | `error` | Last attempt failed |
| Latest completion succeeded | `healthy` | Last attempt succeeded, with or without changes |

Both timeouts are computed at read time; no scheduler or database mutation is
required to turn a silent integration stale. Repeated reported failures keep
`is_stale` false but remain errors and do not advance `last_success_at`.
A timeout means missing completion, not a proven provider failure.

Disabling blocks new starts, but accepts a completion for the already accepted
current run. It does not stop a running container or revoke its API key. Re-enable
starts a fresh reporting grace period via `enabled_at`; previous run results
remain visible, and an old unfinished run still obeys its original timeout.
Scheduling and stopping jobs remain deployment responsibilities.

## Proposed API and use cases

All paths below include the existing `/api/v1` prefix. Responses use explicit
public schemas, with the identity, configuration, retained result, current run,
`revision`, and derived health fields. List responses follow `{data, count}` and
support `limit` (1–100, default 100) and nonnegative `offset`.

| Method and path | Access | Use case |
| --- | --- | --- |
| `GET /ledgers/{ledger_id}/integrations` | Existing user ledger view access | `ListIntegrations` |
| `POST /ledgers/{ledger_id}/integrations` | Existing user ledger owner access | `CreateIntegration` |
| `GET /ledgers/{ledger_id}/integrations/{integration_id}` | Existing user ledger view access | `GetIntegration` |
| `PATCH /ledgers/{ledger_id}/integrations/{integration_id}` | Existing user ledger owner access | `UpdateIntegration` |
| `GET /integration/instances/{integration_key}` | Existing API key, `ledger:read` | `GetIntegration` within the key's ledger |
| `POST /integration/instances/{integration_key}/start` | Existing API key, `ledger:write` | `StartIntegrationRun` |
| `POST /integration/instances/{integration_key}/finish` | Existing API key, `ledger:write` | `FinishIntegrationRun` |

Creation accepts `key`, `provider`, `name`, `category_ids` (default empty),
`enabled`, and the two time limits; successful creation returns 201. Updates
accept only `name`, `category_ids`, `enabled`, and the limits, plus the expected
`revision` to reject stale edits. State/result fields cannot be manually patched.
Replacing `category_ids` validates every category before applying any change.
Normal reads, accepted reports, updates, and identical report retries return 200.

API-key reporting bodies must not accept `ledger_id` or category associations.
Unknown instances, associations to inaccessible categories, and cross-ledger
lookups return 404. Invalid bodies or immutable-field edits return 422; duplicate
keys, revision conflicts, disabled starts, and run conflicts return 409 with a
stable machine-readable `detail.code`. Existing key authentication and missing
scope handling remain 401/403. Preserve the existing demo integration capability
gate for both management and reporting routes.

### Start, finish, and retry contract

The runner reads the instance, generates a UUID for this invocation, then sends:

```json
{
  "run_id": "6a1af7e0-0799-43bf-a8c1-497bcf827ac1",
  "expected_revision": 0
}
```

The start rules, evaluated atomically, are:

1. A retry using the current run ID returns existing state without changing
   timestamps or revision, even if that run already finished or was disabled.
   A runner seeing it already finished must not execute it again.
2. A different run requires an enabled instance and matching `expected_revision`.
   A different unfinished run inside its timeout produces `run_in_progress` (409).
3. Otherwise accept the new run, set its server start time, clear its finish time,
   and increment revision. Retain the last completion and last success fields.
   A timed-out run may be superseded; this does not terminate its process.

Revisions prevent a delayed start request from replacing a newer run. On a
conflict, an invocation must not refresh the revision and blindly replay its
old start; it exits without synchronization and leaves a fresh invocation to
retry. Reports never extend a running job's monitoring timeout.

After a successful synchronization, send:

```json
{
  "run_id": "6a1af7e0-0799-43bf-a8c1-497bcf827ac1",
  "result": "success",
  "changes_detected": false,
  "error": null
}
```

For a failure, use `result: "failure"`, `changes_detected: null`, and a required
error object with `code` and `message`. A success requires `error: null` and
allows a nullable boolean for changes. Unknown fields are rejected.

- Finish requires the current run ID; there is no implicit start. A mismatched
  or never-started ID returns `run_conflict` (409), without changing state.
- First finish atomically sets current/last finish timestamps, last result,
  changes, and error, increments revision, and advances last success only for
  success. A failure preserves the previous last success.
- An identical repeated finish returns the retained state without advancing
  any timestamp. A different result/payload for an already finished current run
  returns `run_conflict` (409).
- A late finish after timeout is accepted if its run is still current; the
  result then reflects a received completion. A finish for a superseded run is
  rejected, even if it reports success.

Idempotency is deliberately limited to the currently retained run. Once another
start replaces it, older finish requests return conflict, and old start requests
are rejected by revision. Run UUIDs must never be reused. Do not promise permanent
deduplication or an audit trail without adding a separate retained run store.
This protocol protects monitoring state; it does not fence business writes from
a process that outlives its timeout. Retain the host execution lock and configure
a process timeout independently.

## Runner integration and failure handling

Implement reporting once around the integrations CLI dispatch. Each provider
adapter returns a small typed result containing `changes_detected: bool | None`
or raises a failure; provider logic stays outside Ledger. Existing integrations
without `OBLIDOG_INTEGRATION_KEY` continue unchanged during staged rollout.

For reporting-enabled jobs, read identity/configuration and report start before
provider work. A disabled instance is a deliberate skip. Authentication,
authorization, missing-instance, or conflict responses stop that invocation with
a clear local diagnostic rather than silently falling back to unmonitored work.
Network/server failures use bounded retries of the same request and run ID;
if start cannot be confirmed, stop that invocation with a nonzero exit code.
On the next scheduled invocation, perform a fresh read and use a new run ID.

After an accepted start, always attempt one logical finish (with bounded identical
retries). Report success only after all intended provider and Ledger operations
succeed. If reporting the success itself fails, log that reporting failure and
exit nonzero; do not turn it into a contradictory failure report for the same run.
For provider/synchronization failures, report failure and preserve the original
exception/exit status if reporting also fails. Local logs carry the same run ID
and the detailed traceback with secrets redacted.

If the container is killed, or Ledger cannot receive completion, read-time
timeout/staleness exposes the missing report. A lost success response is safe to
retry while its run remains current. No heartbeat, background worker, retry
queue, or provider-specific exception parser is required in Ledger.

## Relationship to business data and System Run

- `CategoryDataRecord` remains a schema-validated domain observation; an
  operational failure must not create a fake record to carry its error message.
- `ObligationComponent` remains a child of a concrete obligation. Components
  without an integration or external ID remain fully supported.
- Existing `source` / `external_id` values retain their current deduplication
  semantics (per category for observations, per obligation for components).
  Do not replace existing source strings with instance keys during rollout:
  that can create duplicates. Neither field becomes a required foreign key to
  `Integration`; explicit provenance can be designed separately if needed.
- A provider login failure updates integration health only. Recognized invalid
  business data may separately trigger the existing obligation error use case.
  Success never automatically clears an obligation error or marks it ready.
- System Run continues to handle its existing scheduled Ledger tasks and own
  execution records. External integration instances do not become System Run
  steps, and its scheduler does not launch their containers.

## Follow-up implementation slices

These are proposed work packages, not newly created GitHub issues.

| Slice | Repository | Deliverable and acceptance criteria |
| --- | --- | --- |
| 2a: registry and state | `oblidog-ledger` | Migration, models, use cases, owner management API, derived health, start/finish API; tenant isolation and state-transition tests |
| 2b: API clients | `oblidog-ledger`, `oblidog-client-python` | Regenerate frontend and integration OpenAPI contracts and Python client through the existing publication flow; verify reporting schemas and methods are exported |
| 3: runner adoption | `oblidog-integrations` | Common reporting wrapper/result type; adopt eKartoteka, NJU and other registered adapters; environment examples and setup instructions; two accounts sharing one key report independently |
| 4: visible monitoring | `oblidog-ledger` | Ledger integrations page for list/detail and owner configuration; last success, last result, changes, timeout/staleness and sanitized error; viewer read-only behavior and demo gate |

Roll out backend first, then the compatible SDK, then opt individual runner
instances into reporting. Create the registry entries before enabling the new
environment variable. Preserve existing category data, component sources, API
keys, and provider credentials. No backfill of fictional run history or successes.

Required implementation scenarios include:

- Never-run state becomes stale even without a first start; disabled instances
  do not raise stale warnings, and re-enabling gets a fresh grace period.
- Successful no-op, successful change, unknown change, failure after an earlier
  success, and partial synchronization failure have distinct correct results.
- Simultaneous starts, stale management edits, retried start/finish, contradictory
  finishes, delayed starts, and finishes from superseded runs cannot regress state.
- A hung run times out; a fresh start does not hide stale reporting; repeated
  failure reports stay errors despite being recent.
- Same key string in two ledgers is isolated; foreign category associations and
  read-only key writes are rejected; rotating an API key preserves instance state.
- Disabling during execution allows its matching completion, blocks new starts,
  and never claims to stop a container or remove its business-data access.
- Reporting failure cannot mask a provider exception or manufacture success;
  missing configuration preserves the prior unmonitored runner behavior.
- Generated clients expose the intended reporting operations and explicit
  schemas; demo restrictions cover all new routes.

History, mail alerts, remote scheduling, container controls, secret storage,
automatic discovery, and cross-ledger instances are outside this first version.

## Design-phase acceptance mapping

| #115 criterion | Resolution in this document |
| --- | --- |
| Integration ownership/scope defined | Ownership, identity, and configuration |
| Operational state separated from business data | Results and derived health; relationship to business data |
| Lifecycle/status semantics documented | Results and derived health; start, finish, and retry contract |
| Storage and API/use cases proposed | Storage proposal; proposed API and use cases |
| Relationship to category data/components documented | Relationship to business data and System Run |
| Follow-up implementation work can be created | Follow-up implementation slices and acceptance scenarios |
