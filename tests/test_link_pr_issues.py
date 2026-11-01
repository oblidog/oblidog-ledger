"""Verify issue links never change issue state or execute PR content."""

from __future__ import annotations

import copy
import json
import os
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import link_pr_issues as linker


class LinkIssuesTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        event = Path(temporary.name) / "event.json"
        event.write_text(json.dumps({"pull_request": {"number": 600}}))
        environment = patch.dict(
            os.environ,
            {
                "GITHUB_EVENT_PATH": str(event),
                "GITHUB_REPOSITORY": "oblidog/oblidog-ledger",
            },
        )
        environment.start()
        self.addCleanup(environment.stop)
        self.pr = {
            "number": 600,
            "node_id": "PR_600",
            "state": "open",
            "base": {"ref": "dev"},
            "head": {"repo": {"full_name": "oblidog/oblidog-ledger"}},
            "body": "Closes #588",
        }

    def test_only_explicit_local_closing_references(self) -> None:
        body = """
        Closes #588. FIXES #589; resolves #588.
        Related #590; fixes other/repo#591; closes https://github.com/a/b/issues/592
        <!-- Closes #593 -->
        `Closes #594`
        ```text
        Closes #595
        ```
        ~~~
        Closes #596
        ~~~
        """
        self.assertEqual(linker.issue_numbers(textwrap.dedent(body)), [588, 589])

    def test_indented_code_is_ignored(self) -> None:
        for indentation in ("    ", "\t", "  \t"):
            with self.subTest(indentation=indentation):
                body = f"Example:\n\n{indentation}Closes #588\n\nCloses #589"
                self.assertEqual(linker.issue_numbers(body), [589])

    def test_fences_require_matching_character_and_length(self) -> None:
        examples = [
            "````markdown\n```text\nCloses #588\n```\n````",
            "~~~~markdown\n~~~\nCloses #588\n~~~\n~~~~~",
            "```text\n~~~\nCloses #588\n```",
            "   ````text\n```\nCloses #588\n   ````",
            "```text\n``` not a closing fence\nCloses #588\n```",
        ]
        for example in examples:
            with self.subTest(example=example):
                self.assertEqual(
                    linker.issue_numbers(f"{example}\n\nCloses #589"), [589]
                )

    def test_unclosed_fence_hides_remaining_examples(self) -> None:
        self.assertEqual(
            linker.issue_numbers("Closes #589\n\n````text\n```\nCloses #588"),
            [589],
        )

    def test_inline_code_uses_matching_backtick_runs(self) -> None:
        for example in (
            "``example ` Closes #588 ` end``",
            "`example\nCloses #588`",
            "``example ``` Closes #588 ``` end``",
        ):
            with self.subTest(example=example):
                self.assertEqual(
                    linker.issue_numbers(f"{example}\n\nCloses #589"), [589]
                )

    def test_prose_and_list_references_are_preserved(self) -> None:
        self.assertEqual(
            linker.issue_numbers("Closes #588\n\n- Fixes #589\n  - Resolves #590"),
            [588, 589, 590],
        )

    def run_linker(self, issue: dict | None) -> list:
        with patch.object(
            linker,
            "api",
            side_effect=[self.pr, {"data": {"repository": {"issue": issue}}}, {}],
        ) as api:
            linker.main()
        return api.call_args_list

    def test_adds_development_link_without_state_update(self) -> None:
        calls = self.run_linker(
            {"id": "I_588", "closedByPullRequestsReferences": {"nodes": []}}
        )
        self.assertEqual(len(calls), 3)
        payload = calls[-1].args[1]
        self.assertIn("addCloseIssueReferences", payload["query"])
        self.assertEqual(
            payload["variables"],
            {"input": {"issueId": "I_588", "pullRequestIds": ["PR_600"]}},
        )
        self.assertNotIn("closeIssue(", payload["query"])

    def test_existing_manual_link_is_not_added_again(self) -> None:
        calls = self.run_linker(
            {
                "id": "I_588",
                "closedByPullRequestsReferences": {"nodes": [{"id": "PR_600"}]},
            }
        )
        self.assertEqual(len(calls), 2)

    def test_non_issue_is_not_linked(self) -> None:
        self.assertEqual(len(self.run_linker(None)), 2)

    def test_latest_metadata_controls_linking(self) -> None:
        changes = [
            {"state": "closed"},
            {"base": {"ref": "main"}},
            {"head": {"repo": {"full_name": "someone/fork"}}},
            {"head": {"repo": None}},
            {"body": None},
            {"body": "Related #588"},
        ]
        for change in changes:
            with self.subTest(change=change):
                pr = copy.deepcopy(self.pr)
                pr.update(change)
                with patch.object(linker, "api", return_value=pr) as api:
                    linker.main()
                self.assertEqual(api.call_count, 1)

    def test_limit_is_checked_before_mutations(self) -> None:
        self.pr["body"] = "\n".join(f"Closes #{n}" for n in range(1, 12))
        with (
            patch.object(linker, "api", return_value=self.pr) as api,
            self.assertRaises(ValueError),
        ):
            linker.main()
        self.assertEqual(api.call_count, 1)

    def test_graphql_errors_are_not_reported_as_success(self) -> None:
        result = subprocess.CompletedProcess(
            [], 0, stdout=json.dumps({"errors": [{"message": "Forbidden"}]})
        )
        with (
            patch.object(linker.subprocess, "run", return_value=result),
            self.assertRaises(RuntimeError),
        ):
            linker.api("graphql", {"query": "query { viewer { login } }"})


if __name__ == "__main__":
    unittest.main()
