"""Select CI checks from a verified merge result, running all on uncertainty."""

from __future__ import annotations

import json
import os
import subprocess
import tomllib
from pathlib import Path, PurePosixPath


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True)


def metadata(path: str, content: str) -> object:
    """Remove only the version fields owned by Commitizen, preserving other data."""
    if path == "frontend/package.json":
        data = json.loads(content)
        version = data.pop("version")
    else:
        data = tomllib.loads(content)
        if path == "pyproject.toml":
            version = data["tool"]["commitizen"].pop("version")
        elif path == "backend/pyproject.toml":
            version = data["project"].pop("version")
        elif path == "uv.lock":
            packages = [
                package
                for package in data["package"]
                if package.get("name") == "app"
                and package.get("source") == {"editable": "backend"}
            ]
            if len(packages) != 1:
                raise ValueError("Expected exactly one editable backend package")
            version = packages[0].pop("version")
        else:
            raise ValueError(f"Not release metadata: {path}")
    if not isinstance(version, str) or not version:
        raise ValueError("Missing project version")
    return data


def determine_scope(env: dict[str, str]) -> tuple[bool, str]:
    branch = env.get("HEAD_REF", "")
    target = env.get("BASE_REF", "")
    eligible = (branch.startswith("release/v") and target == "main") or (
        branch.startswith("sync/main-to-dev-") and target == "dev"
    )
    if not eligible or env.get("SAME_REPOSITORY") != "true":
        return True, "Normal or untrusted PR: run tests"

    base, head, merge = (env[key] for key in ("BASE_SHA", "HEAD_SHA", "GITHUB_SHA"))
    # Inspect the actual PR merge result, including conflict resolutions. If the
    # event no longer describes this merge commit, do not reuse the skip.
    parents = git("rev-list", "--parents", "-n", "1", merge).split()[1:]
    if parents != [base, head]:
        return True, "Merge provenance unavailable or stale: run tests"

    paths = git("diff", "--name-only", "--no-renames", "-z", base, merge).split("\0")
    for path in filter(None, paths):
        # Added/deleted files and mode changes are not version-only updates.
        for ref in (base, merge):
            entry = git("ls-tree", ref, "--", path).split()
            if len(entry) < 3 or entry[0] != "100644" or entry[1] != "blob":
                return True, f"File addition, deletion or mode change: {path}"
        if path == "CHANGELOG.md":
            continue
        if path not in {
            "pyproject.toml",
            "backend/pyproject.toml",
            "frontend/package.json",
            "uv.lock",
        }:
            return True, f"Change outside release metadata: {path}; run tests"
        before = metadata(path, git("show", f"{base}:{path}"))
        after = metadata(path, git("show", f"{merge}:{path}"))
        if before != after:
            return True, f"Non-version change in {path}: run tests"
    return False, "Merge result changes only allowed release metadata (or no files)"


def component_scope(env: dict[str, str]) -> dict[str, bool]:
    """Skip unrelated checks only for a trusted, current PR merge result.

    Unknown paths are deliberately shared. New tooling must not silently lose
    coverage just because it is missing from a component's allowlist.
    """
    all_checks = dict.fromkeys(("backend", "frontend", "quality"), True)
    if env.get("SAME_REPOSITORY") != "true":
        return all_checks
    base, head, merge = (env[key] for key in ("BASE_SHA", "HEAD_SHA", "GITHUB_SHA"))
    parents = git("rev-list", "--parents", "-n", "1", merge).split()[1:]
    if parents != [base, head]:
        return all_checks

    checks = dict.fromkeys(all_checks, False)
    # Include both sides of renames and deleted paths when deciding coverage.
    paths = git("diff", "--name-only", "--no-renames", "-z", base, merge).split("\0")
    for path in filter(None, paths):
        if path.startswith("backend/"):
            checks["backend"] = checks["quality"] = True
        elif path.startswith("frontend/"):
            checks["frontend"] = True
            # The backend contract suite verifies these catalogs against ErrorCode.
            if PurePosixPath(path).match("frontend/src/i18n/locales/*/errors.json"):
                checks["backend"] = True
        elif (
            path.startswith(("emails/", "tests/"))
            and path != "tests/test_ci_test_scope.py"
        ):
            checks["backend"] = True
        elif path.startswith("docs/") or path in {
            "README.md",
            "CHANGELOG.md",
            "CONTRIBUTING.md",
            "CODE_OF_CONDUCT.md",
            "SECURITY.md",
            "AGENTS.md",
            "development.md",
            "LICENSE",
        }:
            continue
        else:
            return all_checks
    return checks


def main() -> None:
    try:
        run_heavy, reason = determine_scope(dict(os.environ))
        checks = (
            component_scope(dict(os.environ))
            if run_heavy
            else dict.fromkeys(("backend", "frontend", "quality"), False)
        )
    except (
        KeyError,
        ValueError,
        TypeError,
        subprocess.SubprocessError,
        OSError,
    ) as exc:
        run_heavy, reason = True, f"Scope detection failed: {exc}; run tests"
        checks = dict.fromkeys(("backend", "frontend", "quality"), True)
    print(reason)
    print(f"Component checks: {checks}")
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
        output.write(f"run_heavy={str(run_heavy).lower()}\n")
        output.writelines(
            f"run_{component}={str(enabled).lower()}\n"
            for component, enabled in checks.items()
        )


if __name__ == "__main__":
    main()
