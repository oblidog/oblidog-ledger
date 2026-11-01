"""Exercise scope decisions against real Git merge results without app services."""

from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.ci_test_scope import component_scope, determine_scope, main


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

    def normal_env(self, changes: dict[str, str]) -> dict[str, str]:
        return {**self.merge_env(changes), "HEAD_REF": "feature/test"}

    def test_frontend_only_skips_backend(self) -> None:
        env = self.normal_env({"frontend/src/page.tsx": "export default 1\n"})
        self.assertEqual(
            component_scope(env),
            {
                "backend": False,
                "frontend": True,
                "quality": False,
            },
        )

    def test_backend_only_skips_frontend(self) -> None:
        env = self.normal_env({"backend/app.py": "value = 2\n"})
        self.assertEqual(
            component_scope(env),
            {
                "backend": True,
                "frontend": False,
                "quality": True,
            },
        )

    def test_error_catalogs_run_backend_contract_checks(self) -> None:
        for language in ("en", "pl", "de", "future-language"):
            with self.subTest(language=language):
                self.git("switch", "-q", "main")
                self.git("reset", "--hard", self.base)
                self.git("switch", "-q", "candidate")
                self.git("reset", "--hard", self.base)
                env = self.normal_env(
                    {f"frontend/src/i18n/locales/{language}/errors.json": "{}\n"}
                )
                self.assertEqual(
                    component_scope(env),
                    {
                        "backend": True,
                        "frontend": True,
                        "quality": False,
                    },
                )

    def test_other_frontend_catalogs_still_skip_backend(self) -> None:
        env = self.normal_env({"frontend/src/i18n/locales/en/common.json": "{}\n"})
        self.assertEqual(
            component_scope(env),
            {
                "backend": False,
                "frontend": True,
                "quality": False,
            },
        )

    def test_docs_only_skips_component_checks(self) -> None:
        env = self.normal_env({"docs/guide.md": "Guide\n"})
        self.assertFalse(any(component_scope(env).values()))

    def test_shared_dependency_change_runs_all(self) -> None:
        env = self.normal_env({"bun.lock": "changed dependencies\n"})
        self.assertTrue(all(component_scope(env).values()))

    def test_scope_policy_change_runs_all(self) -> None:
        env = self.normal_env({"tests/test_ci_test_scope.py": "changed policy\n"})
        self.assertTrue(all(component_scope(env).values()))

    def test_unknown_path_runs_all(self) -> None:
        env = self.normal_env({"new-tool/config.json": "{}\n"})
        self.assertTrue(all(component_scope(env).values()))

    def test_email_change_runs_backend(self) -> None:
        env = self.normal_env({"emails/src/template.tsx": "changed template\n"})
        self.assertEqual(
            component_scope(env),
            {
                "backend": True,
                "frontend": False,
                "quality": False,
            },
        )

    def test_rename_across_components_runs_both(self) -> None:
        (self.root / "backend/app.py").rename(self.root / "frontend/moved.py")
        env = self.normal_env({})
        self.assertTrue(all(component_scope(env).values()))

    def test_deleted_backend_file_still_runs_backend(self) -> None:
        (self.root / "backend/app.py").unlink()
        env = self.normal_env({})
        self.assertTrue(component_scope(env)["backend"])

    def test_untrusted_or_stale_component_diff_runs_all(self) -> None:
        env = self.normal_env({"docs/guide.md": "Guide\n"})
        for overrides in ({"SAME_REPOSITORY": "false"}, {"BASE_SHA": env["HEAD_SHA"]}):
            self.assertTrue(all(component_scope({**env, **overrides}).values()))

    def test_manual_run_runs_all(self) -> None:
        self.assertTrue(all(component_scope({}).values()))

    def test_main_emits_frontend_only_scope(self) -> None:
        env = self.normal_env({"frontend/src/page.tsx": "export default 1\n"})
        output = self.root / "output"
        with patch.dict(os.environ, {**env, "GITHUB_OUTPUT": str(output)}, clear=True):
            main()
        self.assertEqual(
            output.read_text(),
            "run_heavy=true\nrun_backend=false\nrun_frontend=true\nrun_quality=false\n",
        )

    def test_main_preserves_release_metadata_skip(self) -> None:
        env = self.merge_env({"CHANGELOG.md": "Release notes\n"})
        output = self.root / "output"
        with patch.dict(os.environ, {**env, "GITHUB_OUTPUT": str(output)}, clear=True):
            main()
        self.assertEqual(
            output.read_text(),
            "run_heavy=false\nrun_backend=false\nrun_frontend=false\nrun_quality=false\n",
        )

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
        self.assertEqual(
            output.read_text(),
            "run_heavy=true\nrun_backend=true\nrun_frontend=true\nrun_quality=true\n",
        )

    def test_malformed_metadata_outputs_run_not_skip(self) -> None:
        env = self.merge_env({"frontend/package.json": "broken json"})
        output = self.root / "output"
        with patch.dict(os.environ, {**env, "GITHUB_OUTPUT": str(output)}, clear=True):
            main()
        self.assertEqual(
            output.read_text(),
            "run_heavy=true\nrun_backend=true\nrun_frontend=true\nrun_quality=true\n",
        )

    def test_unavailable_git_commit_outputs_run_not_skip(self) -> None:
        env = self.merge_env({"CHANGELOG.md": "New release\n"})
        output = self.root / "output"
        with patch.dict(
            os.environ, {**env, "GITHUB_SHA": "missing", "GITHUB_OUTPUT": str(output)}
        ):
            main()
        self.assertEqual(
            output.read_text(),
            "run_heavy=true\nrun_backend=true\nrun_frontend=true\nrun_quality=true\n",
        )


if __name__ == "__main__":
    unittest.main()
