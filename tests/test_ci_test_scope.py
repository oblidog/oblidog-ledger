"""Exercise scope decisions against real Git merge results without app services."""

from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.ci_test_scope import determine_scope, main


class ScopeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.cwd = Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, self.cwd)
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "ci@example.com")
        self.git("config", "user.name", "CI test")
        self.files = {
            "CHANGELOG.md": "Initial release\n",
            "pyproject.toml": '[tool.commitizen]\nversion = "1.0.0"\n',
            "backend/pyproject.toml": '[project]\nname = "app"\nversion = "1.0.0"\n',
            "frontend/package.json": '{"version":"1.0.0","scripts":{"test":"test"}}\n',
            "uv.lock": 'version = 1\n[[package]]\nname = "app"\nversion = "1.0.0"\nsource = { editable = "backend" }\n[[package]]\nname = "dep"\nversion = "2.0.0"\n',
            "backend/app.py": "value = 1\n",
        }
        self.write(self.files)
        self.commit()
        self.base = self.git("rev-parse", "HEAD").strip()
        self.git("switch", "-q", "-c", "candidate")

    def git(self, *args: str) -> str:
        return subprocess.check_output(
            ["git", *args], text=True, stderr=subprocess.PIPE
        )

    def write(self, changes: dict[str, str]) -> None:
        for name, content in changes.items():
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)

    def commit(self) -> None:
        self.git("add", ".")
        self.git("commit", "-qm", "test")

    def merge_env(self, changes: dict[str, str], sync: bool = False) -> dict[str, str]:
        self.write(changes)
        self.commit()
        head = self.git("rev-parse", "HEAD").strip()
        self.git("switch", "-q", "main")
        if sync:
            # Dev has advanced independently; a clean back-sync must preserve it.
            self.write({"backend/new.py": "dev_only = True\n"})
            self.commit()
            self.base = self.git("rev-parse", "HEAD").strip()
        self.git("merge", "--no-ff", "-qm", "merge", "candidate")
        return {
            "HEAD_REF": "sync/main-to-dev-v1.1.0" if sync else "release/v1.1.0",
            "BASE_REF": "dev" if sync else "main",
            "BASE_SHA": self.base,
            "HEAD_SHA": head,
            "GITHUB_SHA": self.git("rev-parse", "HEAD").strip(),
            "SAME_REPOSITORY": "true",
        }

    def test_normal_branch_runs(self) -> None:
        self.assertTrue(determine_scope({"HEAD_REF": "feature/test"})[0])

    def test_release_versions_and_changelog_skip(self) -> None:
        changes = {
            key: value.replace("1.0.0", "1.1.0")
            for key, value in self.files.items()
            if key != "backend/app.py"
        }
        changes["CHANGELOG.md"] = "New release\n"
        self.assertFalse(determine_scope(self.merge_env(changes))[0])

    def test_back_sync_preserves_advanced_dev_and_skips(self) -> None:
        env = self.merge_env({"CHANGELOG.md": "New release\n"}, sync=True)
        self.assertFalse(determine_scope(env)[0])
        self.assertTrue((self.root / "backend/new.py").exists())

    def test_application_change_runs_even_with_release_prefix(self) -> None:
        env = self.merge_env({"backend/app.py": "value = 2\n"})
        self.assertTrue(determine_scope(env)[0])

    def test_back_sync_application_change_runs(self) -> None:
        env = self.merge_env({"backend/app.py": "value = 2\n"}, sync=True)
        self.assertTrue(determine_scope(env)[0])

    def test_mixed_release_runs(self) -> None:
        env = self.merge_env(
            {"CHANGELOG.md": "New release\n", "backend/app.py": "value = 2\n"}
        )
        self.assertTrue(determine_scope(env)[0])

    def test_configuration_changes_in_allowlisted_files_run(self) -> None:
        for name, content in {
            "pyproject.toml": '[tool.commitizen]\nversion = "1.1.0"\npre_bump_hooks = ["changed"]\n',
            "backend/pyproject.toml": '[project]\nname = "app"\nversion = "1.1.0"\ndependencies = ["changed"]\n',
            "frontend/package.json": '{"version":"1.1.0","scripts":{"test":"changed"}}',
            "uv.lock": self.files["uv.lock"].replace('"2.0.0"', '"3.0.0"'),
        }.items():
            with self.subTest(name=name):
                # Each candidate branches from the original main baseline.
                self.git("switch", "-q", "main")
                self.git("reset", "--hard", self.base)
                self.git("branch", "-f", "candidate", self.base)
                self.git("switch", "-q", "candidate")
                self.assertTrue(determine_scope(self.merge_env({name: content}))[0])

    def test_fork_and_wrong_target_run(self) -> None:
        env = self.merge_env({"CHANGELOG.md": "New release\n"})
        self.assertTrue(determine_scope({**env, "SAME_REPOSITORY": "false"})[0])
        self.assertTrue(determine_scope({**env, "BASE_REF": "dev"})[0])

    def test_stale_merge_provenance_runs(self) -> None:
        env = self.merge_env({"CHANGELOG.md": "New release\n"})
        self.assertTrue(determine_scope({**env, "BASE_SHA": env["HEAD_SHA"]})[0])

    def test_conflict_resolution_that_changes_code_runs(self) -> None:
        self.write({"backend/app.py": "value = 2\n"})
        self.commit()
        head = self.git("rev-parse", "HEAD").strip()
        self.git("switch", "-q", "main")
        self.write({"backend/app.py": "value = 3\n"})
        self.commit()
        base = self.git("rev-parse", "HEAD").strip()
        with self.assertRaises(subprocess.CalledProcessError):
            self.git("merge", "--no-ff", "-m", "merge", "candidate")
        self.write({"backend/app.py": "value = 4\n"})
        self.commit()
        env = {
            "HEAD_REF": "sync/main-to-dev-v1.1.0",
            "BASE_REF": "dev",
            "BASE_SHA": base,
            "HEAD_SHA": head,
            "GITHUB_SHA": self.git("rev-parse", "HEAD").strip(),
            "SAME_REPOSITORY": "true",
        }
        self.assertTrue(determine_scope(env)[0])

    def test_added_file_runs(self) -> None:
        self.assertTrue(
            determine_scope(self.merge_env({"tests/new_test.py": "assert True\n"}))[0]
        )

    def test_deleted_metadata_runs(self) -> None:
        (self.root / "CHANGELOG.md").unlink()
        self.assertTrue(determine_scope(self.merge_env({}))[0])

    def test_mode_change_runs(self) -> None:
        (self.root / "CHANGELOG.md").chmod(0o755)
        self.assertTrue(determine_scope(self.merge_env({}))[0])

    def test_rename_runs(self) -> None:
        (self.root / "CHANGELOG.md").rename(self.root / "OTHER.md")
        self.assertTrue(determine_scope(self.merge_env({}))[0])

    def test_detection_failure_outputs_run_not_skip(self) -> None:
        output = self.root / "output"
        with (
            patch.dict(os.environ, {"GITHUB_OUTPUT": str(output)}, clear=True),
            patch(
                "scripts.ci_test_scope.determine_scope",
                side_effect=ValueError("bad diff"),
            ),
        ):
            main()
        self.assertEqual(output.read_text(), "run_heavy=true\n")

    def test_malformed_metadata_outputs_run_not_skip(self) -> None:
        env = self.merge_env({"frontend/package.json": "broken json"})
        output = self.root / "output"
        with patch.dict(os.environ, {**env, "GITHUB_OUTPUT": str(output)}, clear=True):
            main()
        self.assertEqual(output.read_text(), "run_heavy=true\n")

    def test_unavailable_git_commit_outputs_run_not_skip(self) -> None:
        env = self.merge_env({"CHANGELOG.md": "New release\n"})
        output = self.root / "output"
        with patch.dict(
            os.environ, {**env, "GITHUB_SHA": "missing", "GITHUB_OUTPUT": str(output)}
        ):
            main()
        self.assertEqual(output.read_text(), "run_heavy=true\n")


if __name__ == "__main__":
    unittest.main()
