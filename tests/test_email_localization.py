"""EN/PL email contracts using production rendering and synthetic data only."""

import importlib
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal
from pathlib import Path
from string import Formatter
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "emails/scripts"))
from app.email_i18n import EmailLocale, recipient_language  # noqa: E402
from app.email_rendering import render_email_template  # noqa: E402
from localized_fixtures import render_localized_fixture  # noqa: E402


@pytest.fixture
def mail_modules(monkeypatch):
    for line in (ROOT / ".github/ci.env").read_text().splitlines():
        if line and not line.startswith("#"):
            key, value = line.split("=", 1)
            monkeypatch.setenv(key, value)
    return importlib.import_module("app.utils")


def test_catalog_keys_and_interpolation_contract_match():
    catalogs = {
        language: json.loads(
            (ROOT / f"backend/app/email-locales/{language}.json").read_text()
        )
        for language in ("en", "pl")
    }

    def normalize(catalog):
        result = {}
        for key, text in catalog.items():
            base = re.sub(r"_(one|few|many|other)$", "", key)
            placeholders = {name for _, name, _, _ in Formatter().parse(text) if name}
            assert base not in result or result[base] == placeholders
            result[base] = placeholders
        return result

    assert normalize(catalogs["en"]) == normalize(catalogs["pl"])
    for key in catalogs["en"]:
        if key.endswith("_one"):
            base = key[:-4]
            assert all(
                f"{base}_{form}" in catalogs["pl"]
                for form in ("one", "few", "many", "other")
            )


@pytest.mark.parametrize(
    "value,expected",
    [
        (None, "en"),
        ("", "en"),
        ("de", "en"),
        ("pl-PL", "en"),
        ("en", "en"),
        ("pl", "pl"),
    ],
)
def test_recipient_language_is_explicit_and_deterministic(value, expected):
    assert recipient_language(value) == expected


def test_plural_dates_and_decimal_precision():
    pl, en = EmailLocale("pl"), EmailLocale("en")
    for count, text in [
        (0, "Jeszcze 0 zmian"),
        (1, "Jeszcze 1 zmiana"),
        (2, "Jeszcze 2 zmiany"),
        (5, "Jeszcze 5 zmian"),
        (12, "Jeszcze 12 zmian"),
        (22, "Jeszcze 22 zmiany"),
    ]:
        assert pl.tr("more_changes", count=count) == text
    assert en.tr("more_changes", count=1) == "And 1 more change"
    assert en.date(date(2026, 10, 19)) == "2026-10-19"
    assert pl.date("2026-10-19") == "19.10.2026"
    assert (
        pl.amount(Decimal("123456789012345678901234.1234"))
        == "123456789012345678901234,1234"
    )
    assert en.amount(Decimal("-0.00100")) == "-0.00100"
    assert pl.amount(Decimal("0")) == "0,00"


@pytest.mark.parametrize("language", ["en", "pl"])
@pytest.mark.parametrize(
    "name", ["normal", "empty", "unknown", "multi-currency", "long-content"]
)
def test_localized_preview_matrix_renders_both_parts_with_size_and_escaping(
    name, language
):
    raw = json.loads((ROOT / f"emails/fixtures/localized/{name}.json").read_text())
    html, text = render_localized_fixture(raw, language)
    locale = EmailLocale(language)
    assert len(html.encode()) <= 90 * 1024
    assert f'lang="{language}"' in html
    assert "{{" not in html and "{%" not in html
    assert locale.tr("daily_title") in html
    assert locale.tr("daily_subject") in text
    for output in (html, text):
        assert locale.tr("preferences") in output
        if name == "normal":
            assert "external_diagnostic_unchanged" in output
            assert "Custom_actor" in output
            assert locale.tr("activity_created") in output
            assert locale.tr("more_changes", count=2) in output
        if name == "unknown":
            assert locale.tr("amount_unknown") in output
            assert locale.tr("due_unknown") in output
            assert "0.00" not in output and "0,00" not in output
        if name == "multi-currency":
            assert "PLN" in output and "EUR" in output
            assert locale.tr("not_totalled") in output
        if name == "long-content":
            assert locale.tr("open_data") in output
            assert "180" in output
            assert "23" in output
    if name == "long-content":
        assert "<>&" not in html and "&lt;&gt;&amp;" in html
        assert "<>&" in text
        assert (
            "This email was shortened"
            if language == "en"
            else "Wiadomość została skrócona"
        ) in text
        shown = html.count(
            "View obligation →" if language == "en" else "Zobacz zobowiązanie →"
        )
        assert 0 < shown < 180
        assert (
            f"Showing {shown} of 180" if language == "en" else f"Pokazano {shown} z 180"
        ) in text


