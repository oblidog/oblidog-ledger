"""Database-free checks for the React Email → Jinja contract and packaged assets."""

import copy
import json
from pathlib import Path

import pytest
from jinja2 import TemplateNotFound

from backend.app.email_rendering import render_email_template

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "emails" / "fixtures"


def fixture(name: str = "normal") -> dict:
    return json.loads((FIXTURES / f"{name}.json").read_text())


def render(report: dict, extension: str = "html") -> str:
    return render_email_template(
        template_name=f"foundation.{extension}", context={"report": report}
    )


@pytest.mark.parametrize(
    "name",
    ["empty", "normal", "long-name", "long-list", "multi-ledger", "multi-currency"],
)
@pytest.mark.parametrize("extension", ["html", "txt"])
def test_all_synthetic_fixtures_render_without_build_time_data(
    name: str, extension: str
) -> None:
    report = fixture(name)
    output = render(report, extension)
    assert "{%" not in output
    assert "{{" not in output
    assert "OBLIDOG_JINJA_" not in output
    assert report["title"] in output
    for ledger in report["ledgers"]:
        expected_name = (
            ledger["name"].replace("&", "&amp;")
            if extension == "html"
            else ledger["name"]
        )
        assert expected_name in output
        for group in ledger["groups"]:
            assert group["currency"] in output
            for obligation in group["obligations"]:
                assert obligation["url"] in output
    if not report["ledgers"]:
        assert "No obligations in this snapshot." in output


def test_runtime_collections_conditions_and_currencies_are_not_frozen() -> None:
    report = fixture("multi-currency")
    report["notice"] = "Runtime-only notice"
    duplicate = copy.deepcopy(report["ledgers"][0])
    duplicate["name"] = "Runtime-only ledger"
    report["ledgers"].append(duplicate)
    for extension in ("html", "txt"):
        output = render(report, extension)
        assert "Runtime-only notice" in output
        assert "Runtime-only ledger" in output
        assert output.count("Project hosting") == 2
        assert "24.90 EUR" in output
        assert "Amount not confirmed" in output
    report["ledgers"] = []
    report["notice"] = None
    output = render(report)
    assert "Runtime-only notice" not in output
    assert "Runtime-only ledger" not in output
    assert "Project hosting" not in output
    assert "No obligations in this snapshot." in output


def test_html_context_is_escaped_once_without_reinterpreting_jinja() -> None:
    report = fixture()
    malicious = '<img src=x onerror="alert(1)"> & {{ 7 * 7 }}'
    report["project_name"] = malicious
    report["notice"] = malicious
    report["ledgers"][0]["name"] = malicious
    row = report["ledgers"][0]["groups"][0]["obligations"][0]
    row["name"] = malicious
    row["url"] = 'https://example.com/?a=1&b="quoted"'
    output = render(report)
    assert "<img src=x" not in output
    assert "&lt;img src=x onerror=&#34;alert(1)&#34;&gt; &amp; {{ 7 * 7 }}" in output
    assert 'href="https://example.com/?a=1&amp;b=&#34;quoted&#34;"' in output
    assert "&amp;lt;" not in output
    text = render(report, "txt")
    assert malicious in text
    assert row["url"] in text


def test_existing_transactional_html_also_escapes_context() -> None:
    output = render_email_template(
        template_name="test_email.html",
        context={"project_name": "<script>bad()</script>", "email": "a&b@example.com"},
    )
    assert "<script>bad()" not in output
    assert "&lt;script&gt;bad()&lt;/script&gt;" in output
    assert "a&amp;b@example.com" in output


def test_template_loader_does_not_read_outside_packaged_directory() -> None:
    with pytest.raises(TemplateNotFound):
        render_email_template(template_name="../../utils.py", context={})
