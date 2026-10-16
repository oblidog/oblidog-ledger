"""Weekly React Email/Jinja regression tests; synthetic data and no database."""

import copy
import html
import importlib
import re
import sys
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "emails/scripts"))

from app.email_i18n import EmailLocale  # noqa: E402
from weekly_fixtures import load_weekly_fixture, render_weekly_fixture  # noqa: E402

CASES = sorted(path.stem for path in (ROOT / "emails/fixtures/weekly").glob("*.json"))


def visible_text(markup: str) -> str:
    markup = re.sub(r"<!--.*?-->", "", markup, flags=re.DOTALL)
    return " ".join(html.unescape(re.sub(r"<[^>]*>", " ", markup)).split())


@pytest.mark.parametrize("language", ["en", "pl"])
@pytest.mark.parametrize("name", CASES)
def test_weekly_matrix_preserves_every_metric_and_payment(name, language):
    raw = load_weekly_fixture(name)
    locale = EmailLocale(language)
    markup, text = render_weekly_fixture(raw, language)
    assert f'lang="{language}"' in markup
    assert "{%" not in markup and "{{" not in markup
    assert "OBLIDOG_JINJA_" not in markup
    assert 'role="presentation"' in markup
    assert "<script" not in markup and "<img" not in markup
    assert 'href="' + html.escape(raw["app_url"], quote=True) + '"' in markup
    for body in (visible_text(markup), " ".join(text.split())):
        assert locale.tr("weekly_subject") in body
        assert locale.tr("weekly_footer") in body
        assert locale.date(raw["report_date"]) in body
        assert locale.period(date.fromisoformat(raw["period"] + "-01")) in body
        if not raw["ledgers"]:
            assert locale.tr("weekly_empty") in body
        for ledger in raw["ledgers"]:
            assert ledger["ledger_name"] in body
            if not ledger["currencies"]:
                assert locale.tr("no_obligations") in body
            for item in ledger["currencies"]:
                assert (item["currency"] or locale.tr("currency_unspecified")) in body
                for label, field in (
                    ("total_known", "total_known_amount"),
                    ("paid_known", "paid_known_amount"),
                    ("remaining_known", "remaining_known_amount"),
                    ("previous_total", "previous_total_known_amount"),
                ):
                    # Colons differ between authored text and the card layout.
                    assert locale.tr(label) in body
                    assert locale.amount(item[field]) in body
                assert locale.tr("weekly_count_progress") in body
                percentage = item["paid_percentage"]
                assert (
                    locale.tr("na")
                    if percentage is None
                    else locale.amount(percentage) + "%"
                ) in body
                for label, field in (
                    ("ready", "ready_count"),
                    ("paid", "paid_count"),
                    ("not_ready", "not_ready_count"),
                    ("section_overdue", "overdue_count"),
                    ("unknown_values", "incomplete_count"),
                ):
                    assert re.search(
                        re.escape(locale.tr(label)) + r"\s*[:=]\s*" + str(item[field]),
                        body,
                    )
                assert locale.amount(item["overdue_known_amount"]) in body
                assert (
                    locale.tr("na_incomplete")
                    if item["total_change"] is None
                    else locale.amount(item["total_change"])
                ) in body
                if (
                    not item["total_is_complete"]
                    or not item["previous_total_is_complete"]
                ):
                    assert locale.tr("incomplete") in body
                for payment in item["upcoming"]:
                    assert payment["category_name"] in body
                    assert locale.date(payment["due_date"]) in body
                    assert locale.amount(payment["amount"]) in body
                if not item["upcoming"]:
                    assert locale.tr("none") in body
    assert raw["app_url"] in text
    if name == "long-content":
        assert "&lt;&gt;&amp;" in markup and "<>&" not in markup
        assert markup.count("UnbrokenLongName" * 20) == 40
    if name == "unknown":
        assert locale.tr("weekly_incomplete_notice") in visible_text(markup)


@pytest.mark.parametrize("language", ["en", "pl"])
def test_count_percentage_is_not_reinterpreted_as_amount_progress(language):
    markup, text = render_weekly_fixture(load_weekly_fixture("normal"), language)
    locale = EmailLocale(language)
    # One of four obligations is paid, but 900 of 1200.1234 monetary units are paid.
    for body in (visible_text(markup), " ".join(text.split())):
        assert (
            locale.tr("weekly_count_progress") + ": " + locale.amount("25.00") + "%"
            in body
        )
        assert locale.amount("900.00") in body
        assert locale.amount("300.1234") in body


def test_runtime_collections_currency_blocks_and_escaping_are_not_frozen():
    raw = load_weekly_fixture("multi-ledger-currency")
    markup, _ = render_weekly_fixture(raw, "en")
    blocks = re.split(r"<h3\b[^>]*>", markup)[1:]
    assert len(blocks) == 3
    assert "PLN" in blocks[0] and "1200.1234" in blocks[0]
    assert "EUR" in blocks[1] and "24.90" in blocks[1]
    assert "1200.1234" not in blocks[1] and "24.90" not in blocks[0]
    assert "GBP" in blocks[2] and "1200.1234" in blocks[2]
    malicious = '<img src=x onerror="bad()"> & {{ 7*7 }}'
    raw["project_name"] = malicious
    raw["ledgers"][0]["ledger_name"] = malicious
    raw["ledgers"][0]["currencies"][0]["upcoming"][0]["category_name"] = malicious
    raw["app_url"] = 'https://example.com/?a=1&b="quoted"'
    markup, text = render_weekly_fixture(raw, "en")
    assert "<img src=x" not in markup
    assert "&lt;img src=x onerror=&#34;bad()&#34;&gt; &amp; {{ 7*7 }}" in markup
    assert 'href="https://example.com/?a=1&amp;b=&#34;quoted&#34;"' in markup
    assert malicious in text and raw["app_url"] in text
    changed = copy.deepcopy(raw)
    changed["ledgers"] = []
    markup, text = render_weekly_fixture(changed, "pl")
    assert "1200.1234" not in markup and "Internet_Custom" not in text
    assert "Brak zobowiązań w tym zestawieniu." in markup


def test_actual_weekly_render_adds_configured_application_link_and_keeps_cadence(
    monkeypatch,
):
    for line in (ROOT / ".github/ci.env").read_text().splitlines():
        if line and not line.startswith("#"):
            key, value = line.split("=", 1)
            monkeypatch.setenv(key, value)
    module = importlib.import_module("app.services.weekly_monthly_overview_report")
    monkeypatch.setattr(module, "_build_user_overviews", lambda **kwargs: [])
    monkeypatch.setattr(module.settings, "FRONTEND_HOST", "https://example.com/app/")
    report = module.WeeklyMonthlyOverviewReport()
    user = SimpleNamespace(id="synthetic", language="pl")
    monday = SimpleNamespace(business_date=date(2026, 10, 19))
    mail = report.render(session=None, user=user, context=monday)
    assert mail is not None
    assert 'href="https://example.com/app/ledgers"' in mail.html_content
    assert "https://example.com/app/ledgers" in mail.text_content
    assert report.delivery_key(user=user, context=monday) == "weekly:synthetic:2026-W43"
    assert (
        report.render(
            session=None,
            user=user,
            context=SimpleNamespace(business_date=date(2026, 10, 20)),
        )
        is None
    )
