"""Presentation of already selected daily-digest data; no queries or scheduling."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING

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


def _count(count: int, singular: str, plural: str) -> str:
    return f"{count} {singular if count == 1 else plural}"


def _state_label(state: str) -> str:
    return {
        "confirmed": "Confirmed",
        "overridden": "Overridden",
        "estimated": "Estimated",
        "unknown": "Unconfirmed",
    }.get(state, "Unconfirmed")


def _money(amount: Decimal) -> str:
    # Do not round away supported sub-cent precision; keep at least two places.
    whole, _, fraction = format(amount, "f").partition(".")
    return f"{whole}.{fraction.ljust(2, '0')}"


def _row(item: DailyReportItem) -> DigestRow:
    currency = item.currency or "currency unknown"
    return DigestRow(
        category_name=item.category_name,
        amount_label=(
            "Amount unknown"
            if item.amount is None
            else f"{_money(item.amount)} {currency}"
        ),
        amount_detail="Unknown"
        if item.amount is None
        else _state_label(item.amount_state),
        due_label=(
            "Due date unknown"
            if item.due_date is None
            else f"Due {item.due_date.isoformat()} · {_state_label(item.due_date_state)}"
        ),
        link=item.link,
    )


def _currencies(items: Sequence[DailyReportItem]) -> tuple[DigestCurrency, ...]:
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
            detail.append(_count(unknown, "unknown amount", "unknown amounts"))
        if unconfirmed:
            detail.append(
                _count(
                    len(unconfirmed),
                    "estimated/unconfirmed amount",
                    "estimated/unconfirmed amounts",
                )
            )
        if currency is None:
            # Missing currencies could describe incompatible units. Never sum them.
            detail.insert(0, "Not totalled: currency not specified")
        elif unknown or unconfirmed:
            detail.insert(0, "Partial amounts")
        else:
            detail.append("All amounts confirmed or overridden")
        summaries.append(
            DigestCurrency(
                currency=currency or "Currency not specified",
                confirmed_label=f"{_money(sum(confirmed, Decimal(0)))} {currency} confirmed subtotal"
                if currency and confirmed
                else None,
                unconfirmed_label=f"{_money(sum(unconfirmed, Decimal(0)))} {currency} estimated/unconfirmed subtotal"
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
) -> DailyDigest:
    """Only reorder/format the supplied selection; amounts cover this digest only."""
    presented = []
    all_items: list[DailyReportItem] = []
    for key, title in SECTION_TITLES.items():
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
                    _row(item)
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
        f"{title}: {len(sections[key])}"
        for key, title in SECTION_TITLES.items()
        if sections.get(key)
    ]
    if integration_count:
        counts.append(
            f"{_count(integration_count, 'integration', 'integrations')} selected for review"
        )
    if activity_count:
        counts.append(
            f"{_count(activity_count, 'activity update', 'activity updates')} selected"
        )
    if all_items:
        title = f"{_count(len(all_items), 'obligation needs', 'obligations need')} attention"
    elif integration_count:
        title = f"{_count(integration_count, 'integration needs', 'integrations need')} review"
    else:
        title = _count(activity_count, "activity update", "activity updates")
    if not all_items and integration_count and integration_health_truncated:
        title = f"At least {title}"
    return DailyDigest(
        summary_title=title,
        summary_detail=" · ".join(counts),
        sections=tuple(presented),
        currencies=_currencies(all_items),
    )
