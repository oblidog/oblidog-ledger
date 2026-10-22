# Dependency maintenance and security coverage

Version updates and vulnerability alerts are separate mechanisms:

- Dependabot opens weekly version-update PRs targeting `dev`.
- GitHub matches dependencies on the default branch (`main`) against advisories.
  Python security-update PRs can target `main` independently of the weekly jobs.
- GitHub statically reads the JavaScript `package.json` files, but does not
  natively read `bun.lock` into the dependency graph. The Bun Dependency Graph
  workflow submits exact registry package versions, including transitive
  dependencies from both the frontend and email workspaces.

## Bun graph submission

The workflow uses the SHA-pinned community action
[pippinmole/bun-dependency-submission](https://github.com/pippinmole/bun-dependency-submission).
It reads the text lockfile without installing dependencies or running package
scripts. PRs and pushes to `dev` validate snapshots with a read-only token;
only `main` publishes a snapshot, with job-scoped `contents: write` permission.
The first publication happens after this workflow reaches `main`. It can also
be run manually on `main`. New advisories are matched by GitHub against the
existing graph; a scheduled resubmission is not needed for that purpose.

After the first successful submission, check **Insights → Dependency graph**
for the `bun.lock` manifest, exact versions and indirect packages, and
**Security → Dependabot** for alerts. A successful dry run on `dev` does not
mean a snapshot has already been published. Graph submission enables advisory
visibility; it does not guarantee that Dependabot can generate a fix PR for
every Bun alert. Such alerts may require a manual lockfile update.

## Update groups

The `web-stack` multi-ecosystem group covers all Bun workspace dependencies and
all images in backend/frontend Dockerfiles. This intentionally broadens the
former Playwright-only batch: the Playwright package and browser image still
travel together, while React, email tooling, Python/Bun/nginx base images and
other dependencies are no longer excluded by the group's patterns. Dependabot
requires non-overlapping directories for entries of the same ecosystem and
target branch, so a second root Bun entry is not used. The existing explicit
ignore for `@hey-api/openapi-ts` is retained.

The web-stack batch has no cooldown so Docker images without publication dates
cannot get ahead of the Playwright package. Review the batch and let CI check
package/browser compatibility before merging. GitHub Actions, Python and Docker
Compose retain their existing weekly groups and seven-day cooldown.

This configuration maintains image references; it does not scan the installed
OS packages inside container images.

Use `chore(deps)` for maintenance. For a security hotfix that must ship to
production, create a focused `fix(deps)` PR based on `main`, validate it, follow
the release process and synchronize `main` back into `dev`. Merging alone does
not update running containers.
