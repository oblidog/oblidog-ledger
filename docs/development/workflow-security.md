# GitHub Actions security

External `uses:` references must use verified, full 40-character commit SHAs.
Keep the corresponding version in an inline comment. Resolve tags in the
original action repository and dereference annotated tags to the commit, not
the tag object. Check the release and its changes before accepting a new pin.
Pinning an action does not pin programs or dependencies it downloads at runtime.

Dependabot already monitors the `github-actions` ecosystem against `dev` weekly
and maintains SHA pins and version comments. Version updates have an explicit
seven-day cooldown in each configured ecosystem; security updates remain
separate. Review action updates before merging them.

## Workflow audit

`Workflow Security` runs when workflows, composite actions, Dependabot settings,
or zizmor configuration change, and can also be run manually. It audits the
repository with zizmor 1.31.1, requires only `contents: read`, and has a five-minute
timeout. Findings fail the job and produce annotations. Strict collection also
fails on invalid workflow schemas rather than silently skipping them.

Run the same check locally:

```bash
uvx zizmor==1.31.1 --offline --strict-collection .
python3 -m unittest discover -s tests -p 'test_ci_test_scope.py'
```

The scanner version is intentionally fixed in the workflow. Upgrade it explicitly
and run the local audit before merging. Offline mode audits local configuration
without a GitHub token. It does not run online checks such as known-vulnerable
or ref-confusion lookups; release verification and Dependabot remain necessary.
There are no project-wide disabled audit rules. The issue-linking workflow has
one local `dangerous-triggers` exception for its metadata-only
`pull_request_target` trigger, documented beside the trigger. Any future
exception must be limited to the affected finding and documented beside the
relevant configuration with a concrete reason.

## Credentials and trusted execution

- Every checkout disables credential persistence. Test, dependency-installation,
  and build steps do not need a token stored in Git configuration.
- Release steps that push tags or branches receive `GH_TOKEN` only at that step
  and invoke Git with the temporary `gh auth git-credential` helper. The helper
  configuration applies only to that command and does not embed the token in a URL.
- Write permissions are declared on the release/publishing job that needs them.
  Client regeneration uses its dedicated cross-repository token and no default
  token permissions. Codecov jobs retain OIDC permission for uploads.
- PR tests use `pull_request`, not `pull_request_target`, and check out the merge
  result. Release finalization accepts only merged, same-repository release PRs,
  checks out trusted `main`, and validates the version before using it in outputs
  and Git refs. Image publication validates the published release tag first.
- Demo database credentials are scoped to the lifecycle operation inside the
  existing `demo-preview` environment. The deploy hook is scoped to its own step.
- Pass expression-derived script inputs through environment variables and quote
  their shell expansions instead of interpolating expressions into shell source.
- Issue linking uses `pull_request_target` only for same-repository PR metadata.
  It checks out the immutable trusted base commit with credentials disabled,
  never the PR head. Its job-scoped write permission is limited to issues.
  The helper reads current PR metadata through the API and sends issue links
  as GraphQL variables; it never executes PR text or changes issue state.

The audit does not change `scripts/ci_test_scope.py` or its consumers' skip
conditions: metadata-only release PRs and clean back-sync PRs keep their fast
checks. It adds no backend or E2E test suite.
