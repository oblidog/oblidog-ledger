"""Raw synthetic inputs rendered by the production per-locale presentation pipeline."""

import sys
from datetime import date
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.email_i18n import EmailLocale, recipient_language  # noqa: E402
from app.services.daily_digest_presentation import build_daily_digest  # noqa: E402
from app.services.daily_digest_rendering import render_daily_digest  # noqa: E402


def render_localized_fixture(raw: dict, language: str) -> tuple[str, str]:
    language = recipient_language(language)
    locale = EmailLocale(language)
    sections = {
        key: [
            SimpleNamespace(
                **(
                    item
                    | {
                        "amount": Decimal(item["amount"])
                        if item["amount"] is not None
                        else None,
                        "due_date": date.fromisoformat(item["due_date"])
                        if item["due_date"]
                        else None,
                    }
                )
            )
            for item in items
        ]
        for key, items in raw["sections"].items()
    }
    activity = (
        {
            "Household_Custom": [
                SimpleNamespace(
                    category_name="Custom_category",
                    actor_name="Custom_actor",
                    messages=(locale.tr("activity_created"),),
                    omitted_changes=2,
                    link="https://example.com/activity",
                )
            ]
        }
        if raw["activity_count"]
        else {}
    )
    health = (
        {
            "Household_Custom": [
                SimpleNamespace(
                    integration_name="Custom_integration",
                    health="error",
                    detail="external_diagnostic_unchanged",
                    last_success_at=None,
                    link="https://example.com/integration",
                )
            ]
        }
        if raw["integration_count"]
        else {}
    )
    return render_daily_digest(
        project_name=raw["project_name"],
        report_date=raw["report_date"],
        digest=build_daily_digest(
            sections=sections,
            activity_count=raw["activity_count"],
            integration_count=raw["integration_count"],
            language=language,
        ),
        activity=activity,
        activity_truncated=False,
        integration_health=health,
        integration_health_truncated=False,
        app_url=raw["app_url"],
        language=language,
    )


def weekly_fixture_context(language: str, *, empty: bool = False) -> dict:
    locale = EmailLocale(recipient_language(language))
    items = [
        SimpleNamespace(
            currency=currency,
            total_known_amount=Decimal("129.5000"),
            paid_known_amount=Decimal("20.00"),
            remaining_known_amount=Decimal("109.5000"),
            ready_count=2,
            paid_count=1,
            not_ready_count=1,
            overdue_count=1,
            overdue_known_amount=Decimal("12.00"),
            paid_percentage=Decimal("25.00"),
            incomplete_count=1,
            total_is_complete=False,
            previous_total_known_amount=Decimal("125.00"),
            previous_total_is_complete=True,
            total_change=None,
            upcoming=[
                SimpleNamespace(
                    category_name="Custom_Category_<>&",
                    due_date=date(2026, 10, 20),
                    amount=None,
                )
            ],
        )
        for currency in ("PLN", "EUR")
    ]
    return {
        "project_name": "Oblidog",
        "period": locale.period(date(2026, 10, 19)),
        "report_date": locale.date(date(2026, 10, 19)),
        "ledgers": [
            SimpleNamespace(
                ledger_name="Custom_Ledger", currencies=[] if empty else items
            )
        ],
    }
