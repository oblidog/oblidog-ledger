# Obligation action log

`ObligationActionLog` is an append-only business audit trail for the actions
listed below. It is not a complete record of every write: appending an
integration note, for example, does not create an action entry. It is not an
event-sourcing store and does not replace application or integration logs.

## Recorded actions

| Action | Recorded change |
| --- | --- |
| `created` | Initial lifecycle and value fields |
| `values_updated` | Changed amount, date, state, source, and effective-source fields |
| `components_changed` | Added, updated, and removed component snapshots or diffs |
| `marked_ready` | Lifecycle and implicitly confirmed value states |
| `marked_paid` | Lifecycle and `paid_at` |
| `canceled` | Lifecycle |
| `reopened` | Lifecycle and cleared `paid_at`, when applicable |
| `marked_error` | Lifecycle |

No-op and failed mutations do not create entries. The business mutation and
its action entry are committed in the same database transaction.

## Attribution

Every entry identifies its actor as `user`, `integration`, or `system`.
User-facing routes derive the user identifier and display name from the JWT.
Integration routes derive the integration identifier and name from the API
credential. When the integration has an active run, its `run_id` is copied to
the entry for correlation. Callers cannot supply actor fields directly.

## Reading history

Ledger owners, editors, and viewers can read the newest entries first:

```text
GET /api/v1/ledgers/{ledger_id}/obligations/{obligation_key}/actions
```

The endpoint accepts `limit` (1-100, default 100) and `offset` (default 0), and
returns `data` plus the total `count`. The same ledger access checks and
not-found behavior as the obligation endpoints apply.

Category data records and daily email presentation are separate concerns and
are not written to this log. The obligation detail view displays this log as
an action timeline.
