# Authorization regression matrix

`backend/tests/api/routes/test_authorization_isolation.py` exercises the real
FastAPI routes, token verification, access dependencies, use cases and PostgreSQL
queries. Authentication dependencies are not mocked. Browser actors receive
signed user JWTs; integration keys are created through the owner API.

## Roles

| Capability | Owner | Editor | Viewer | Unrelated user | Inactive member | Integration key | Anonymous |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Read ledger resources | Yes | Yes | Yes | No | No | No | No |
| Edit obligations, components, categories, schemas and assignments | Yes | Yes | No | No | No | No | No |
| Preview category counterparty propagation | Yes | Yes | No | No | No | No | No |
| Edit ledger/integration settings and issue credentials | Yes | No | No | No | No | No | No |
| Read global counterparty dictionary | Yes | Yes | Yes | Yes | No | No | No |
| Administer users, global counterparties or System Runs | No | No | No | No | No | No | No |

The owner in this matrix is an ordinary ledger owner, not a superuser. A valid
integration key uses the separate `/integration` API and is bound to one
integration/category/ledger. Existing admin tests cover legitimate superuser
operations. Counterparties are intentionally a global dictionary: ledger
isolation applies to category/obligation assignments, not dictionary visibility.

## Boundaries

- Read matrix: ledger and members; obligations, components and action history;
  category groups, categories, JSON schema, observations and CSV; counterparty
  associations/propagation preview; analytics; integrations and run history.
- Write matrix: owner/editor/viewer differences and complete denial for
  unrelated/inactive users, API keys on browser endpoints and anonymous requests.
- Nested IDs: foreign categories, category groups, components, integrations and
  credentials under a ledger the caller is authorized to access. Includes a
  credential belonging to a different integration in the same ledger.
- Colliding obligation business keys: two ledgers both contain `AUTH-2026-11`.
  Integration reads must return the correct database UUID and ledger; a valid
  integration update must leave the foreign and sibling obligations unchanged.
- Category isolation: legacy sibling-category obligation keys are denied for
  reads, component upsert, notes and lifecycle actions. Scope fields injected
  into observation payloads are rejected.
- Run isolation: one key cannot finish another integration's running run,
  whether the target is in the same ledger or a different ledger. Both keys can
  subsequently finish their legitimate runs.
- Revoked/expired credentials: context, obligations, observations/schema,
  component writes and run start/finish are rejected without database changes.
- Administrative operations: ordinary users cannot list/administer users, run
  system tasks, or create/update/delete global counterparties.

## Assertions and execution

Denied requests must return an authentication/access/not-found error envelope,
without private fixture values or connection secrets. Tests avoid coupling
access denials to 403 versus 404; inactive-user and expired-key behavior uses the
existing authentication contract. A run-ID mismatch is a legitimate 409 conflict.

Database snapshots compare every mapped table before and after denials, including
credentials, action logs and run history. The only omitted column is
`integration_credential.last_used_at`: authenticating an active key can update
usage telemetry before a later authorization or validation denial. Successful
read matrix requests are checked for absence of database mutations too.

Run with the usual backend test environment and a dedicated PostgreSQL database:

```sh
cd backend
uv run pytest tests/api/routes/test_authorization_isolation.py
```

`TEST_SQLALCHEMY_DATABASE_URI` must be set and must differ from the application
DSN. The standard database fixture applies migrations and performs destructive
cleanup only on the explicitly configured test database. Never point it at
production or manual test data.