@pytest.mark.parametrize("language", ["en", "pl"])
def test_transactional_subjects_parts_links_and_escaping(mail_modules, language):
    locale = EmailLocale(language)
    malicious = "<img src=x> & {{ 7*7 }}"
    messages = [
        mail_modules.generate_test_email("to@example.com", language=language),
        mail_modules.generate_reset_password_email(
            "to@example.com", malicious, "token&part", language=language
        ),
        mail_modules.generate_new_account_email(
            "to@example.com", malicious, "secret<&", language=language
        ),
        mail_modules.generate_user_invitation_email(
            "to@example.com", "token&part", 22, language=language
        ),
    ]
    assert locale.tr("test_subject") in messages[0].subject
    assert locale.tr("reset_title") in messages[1].html_content
    assert locale.tr("new_title") in messages[2].html_content
    assert locale.tr("invitation_subject") in messages[3].subject
    for message in messages:
        assert message.text_content and f'lang="{language}"' in message.html_content
        assert "<img src=x>" not in message.html_content
    assert "&lt;img src=x&gt; &amp; {{ 7*7 }}" in messages[1].html_content
    assert malicious in messages[1].text_content
    assert "token&amp;part" in messages[1].html_content
    assert "token&part" in messages[1].text_content
    assert locale.tr("invitation_expiry", count=22) in messages[3].text_content
    assert mail_modules.generate_test_email("to@example.com").subject.endswith(
        "Test email"
    )


@pytest.mark.usefixtures("mail_modules")
def test_same_report_instance_does_not_mix_recipients_or_threads(monkeypatch):
    module = importlib.import_module("app.services.daily_obligation_report")
    weekly = importlib.import_module("app.services.weekly_monthly_overview_report")
    raw = json.loads((ROOT / "emails/fixtures/localized/normal.json").read_text())
    item = SimpleNamespace(
        **(
            raw["sections"]["overdue"][0]
            | {"amount": Decimal("12.3456"), "due_date": date(2026, 10, 19)}
        )
    )
    monkeypatch.setattr(
        module, "_select_sections", lambda **kwargs: {"overdue": [item]}
    )
    monkeypatch.setattr(module, "_select_activity", lambda **kwargs: ([], False))
    monkeypatch.setattr(
        module, "_select_integration_health", lambda **kwargs: ([], False)
    )
    monkeypatch.setattr(weekly, "_build_user_overviews", lambda **kwargs: [])
    daily_report, weekly_report = (
        module.DailyObligationReport(),
        weekly.WeeklyMonthlyOverviewReport(),
    )
    context = SimpleNamespace(business_date=date(2026, 10, 19))

    def render(language):
        user = SimpleNamespace(id="same-user", language=language)
        return (
            daily_report.render(session=None, user=user, context=context),
            weekly_report.render(session=None, user=user, context=context),
            daily_report.delivery_key(user=user, context=context),
            weekly_report.delivery_key(user=user, context=context),
        )

    languages = ["pl", "en", None, "pl", "en"] * 4
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(render, languages))
    for language, (daily, week, daily_key, weekly_key) in zip(
        languages, results, strict=True
    ):
        locale = EmailLocale(recipient_language(language))
        assert locale.tr("daily_subject") in daily.subject
        assert locale.tr("weekly_subject") in week.subject
        assert locale.amount(Decimal("12.3456")) in daily.text_content
        assert locale.tr("section_overdue") in daily.text_content
        assert locale.tr("weekly_subject") in week.text_content
        assert daily_key == "daily:same-user:2026-10-19"
        assert weekly_key == "weekly:same-user:2026-W43"


@pytest.mark.parametrize("language", ["en", "pl"])
def test_weekly_multipart_uses_localized_amounts_and_preserves_currencies(language):
    locale = EmailLocale(language)
    item = SimpleNamespace(
        currency="PLN",
        total_known_amount=Decimal("123.4567"),
        paid_known_amount=Decimal("23.00"),
        remaining_known_amount=Decimal("100.4567"),
        ready_count=2,
        paid_count=1,
        not_ready_count=1,
        paid_percentage=Decimal("25.00"),
        overdue_count=1,
        overdue_known_amount=Decimal("12.00"),
        incomplete_count=1,
        total_is_complete=False,
        previous_total_known_amount=Decimal("100"),
        previous_total_is_complete=True,
        total_change=None,
        upcoming=[
            SimpleNamespace(
                due_date=date(2026, 10, 20), category_name="Custom_<>&", amount=None
            )
        ],
    )
    context = {
        "project_name": "Oblidog",
        "period": locale.period(date(2026, 10, 19)),
        "report_date": locale.date(date(2026, 10, 19)),
        "ledgers": [SimpleNamespace(ledger_name="Custom_Ledger", currencies=[item])],
    }
    for ext in ["html", "txt"]:
        body = render_email_template(
            template_name=f"weekly_monthly_overview_report.{ext}",
            context=context,
            language=language,
        )
        assert locale.tr("weekly_subject") in body
        assert locale.tr("na_incomplete") in body
        assert locale.tr("unknown_amount_lower") in body
        assert locale.amount(item.total_known_amount) in body
        assert locale.date(date(2026, 10, 20)) in body
        assert "PLN" in body
        assert ("Custom_&lt;&gt;&amp;" if ext == "html" else "Custom_<>&") in body


