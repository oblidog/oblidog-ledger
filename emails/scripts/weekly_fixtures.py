"""Synthetic weekly report inputs using the production Jinja render contract."""

import json
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.email_i18n import EmailLocale, recipient_language  # noqa: E402
from app.email_rendering import render_email_template  # noqa: E402

_AMOUNT_FIELDS = (
    "total_known_amount",
    "paid_known_amount",
    "remaining_known_amount",
    "overdue_known_amount",
    "paid_percentage",
    "previous_total_known_amount",
    "total_change",
)


def weekly_context(raw: dict, language: str) -> dict:
    locale = EmailLocale(recipient_language(language))
    ledgers = []
    for ledger in raw["ledgers"]:
        currencies = []
        for item in ledger["currencies"]:
            values = dict(item)
            for field in _AMOUNT_FIELDS:
                values[field] = (
                    Decimal(item[field]) if item[field] is not None else None
                )
            values["upcoming"] = [
                SimpleNamespace(
                    category_name=payment["category_name"],
                    due_date=date.fromisoformat(payment["due_date"]),
                    amount=Decimal(payment["amount"])
                    if payment["amount"] is not None
                    else None,
                )
                for payment in item["upcoming"]
            ]
            currencies.append(SimpleNamespace(**values))
        ledgers.append(
            SimpleNamespace(ledger_name=ledger["ledger_name"], currencies=currencies)
        )
    return {
        **raw,
        "report_date": locale.date(raw["report_date"]),
        "period": locale.period(date.fromisoformat(raw["period"] + "-01")),
        "ledgers": ledgers,
    }


def render_weekly_fixture(raw: dict, language: str) -> tuple[str, str]:
    context = weekly_context(raw, language)
    return tuple(
        render_email_template(
            template_name=f"weekly_monthly_overview_report.{extension}",
            context=context,
            language=language,
        )
        for extension in ("html", "txt")
    )


def load_weekly_fixture(name: str) -> dict:
    return json.loads((ROOT / f"emails/fixtures/weekly/{name}.json").read_text())
