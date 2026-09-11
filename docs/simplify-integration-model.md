# Refactor: simplify integrations to one category and one dedicated credential

## Summary

Simplify the integration model so that each integration belongs to exactly one category and is accessed through its own dedicated credential.

Creating an integration should become a single user operation: enter a name, select a category, create the integration, and copy the generated connection key. The user should no longer create ledger-wide API keys separately or manually provide a provider identifier, integration key, scopes, ledger ID, or category code.

## Problem

The current setup exposes several independent technical concepts to the user:

- a ledger-scoped API key created in ledger settings;
- manually selected `ledger:read` and `ledger:write` scopes;
- an integration instance created separately;
- a manually entered `provider`;
- a manually entered integration key;
- zero or more category associations;
- both `OBLIDOG_API_KEY` and `OBLIDOG_INTEGRATION_KEY` in the runner configuration.

These concepts are valid for a generic integration platform, but they make the current Oblidog workflow unnecessarily difficult. The existing providers operate on one account and one Oblidog category per configured job.

The current API key also grants access to the entire ledger, even when a runner is responsible for only one category.

## Proposed domain model

Adopt the following rules:

1. One integration belongs to exactly one ledger.
2. One integration belongs to exactly one category.
3. Every integration credential belongs to exactly one integration.
4. A category may have multiple integrations.
5. An integration may temporarily have multiple active credentials to support safe credential rotation.
6. Provider selection remains an implementation detail of `oblidog-integrations` and is not stored by Ledger.

```text
IntegrationCredential -> Integration -> Category -> Ledger
```

Suggested `Integration` fields:

```text
id
ledger_id
category_id
name
enabled
stale_after_seconds
run_timeout_seconds
revision
current run and health fields
timestamps
```

Remove from `Integration`:

- `provider`;
- user-supplied `key` as a runner-facing identifier;
- many-to-many category associations.

Replace the `integration_category` association table with a required `category_id` foreign key on `integration`.

The existing API-key storage may be adapted or renamed to `IntegrationCredential`, but integration credentials must not remain independent ledger-wide resources.

## Credential semantics

The secret connection key should authenticate the runner and resolve its complete authorization context:

```text
credential -> integration -> category -> ledger
```

The runner should only need:

```env
OBLIDOG_URL=https://oblidog.example.com
OBLIDOG_API_KEY=obd_live_...
```

The runner must no longer require:

```env
OBLIDOG_INTEGRATION_KEY=...
```

Provider-specific credentials and adapter selection remain local to `oblidog-integrations`.

An integration credential must only permit access to the integration and category to which it belongs. Requests for obligations or other resources belonging to another category should return `404` without revealing that the resource exists.

Credential scopes must not be selected by the user. Required integration permissions should be assigned automatically.

## Creation UX

The primary flow should be available from the Integrations page and optionally from a category detail page.

1. Click **Add integration**.
2. Enter an integration name.
3. Select exactly one category. When started from a category page, preselect that category.
4. Click **Create integration**.
5. Create the integration and its first credential atomically.
6. Display the full secret exactly once.

The completion screen should provide:

- **Copy configuration**;
- optionally **Download `.env`**;
- a clear warning that the key will not be displayed again.

Use the user-facing term **Connection key**. `API key` may remain an internal or developer-facing term.

The creation form must not expose:

- provider;
- integration key;
- API scopes;
- ledger ID;
- monitoring timeouts unless placed under advanced settings.

## Credential management UX

Remove the independent API Keys section from normal ledger settings.

Credential management should live on the integration detail page and show:

- creation date;
- last-used date;
- expiry, if supported;
- revoked state;
- **Generate new key**;
- **Revoke key**.

The full secret must only be returned immediately after creation or rotation. Losing a secret requires generating a replacement.

General-purpose user or developer access tokens are outside this model. If a public Oblidog API is introduced later, it should use a separate `PersonalAccessToken` concept rather than integration credentials.

## Integration-facing API

The integration API should be contextual. Ledger, integration, and category are resolved from the credential rather than supplied by the caller.

### Remove

```http
GET   /api/v1/integration/ledger
PATCH /api/v1/integration/ledger
GET   /api/v1/integration/instances/{integration_key}
POST  /api/v1/integration/instances/{integration_key}/start
POST  /api/v1/integration/instances/{integration_key}/finish
```

Also remove:

- `category_code` from category-data paths;
- `category_code` filters from integration obligation listing;
- all runner-facing `integration_key` parameters.

### Add or replace with contextual routes

