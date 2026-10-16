"""Presentation of already selected daily-digest data; no queries or scheduling."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING

from app.email_i18n import EmailLocale, Language

if TYPE_CHECKING:
    from app.services.daily_obligation_report import DailyReportItem

SECTION_TITLES = {
    "overdue": "Overdue",
    "errors": "Obligation errors",
    "ready_to_pay": "Ready to pay",
    "needs_preparation": "Needs preparation",
    "missing_due_date": "Missing due date",
}
CONFIRMED_STATES = {"confirmed", "overridden"}


@dataclass(frozen=True, slots=True)
class DigestRow:
    category_name: str
    amount_label: str
    amount_detail: str
    due_label: str
    link: str


@dataclass(frozen=True, slots=True)
class DigestLedger:
    name: str
    obligations: tuple[DigestRow, ...]


@dataclass(frozen=True, slots=True)
class DigestSection:
    title: str
    count: int
    ledgers: tuple[DigestLedger, ...]
    omitted_count: int = 0


@dataclass(frozen=True, slots=True)
class DigestCurrency:
    currency: str
    confirmed_label: str | None
    unconfirmed_label: str | None
    detail: str


@dataclass(frozen=True, slots=True)
class DailyDigest:
    summary_title: str
    summary_detail: str
    sections: tuple[DigestSection, ...]
    currencies: tuple[DigestCurrency, ...]


def _state_label(state: str, locale: EmailLocale) -> str:
    return locale.tr(
        "state_"
        + (state if state in {"confirmed", "overridden", "estimated"} else "unknown")
    )


def _money(amount: Decimal) -> str:
    return EmailLocale().amount(amount)


def _row(item: DailyReportItem, locale: EmailLocale) -> DigestRow:
    currency = item.currency or locale.tr("currency_unknown")
    return DigestRow(
        category_name=item.category_name,
        amount_label=(
            locale.tr("amount_unknown")
            if item.amount is None
            else f"{locale.amount(item.amount)} {currency}"
        ),
        amount_detail=locale.tr("unknown_title")
        if item.amount is None
        else _state_label(item.amount_state, locale),
        due_label=(
            locale.tr("due_unknown")
            if item.due_date is None
            else locale.tr(
                "due_label",
                date=locale.date(item.due_date),
                state=_state_label(item.due_date_state, locale),
            )
        ),
        link=item.link,
    )


def _currencies(
    items: Sequence[DailyReportItem], locale: EmailLocale
) -> tuple[DigestCurrency, ...]:
    groups: dict[str | None, list[DailyReportItem]] = defaultdict(list)
    for item in items:
        groups[item.currency or None].append(item)
    summaries = []
    for currency, rows in sorted(groups.items(), key=lambda entry: entry[0] or "~"):
        unknown = sum(item.amount is None for item in rows)
        confirmed = [
            item.amount
            for item in rows
            if item.amount is not None and item.amount_state in CONFIRMED_STATES
        ]
        unconfirmed = [
            item.amount
            for item in rows
            if item.amount is not None and item.amount_state not in CONFIRMED_STATES
        ]
        detail = []
        if unknown:
            detail.append(locale.tr("unknown_amount_count", count=unknown))
        if unconfirmed:
            detail.append(locale.tr("unconfirmed_amount_count", count=len(unconfirmed)))
        if currency is None:
            # Missing currencies could describe incompatible units. Never sum them.
            detail.insert(0, locale.tr("not_totalled"))
        elif unknown or unconfirmed:
            detail.insert(0, locale.tr("partial_amounts"))
        else:
            detail.append(locale.tr("all_confirmed"))
        summaries.append(
            DigestCurrency(
                currency=currency or locale.tr("currency_unspecified"),
                confirmed_label=locale.tr(
                    "confirmed_subtotal",
                    amount=locale.amount(sum(confirmed, Decimal(0))),
                    currency=currency,
                )
                if currency and confirmed
                else None,
                unconfirmed_label=locale.tr(
                    "unconfirmed_subtotal",
                    amount=locale.amount(sum(unconfirmed, Decimal(0))),
                    currency=currency,
                )
                if currency and unconfirmed
                else None,
                detail=" · ".join(detail),
            )
        )
    return tuple(summaries)


def build_daily_digest(
    *,
    sections: Mapping[str, Sequence[DailyReportItem]],
    activity_count: int,
    integration_count: int,
    integration_health_truncated: bool = False,
    language: Language = "en",
) -> DailyDigest:
    """Only reorder/format the supplied selection; amounts cover this digest only."""
    locale = EmailLocale(language)
    presented = []
    all_items: list[DailyReportItem] = []
    for key in SECTION_TITLES:
        title = locale.tr(f"section_{key}")
        items = sections.get(key, ())
        if not items:
            continue
        grouped: dict[str, list[DailyReportItem]] = defaultdict(list)
        for item in items:
            grouped[item.ledger_name].append(item)
        ledgers = tuple(
            DigestLedger(
                name=name,
                obligations=tuple(
                    _row(item, locale)
                    for item in sorted(
                        rows,
                        key=lambda row: (
                            row.due_date or date.max,
                            row.category_name.casefold(),
                            row.link,
                        ),
                    )
                ),
            )
            for name, rows in sorted(
                grouped.items(), key=lambda entry: entry[0].casefold()
            )
        )
        presented.append(DigestSection(title=title, count=len(items), ledgers=ledgers))
        all_items.extend(items)
    counts = [
        f"{locale.tr('section_' + key)}: {len(sections[key])}"
        for key in SECTION_TITLES
        if sections.get(key)
    ]
    if integration_count:
        counts.append(locale.tr("integration_selected", count=integration_count))
    if activity_count:
        counts.append(locale.tr("activity_selected", count=activity_count))
    if all_items:
        title = locale.tr("obligation_attention", count=len(all_items))
    elif integration_count:
        title = locale.tr("integration_attention", count=integration_count)
    else:
        title = locale.tr("activity_count", count=activity_count)
    if not all_items and integration_count and integration_health_truncated:
        title = locale.tr("at_least", text=title)
    return DailyDigest(
        summary_title=title,
        summary_detail=" · ".join(counts),
        sections=tuple(presented),
        currencies=_currencies(all_items, locale),
    )
