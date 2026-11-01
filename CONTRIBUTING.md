# Contributing to Oblidog Ledger

Oblidog Ledger is a private, multi-user payment-obligation application. Before
starting substantial work, open an issue or align the scope with a maintainer.

## Development setup

- Use `uv` for backend dependencies and commands.
- Use Bun for frontend dependencies and commands.
- Copy and configure the required environment values before running the stack.
  See [development.md](./development.md) for local-development details.

```bash
uv sync
bun install --frozen-lockfile
```

## Before opening a pull request

- Keep a change focused on one concern.
- Add or update tests for changed behaviour.
- Regenerate the frontend OpenAPI client after backend API changes:

  ```bash
  bash ./scripts/generate-client.sh
  ```

- Run the relevant checks:

  ```bash
  uv run pre-commit run --all-files
  cd backend && uv run pytest
  bun run --filter frontend build
  ```

## Commits and pull requests

Use Conventional Commit messages, for example:

```text
feat: add ledger member roles
fix: validate recurring category due day
docs: clarify local development setup
```

Pull requests are squash-merged. The pull request title becomes the final
commit on `main`, so it must also follow the Conventional Commits format. This
allows automated release version calculation to treat one merged pull request
as one release-relevant commit.

Commitizen updates the canonical versions in `pyproject.toml` and
`backend/pyproject.toml`. After a version bump, run `uv lock` to regenerate the
lockfile instead of editing its version metadata directly. To determine the
next version without changing files or prompting for input, run:

```bash
bash ./scripts/cz.sh bump --dry-run --yes --get-next
```

## Automated releases

### Issue links for development PRs

For a same-repository PR targeting `dev`, put a closing reference in the PR
description, with one keyword for each issue:

```text
Closes #588
Fixes #589
```

The `Link PR issues` workflow adds the issues to the Development sidebar when
the PR is opened, edited, or reopened. Merging into `dev` leaves the issues open;
the release PR to the default branch `main` carries the closing references.
Only local `#number` references are supported (up to ten); ordinary mentions,
code examples, and HTML comments are ignored. Existing links are preserved,
including manually added links. Removing a reference from the description does
not remove its Development link; unlink it manually if necessary.

### Release generation

After an eligible Conventional Commit is squash-merged to `main`, the Release
workflow uses Commitizen to determine the next version. It updates the
canonical version files and changelog, runs `uv lock`, commits the release,
pushes its `vX.Y.Z` tag, and creates a GitHub Release. Commits with no
release-relevant type produce no release. The workflow uses its release commit
guard in addition to GitHub's `GITHUB_TOKEN` event protection to avoid loops.

Describe the purpose of the pull request, the validation performed, and any
configuration or migration steps required for reviewers. Do not include
credentials, tokens, or production data.

## Reporting issues

Use the GitHub bug-report and feature-request forms for product and development
work. Do not report security vulnerabilities in a public issue; follow
[SECURITY.md](./SECURITY.md) instead.
