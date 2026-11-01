"""Add Development links for closing references in same-repository PRs to dev."""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path


def issue_numbers(body: str) -> list[int]:
    # Examples and hidden template instructions must not create links.
    body = re.sub(
        r"<!--.*?-->|```.*?```|~~~.*?~~~|`[^`\n]*`", "", body, flags=re.DOTALL
    )
    return sorted(
        {
            int(number)
            for number in re.findall(
                r"\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#([1-9]\d*)\b",
                body,
                flags=re.IGNORECASE,
            )
        }
    )


def api(endpoint: str, payload: dict | None = None) -> dict:
    command = ["gh", "api", endpoint]
    if payload is not None:
        command.extend(["--input", "-"])
    result = subprocess.run(
        command,
        input=json.dumps(payload) if payload is not None else None,
        text=True,
        capture_output=True,
        check=True,
        timeout=60,
    )
    data = json.loads(result.stdout)
    if data.get("errors"):
        raise RuntimeError(f"GitHub GraphQL errors: {data['errors']}")
    return data


def main() -> None:
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    repository = os.environ["GITHUB_REPOSITORY"]
    # Re-read metadata so queued edits cannot reintroduce obsolete references.
    pr = api(f"repos/{repository}/pulls/{int(event['pull_request']['number'])}")
    if (
        pr["state"] != "open"
        or pr["base"]["ref"] != "dev"
        or (pr["head"].get("repo") or {}).get("full_name") != repository
    ):
        return

    numbers = issue_numbers(pr.get("body") or "")
    if len(numbers) > 10:
        raise ValueError("At most 10 issues can be linked to a pull request.")

    owner, name = repository.split("/")
    for number in numbers:
        data = api(
            "graphql",
            {
                "query": """
                    query($owner: String!, $name: String!, $number: Int!) {
                      repository(owner: $owner, name: $name) {
                        issue(number: $number) {
                          id
                          closedByPullRequestsReferences(first: 100) {
                            nodes { id }
                          }
                        }
                      }
                    }
                """,
                "variables": {"owner": owner, "name": name, "number": number},
            },
        )
        issue = data["data"]["repository"]["issue"]
        if issue is None:
            print(f"Skipping #{number}: not an issue in this repository.")
            continue
        linked = issue.get("closedByPullRequestsReferences") or {"nodes": []}
        if any(node["id"] == pr["node_id"] for node in linked["nodes"]):
            continue
        api(
            "graphql",
            {
                "query": """
                    mutation($input: AddCloseIssueReferencesInput!) {
                      addCloseIssueReferences(input: $input) { issue { id } }
                    }
                """,
                "variables": {
                    "input": {
                        "issueId": issue["id"],
                        "pullRequestIds": [pr["node_id"]],
                    }
                },
            },
        )
        print(f"Linked #{number} to PR #{pr['number']}; issue state unchanged.")


if __name__ == "__main__":
    main()