```http
GET  /api/v1/integration/context
POST /api/v1/integration/runs/start
POST /api/v1/integration/runs/finish

GET  /api/v1/integration/category/schema
GET  /api/v1/integration/category/data-records
GET  /api/v1/integration/category/data-records/latest
POST /api/v1/integration/category/data-records

GET   /api/v1/integration/obligations
GET   /api/v1/integration/obligations/{obligation_key}
PATCH /api/v1/integration/obligations/{obligation_key}
```

Existing obligation lifecycle, note, and component routes may remain, but every operation must enforce the category resolved from the credential.

`GET /integration/context` should return only the minimum runner configuration, for example:

```json
{
  "integration": {
    "id": "...",
    "name": "NJU - Mario",
    "enabled": true,
    "revision": 4
  },
  "category": {
    "id": "...",
    "code": "TELM",
    "name": "Telefon Mario"
  }
}
```

It must not return or update the complete `LedgerPublic` resource.

## User-facing management API

Management routes authenticated with the normal user session remain available:

```http
GET   /api/v1/ledgers/{ledger_id}/integrations
POST  /api/v1/ledgers/{ledger_id}/integrations
GET   /api/v1/ledgers/{ledger_id}/integrations/{integration_id}
PATCH /api/v1/ledgers/{ledger_id}/integrations/{integration_id}
```

Creation should accept only the user-configurable data:

```json
{
  "name": "NJU - Mario",
  "category_id": "..."
}
```

The successful creation response should return the integration and the newly generated secret once. Integration and credential creation must be transactional so that a partial setup is not persisted.

Rotation should use a dedicated action on the integration rather than the old ledger-level API-key endpoints.

## Remove legacy API-key management

Remove the ledger-wide API-key workflow:

- independent API Keys settings card;
- manual API-key creation;
- manual selection of `ledger:read` and `ledger:write`;
- ledger-level API-key listing and revocation endpoints;
- support for sharing one credential between several integration instances.

Do not keep both models in the final product. A temporary compatibility period is acceptable only for migration.

## Migration and rollout

Existing ledger-scoped API keys cannot be safely assigned automatically because one key may currently serve multiple integrations.

Use a staged rollout:

1. Add the required `category_id` relationship and integration-owned credentials.
2. Migrate existing category associations only when an integration has exactly one associated category; flag all other cases for manual resolution.
3. Generate a new credential for each existing integration.
4. Update `oblidog-client-python` and `oblidog-integrations` to use credential-derived context.
5. Replace the configured keys on each runner.
6. Confirm at least one successful run using every new credential.
7. Revoke the legacy ledger-scoped keys.
8. Remove legacy API endpoints, schemas, UI, and environment variables.

The rollout must preserve current integration health state and run history/state fields. Rotating credentials must not reset monitoring state.

## Out of scope

- OAuth connections to external providers;
- storing provider usernames or passwords in Ledger;
- dynamically discovering providers;
- one integration writing to multiple categories;
- public API access for users or third-party applications;
- automatically deploying or scheduling runner containers.

These capabilities should only be introduced when a concrete use case requires them.

## Acceptance criteria

- [ ] Creating an integration requires a name and exactly one category.
- [ ] Provider and runner-facing integration key are no longer part of the Ledger integration model.
- [ ] Integration creation atomically creates the first credential.
- [ ] The secret is returned and displayed exactly once.
- [ ] The UI provides a copyable runner configuration containing only Oblidog URL and connection key.
- [ ] The credential resolves the ledger, integration, and category without caller-supplied identifiers.
- [ ] Integration endpoints cannot access obligations or category data outside the assigned category.
- [ ] Cross-category resource access returns `404`.
- [ ] Start and finish reporting do not require an integration key in the URL or request configuration.
- [ ] The integration API cannot read or update the complete ledger resource.
- [ ] The independent ledger API-key management UI and endpoints are removed after migration.
- [ ] Credentials can be rotated without resetting integration health.
- [ ] Existing integrations receive dedicated credentials before legacy keys are revoked.
- [ ] Frontend and Python clients are regenerated for the final API contract.
- [ ] `oblidog-integrations` no longer requires `OBLIDOG_INTEGRATION_KEY`.
- [ ] Backend authorization and tenant-isolation tests cover the new credential context.
- [ ] End-to-end tests cover creation, one-time secret display, rotation, revocation, and forbidden cross-category access.

## Repositories affected

- `oblidog/oblidog-ledger`
- `oblidog/oblidog-client-python`
- `oblidog/oblidog-integrations`

## Breaking-change note

This is an intentional breaking change to the integration API and runner configuration. It should be released only after the new Python client and runner support are ready and the deployment migration order is documented.