@pytest.mark.usefixtures("mail_modules")
@pytest.mark.parametrize("language", [None, "en", "pl"])
def test_transactional_routes_use_recipient_preference_and_send_text(
    monkeypatch, language
):
    from email.header import decode_header
    from unittest.mock import Mock

    login = importlib.import_module("app.api.routes.login")
    invitations = importlib.import_module("app.api.routes.user_invitations")
    utils_route = importlib.import_module("app.api.routes.utils")
    users = importlib.import_module("app.services.users")
    recipient = SimpleNamespace(
        email="recipient@example.com", language=language, is_active=True
    )
    monkeypatch.setattr(users, "get_user_by_email", lambda **kwargs: recipient)
    monkeypatch.setattr(
        login.password_reset_service,
        "issue_password_reset",
        lambda **kwargs: SimpleNamespace(token="unchanged-token"),
    )
    sent = []
    monkeypatch.setattr(login, "send_email", lambda **kwargs: sent.append(kwargs))
    monkeypatch.setattr(utils_route, "send_email", lambda **kwargs: sent.append(kwargs))
    monkeypatch.setattr(invitations, "send_email", lambda **kwargs: sent.append(kwargs))
    monkeypatch.setattr(invitations.settings, "SMTP_HOST", "localhost")
    monkeypatch.setattr(invitations.settings, "EMAILS_FROM_EMAIL", "admin@example.com")
    login.recover_password(email=recipient.email, session=Mock())
    utils_route.test_email(email_to=recipient.email, session=Mock())
    invitations._send_invitation(recipient.email, "unchanged-token", session=Mock())
    locale = EmailLocale(recipient_language(language))
    assert locale.tr("reset_subject", email=recipient.email) in sent[0]["subject"]
    assert locale.tr("test_subject") in sent[1]["subject"]
    assert locale.tr("invitation_subject") in sent[2]["subject"]
    for mail in sent:
        assert mail["text_content"]
        assert f'lang="{locale.language}"' in mail["html_content"]
        assert mail["email_to"] == recipient.email
    preview = login.recover_password_html_content(email=recipient.email, session=Mock())
    encoded = preview.headers["subject:"]
    decoded = "".join(
        part.decode(charset or "ascii") if isinstance(part, bytes) else part
        for part, charset in decode_header(encoded)
    )
    assert decoded == sent[0]["subject"]
    # A recipient without an account has no preference; never use the inviter's language.
    monkeypatch.setattr(users, "get_user_by_email", lambda **kwargs: None)
    invitations._send_invitation("new@example.com", "new-token", session=Mock())
    assert sent[-1]["subject"].endswith("You're invited")
    assert 'lang="en"' in sent[-1]["html_content"]


@pytest.mark.usefixtures("mail_modules")
def test_activity_and_health_translate_system_values_but_keep_external_content():
    from datetime import UTC, datetime
    from zoneinfo import ZoneInfo

    from app.domain.integrations import IntegrationHealth
    from app.services.daily_obligation_report import (
        _activity_messages,
        _integration_health_detail,
    )

    log = SimpleNamespace(
        action="values_updated",
        changes={
            "current_amount": {"from": None, "to": "9007199254740993.00100"},
            "due_date": {"from": "2026-10-18", "to": "2026-10-19"},
        },
    )
    polish = " ".join(_activity_messages(log, language="pl"))
    english = " ".join(_activity_messages(log, language="en"))
    assert "9007199254740993,00100" in polish
    assert "19.10.2026" in polish and "Kwota" in polish
    assert "9007199254740993.00100" in english and "2026-10-19" in english
    integration = SimpleNamespace(
        current_started_at=datetime(2026, 10, 19, 8, tzinfo=UTC),
        current_deadline_at=None,
        last_error_code="EXTERNAL_CODE",
        last_error_message="Original external diagnostic <>&",
    )
    timeout = _integration_health_detail(
        integration,
        IntegrationHealth.TIMED_OUT,
        ZoneInfo("Europe/Warsaw"),
        language="pl",
    )
    assert "19.10.2026 10:00 +0200" in timeout
    for language in ("en", "pl"):
        assert (
            _integration_health_detail(
                integration, IntegrationHealth.ERROR, UTC, language=language
            )
            == "EXTERNAL_CODE: Original external diagnostic <>&"
        )
