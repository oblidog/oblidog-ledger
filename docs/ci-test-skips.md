# Release and back-sync test skips

Backend, frontend unit and Playwright workflows share `scripts/ci_test_scope.py`.
Normal PRs retain their existing test execution (including Playwright path filters).
The skip preserves the CI optimization introduced by PR #326; it does not add
another heavy test run to normal releases.

A skip is eligible only for a same-repository `release/v*` PR targeting `main`,
or a `sync/main-to-dev-*` PR targeting `dev`. The policy checks that the checked-out
PR merge commit has the exact base and head parents from the event. It compares
that merge result against the target branch, rather than assuming the source
branch name proves that its changes are safe.

Only these changes may skip tests:

| File | Allowed change |
| --- | --- |
| `CHANGELOG.md` | Content updates |
| `pyproject.toml` | `tool.commitizen.version` only |
| `backend/pyproject.toml` | `project.version` only |
| `frontend/package.json` | Top-level `version` only |
| `uv.lock` | Version of the editable `app` package from `backend` only |

TOML and JSON are compared as parsed data after removing only those version
fields. Dependency updates, scripts and other configuration changes run tests.
Added/deleted files, renames and executable/symlink mode changes run tests too.
A merge result identical to the target branch can also skip tests.

For back-sync, the resulting code must remain identical to `dev`. This allows
`dev` to advance independently while syncing release metadata. A conflict
resolution or extra source change that alters the resulting code runs tests.

Missing Git history, stale merge provenance or malformed metadata defaults to
running tests. A failed Playwright `changes` job fails its required aggregation;
only the test job may be intentionally skipped. Scope decisions are logged.

Run the policy regression tests without Docker or application dependencies:

```bash
python3 -m unittest discover -s tests -p 'test_ci_test_scope.py'
```

The backend workflow runs these fast policy tests for every PR, including
release and back-sync PRs.
