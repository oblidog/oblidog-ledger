"""Database-free presentation regressions for the real daily digest templates."""

import copy
import importlib
import json
from datetime import date
from decimal import Decimal
from html.parser import HTMLParser
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.app.email_rendering import render_email_template
from backend.app.services.daily_digest_presentation import build_daily_digest

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "emails" / "fixtures" / "daily"


def row(
    name="Synthetic obligation",
    amount="12.00",
    currency="PLN",
    state="confirmed",
    due=date(2026, 10, 16),
    due_state="confirmed",
    ledger="Household",
    link="https://example.com/obligation",
):
    return SimpleNamespace(
        category_name=name,
        amount=Decimal(amount) if amount is not None else None,
        currency=currency,
        amount_state=state,
        due_date=due,
        due_date_state=due_state,
        ledger_name=ledger,
        link=link,
    )


def digest(sections, activity=0, health=0):
    return build_daily_digest(
        sections=sections, activity_count=activity, integration_count=health
    )


def fixture(name="normal"):
    return json.loads((FIXTURES / f"{name}.json").read_text())


def render(context, extension="html"):
    return render_email_template(
        template_name=f"daily_obligation_report.{extension}", context=context
    )


class MailLinks(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.links = []
        self.text = []
        self.feed(html)

    def handle_data(self, data):
        self.text.append(data)

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.links.extend(value for key, value in attrs if key == "href")


@pytest.mark.parametrize(
    "path", sorted(FIXTURES.glob("*.json")), ids=lambda path: path.stem
)
@pytest.mark.parametrize("extension", ["html", "txt"])
def test_daily_fixtures_keep_every_dynamic_row_link_and_operational_detail(
    path, extension
):
    context = json.loads(path.read_text())
    output = render(context, extension)
    assert "OBLIDOG_JINJA_" not in output
    assert "{%" not in output
    assert "{{" not in output
    parsed = MailLinks(output) if extension == "html" else None
    links = parsed.links if parsed is not None else None
    output = "".join(parsed.text) if parsed is not None else output
    for section in context["digest"]["sections"]:
        assert section["title"] in output
        for ledger in section["ledgers"]:
            for item in ledger["obligations"]:
                assert (
                    item["link"] in links
                    if links is not None
                    else item["link"] in output
                )
                assert item["amount_label"] in output
                assert item["amount_detail"] in output
                assert item["due_label"] in output
    for entries in context["activity"].values():
        for entry in entries:
            assert (
                entry["link"] in links if links is not None else entry["link"] in output
            )
            assert entry["actor_name"] in output
            for message in entry["messages"]:
                assert message in output
            if entry["omitted_changes"]:
                assert f"And {entry['omitted_changes']} more changes" in output
    for entries in context["integration_health"].values():
        for entry in entries:
            assert (
                entry["link"] in links if links is not None else entry["link"] in output
            )
            assert entry["detail"] in output
            if entry["last_success_at"]:
                assert entry["last_success_at"] in output
    if context["activity_truncated"]:
        assert "Additional activity was omitted" in output
    if context["integration_health_truncated"]:
        assert "Additional unhealthy integrations were omitted" in output


def test_priority_order_is_stable_and_earlier_due_dates_come_first():
    presented = digest(
        {
            "missing_due_date": [row("Missing", due=None)],
            "ready_to_pay": [row("Ready")],
            "errors": [row("Error")],
            "needs_preparation": [row("Prepare")],
            "overdue": [
                row("Later", due=date(2026, 10, 14)),
                row("Earlier", due=date(2026, 10, 12)),
            ],
        }
    )
    assert [section.title for section in presented.sections] == [
        "Overdue",
        "Obligation errors",
        "Ready to pay",
        "Needs preparation",
        "Missing due date",
    ]
    assert [
        item.category_name for item in presented.sections[0].ledgers[0].obligations
    ] == ["Earlier", "Later"]
    assert presented.summary_title == "6 obligations need attention"


def test_subtotals_separate_currencies_and_unconfirmed_values_without_inventing_zero():
    presented = digest(
        {
            "overdue": [
                row(amount="10.00"),
                row(amount="20.00", ledger="Workshop"),
                row(amount="4.50", state="estimated"),
                row(amount=None, state="unknown"),
                row(amount="90.00", currency="EUR"),
                row(amount=None, currency="USD", state="unknown"),
            ]
        }
    )
    summaries = {item.currency: item for item in presented.currencies}
    assert summaries["PLN"].confirmed_label == "30.00 PLN confirmed subtotal"
    assert (
        summaries["PLN"].unconfirmed_label == "4.50 PLN estimated/unconfirmed subtotal"
    )
    assert "Partial amounts" in summaries["PLN"].detail
    assert "1 unknown amount" in summaries["PLN"].detail
    assert summaries["EUR"].confirmed_label == "90.00 EUR confirmed subtotal"
    assert summaries["USD"].confirmed_label is None
    assert summaries["USD"].unconfirmed_label is None
    assert "0.00" not in str(summaries["USD"])


def test_unknown_currency_is_never_totalled_and_known_zero_is_preserved():
    presented = digest(
        {
            "ready_to_pay": [
                row(amount="10", currency=None),
                row(amount="20", currency=None),
                row(amount="0", state="overridden"),
            ]
        }
    )
    currencies = {item.currency: item for item in presented.currencies}
    unknown = currencies["Currency not specified"]
    assert unknown.confirmed_label is None
    assert unknown.unconfirmed_label is None
    assert unknown.detail == "Not totalled: currency not specified"
    assert currencies["PLN"].confirmed_label == "0.00 PLN confirmed subtotal"
    assert presented.sections[0].ledgers[0].obligations[0].amount_detail == "Confirmed"


def test_precision_and_estimated_unconfirmed_overridden_dates_survive():
    rows = [
        row("Estimate", amount="1.2345", state="estimated", due_state="estimated"),
        row("Unconfirmed", state="unknown", due_state="unknown"),
        row("Override", state="overridden", due_state="overridden"),
        row("Unknown", amount=None, due=None),
    ]
    presented = digest({"needs_preparation": rows})
    displayed = {
        item.category_name: item
        for item in presented.sections[0].ledgers[0].obligations
    }
    assert displayed["Estimate"].amount_label == "1.2345 PLN"
    assert displayed["Estimate"].amount_detail == "Estimated"
    assert "Estimated" in displayed["Estimate"].due_label
    assert "Unconfirmed" in displayed["Unconfirmed"].due_label
    assert displayed["Override"].amount_detail == "Overridden"
    assert "Overridden" in displayed["Override"].due_label
    assert displayed["Unknown"].due_label == "Due date unknown"
    assert displayed["Unknown"].amount_label == "Amount unknown"


@pytest.mark.parametrize(
    "name,heading,absent",
    [
        ("activity-only", "Recent activity", "Integration health"),
        ("integration-health-only", "Integration health", "Recent activity"),
    ],
)
def test_single_purpose_digests_omit_empty_financial_sections(name, heading, absent):
    context = fixture(name)
    for extension in ("html", "txt"):
        output = render(context, extension)
        assert heading in output
        assert absent not in output
        assert "Amounts in this digest" not in output
        assert "0.00" not in output


def test_runtime_data_is_escaped_once_and_links_remain_valid():
    context = fixture("section-overdue")
    malicious = '<img src=x onerror="alert(1)"> & {{ 7 * 7 }}'
    context["project_name"] = malicious
    context["digest"]["sections"][0]["ledgers"][0]["name"] = malicious
    item = context["digest"]["sections"][0]["ledgers"][0]["obligations"][0]
    item["category_name"] = malicious
    item["link"] = 'https://example.com/obligation?a=1&b="quoted"'
    context["activity"] = {
        malicious: [
            {
                "category_name": malicious,
                "actor_name": malicious,
                "messages": [malicious],
                "omitted_changes": 0,
                "link": item["link"],
            }
        ]
    }
    context["integration_health"] = {
        malicious: [
            {
                "integration_name": malicious,
                "health": "error",
                "detail": malicious,
                "last_success_at": None,
                "link": item["link"],
            }
        ]
    }
    output = render(context)
    assert "<img src=x" not in output
    assert "&lt;img src=x onerror=&#34;alert(1)&#34;&gt; &amp; {{ 7 * 7 }}" in output
    assert "&amp;lt;" not in output
    assert MailLinks(output).links.count(item["link"]) == 4
    assert malicious in render(context, "txt")
    # Remove the sole obligation at runtime: no frozen fixture rows survive.
    context["digest"]["sections"] = []
    assert "View obligation" not in render(context)


def test_truncation_markers_and_optional_sections_can_disappear_at_runtime():
    context = copy.deepcopy(fixture())
    context["activity_truncated"] = False
    context["integration_health_truncated"] = False
    context["activity"]["Household"][0]["omitted_changes"] = 0
    output = render(context)
    assert "Additional activity was omitted" not in output
    assert "Additional unhealthy integrations were omitted" not in output
    assert "more changes" not in output


def test_production_render_keeps_empty_selection_silent_and_uses_real_adapter(
    monkeypatch,
):
    # Set only synthetic local CI configuration before importing settings.
    for line in (ROOT / ".github" / "ci.env").read_text().splitlines():
        if line and not line.startswith("#"):
            key, value = line.split("=", 1)
            monkeypatch.setenv(key, value)
    monkeypatch.syspath_prepend(str(ROOT / "backend"))
    module = importlib.import_module("app.services.daily_obligation_report")
    monkeypatch.setattr(module, "_select_sections", lambda **kwargs: {})
    monkeypatch.setattr(module, "_select_activity", lambda **kwargs: ([], False))
    monkeypatch.setattr(
        module, "_select_integration_health", lambda **kwargs: ([], False)
    )
    report = module.DailyObligationReport()
    context = SimpleNamespace(business_date=date(2026, 10, 15))
    user = SimpleNamespace(id="synthetic-user")
    assert report.render(session=None, user=user, context=context) is None
    assert (
        report.delivery_key(user=user, context=context)
        == "daily:synthetic-user:2026-10-15"
    )
    monkeypatch.setattr(
        module,
        "_select_sections",
        lambda **kwargs: {
            "overdue": [row(name="Runtime-only item", amount=None, state="unknown")]
        },
    )
    email = report.render(session=None, user=user, context=context)
    assert email is not None
    assert email.subject == "Oblidog - Daily obligation report"
    for body in (email.html_content, email.text_content):
        assert "Runtime-only item" in body
        assert "1 obligation needs attention" in body
        assert "Amount unknown" in body
        assert "0.00" not in body

    monkeypatch.setattr(
        module,
        "_select_sections",
        lambda **kwargs: {
            "overdue": [
                row(
                    name=f"Large runtime item {index:03}",
                    amount="89.00",
                    link=f"https://example.com/{index}",
                )
                for index in range(100)
            ]
        },
    )
    large = report.render(session=None, user=user, context=context)
    assert large is not None
    assert len(large.html_content.encode("utf-8")) <= 90 * 1024
    assert "This email was shortened." in large.html_content
    assert "This email was shortened." in large.text_content


def test_truncated_health_only_summary_is_a_lower_bound():
    presented = build_daily_digest(
        sections={},
        activity_count=0,
        integration_count=50,
        integration_health_truncated=True,
    )
    assert presented.summary_title == "At least 50 integrations need review"
    assert "50 integrations selected for review" in presented.summary_detail


def _large_render_input(obligations=35, updates=40, integrations=20):
    from backend.app.services.daily_digest_rendering import render_daily_digest

    context = fixture()
    items = [
        row(
            name=f"Selected obligation {index:03}",
            amount="89.00",
            link=f"https://example.com/obligations/{index}",
        )
        for index in range(obligations)
    ]
    activity = context["activity"]["Household"][0]
    health = context["integration_health"]["Household"][0]
    kwargs = {
        "project_name": "Oblidog",
        "report_date": "2026-10-15",
        "digest": build_daily_digest(
            sections={"ready_to_pay": items},
            activity_count=updates,
            integration_count=integrations,
        ),
        "activity": {
            "Household": [
                dict(
                    activity,
                    category_name=f"Activity {index:03}",
                    messages=[
                        "Amount changed: 79.00 → 89.00",
                        "New invoice: October invoice (89.00)",
                        "Due date changed: 2026-10-17 → 2026-10-20",
                        "Marked ready to pay",
                        "Payment recognized",
                    ],
                )
                for index in range(updates)
            ]
        }
        if updates
        else {},
        "integration_health": {
            "Household": [
                dict(health, integration_name=f"Provider {index:03}")
                for index in range(integrations)
            ]
        }
        if integrations
        else {},
        "activity_truncated": False,
        "integration_health_truncated": False,
        "app_url": "https://example.com/ledgers?a=1&b=2",
    }
    return render_daily_digest, kwargs


def test_large_mixed_digest_keeps_budget_notice_links_and_full_selected_totals():
    from backend.app.services.daily_digest_rendering import DAILY_DIGEST_HTML_BUDGET

    render_bounded, kwargs = _large_render_input()
    before = copy.deepcopy(kwargs)
    html, text = render_bounded(**kwargs)
    assert len(html.encode("utf-8")) <= DAILY_DIGEST_HTML_BUDGET
    assert "This email was shortened." in html
    assert html.index("This email was shortened.") < 8000
    assert kwargs["app_url"] in MailLinks(html).links
    assert "35 obligations need attention" in html
    assert "3115.00 PLN confirmed subtotal" in html
    assert "including any rows omitted from this email" in html
    assert "Additional activity was omitted" in html
    assert "This email was shortened." in text
    assert "Open full data in Oblidog: " + kwargs["app_url"] in text
    assert "Additional activity was omitted" in text
    assert "Selected obligation 000" in html
    assert "Selected obligation 034" in html
    assert kwargs == before
    # Serialization must not grow the decoded HTML beyond the delivery budget.
    from emails.message import Message

    message = Message(
        html=html,
        text=text,
        subject="Synthetic daily digest",
        mail_from=("Oblidog", "noreply@example.com"),
    )
    for part in message.as_message().walk():
        if part.get_content_type() == "text/html":
            assert len(part.get_payload(decode=True)) <= DAILY_DIGEST_HTML_BUDGET


def test_seventy_obligations_are_shortened_with_honest_section_and_currency_counts():
    from backend.app.services.daily_digest_rendering import DAILY_DIGEST_HTML_BUDGET

    render_bounded, kwargs = _large_render_input(
        obligations=70, updates=1, integrations=3
    )
    html, text = render_bounded(**kwargs)
    visible = "".join(MailLinks(html).text)
    assert len(html.encode("utf-8")) <= DAILY_DIGEST_HTML_BUDGET
    assert "70 obligations need attention" in visible
    assert "6230.00 PLN confirmed subtotal" in visible
    assert "This email was shortened." in visible
    assert "of 70 obligations in this section" in visible
    assert "of 70 obligations in this section" in text
    assert "Selected obligation 000" in html
    assert "Selected obligation 069" not in html
    assert "Additional unhealthy integrations were omitted" in html
    assert "Additional activity was omitted" in html


@pytest.mark.parametrize("kind", ["obligation", "activity", "integration"])
def test_one_huge_unicode_escaped_field_cannot_bypass_the_byte_budget(kind):
    render_bounded, kwargs = _large_render_input(
        obligations=0, updates=0, integrations=0
    )
    hostile = '<img src=x onerror="alert(1)"> & Ł犬' * 6000
    if kind == "obligation":
        kwargs["digest"] = digest({"overdue": [row(name=hostile, amount="10.00")]})
    elif kind == "activity":
        kwargs["activity"] = {
            "Household": [
                dict(fixture()["activity"]["Household"][0], messages=[hostile])
            ]
        }
        kwargs["digest"] = digest({}, activity=1)
    else:
        kwargs["integration_health"] = {
            "Household": [
                dict(fixture()["integration_health"]["Household"][0], detail=hostile)
            ]
        }
        kwargs["digest"] = digest({}, health=1)
    html, text = render_bounded(**kwargs, html_budget=15000)
    assert len(html.encode("utf-8")) <= 15000
    assert "<img src=x" not in html
    assert hostile not in text
    assert "This email was shortened." in html
    assert kwargs["app_url"] in MailLinks(html).links
    assert "This email was shortened." in text


def test_small_digest_does_not_gain_size_truncation_notices():
    render_bounded, kwargs = _large_render_input(
        obligations=1, updates=1, integrations=1
    )
    html, text = render_bounded(**kwargs)
    assert "This email was shortened." not in html
    assert "Remaining items are available" not in html
    assert "Additional activity was omitted" not in html
    assert "Additional unhealthy integrations were omitted" not in html
    assert "Selected obligation 000" in html
    assert "Activity 000" in html
    assert "Provider 000" in html
    assert "Selected obligation 000" in text


def test_budget_retains_highest_priority_obligations_before_lower_sections():
    render_bounded, kwargs = _large_render_input(
        obligations=0, updates=0, integrations=0
    )
    kwargs["digest"] = digest(
        {
            "missing_due_date": [row("Lowest priority")],
            "ready_to_pay": [row("Lower priority")],
            "overdue": [
                row(f"Urgent {index:03}", link=f"https://example.com/{index}")
                for index in range(100)
            ],
        }
    )
    html, _ = render_bounded(**kwargs)
    assert "Urgent 000" in html
    assert "Lowest priority" not in html
    assert "Lower priority" not in html
    assert "of 1 obligations in this section" in "".join(MailLinks(html).text)


def test_impossible_layout_budget_fails_instead_of_sending_oversized_html():
    render_bounded, kwargs = _large_render_input(
        obligations=1, updates=0, integrations=0
    )
    with pytest.raises(ValueError, match="exceeds HTML budget"):
        render_bounded(**kwargs, html_budget=50)
