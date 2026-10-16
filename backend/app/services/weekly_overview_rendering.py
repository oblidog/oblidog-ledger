"""Bound weekly HTML without changing calculations or the original selection."""

from collections.abc import Sequence
from typing import Any

from app.email_i18n import EmailLocale, Language
from app.email_rendering import render_email_template

WEEKLY_OVERVIEW_HTML_BUDGET = 90 * 1024


def _take_ledgers(
    ledgers: Sequence[Any], groups: int, payments: int
) -> list[dict[str, Any]]:
    selected = []
    for ledger in ledgers:
        if groups <= 0:
            break
        currencies = []
        for item in ledger.currencies:
            if groups <= 0:
                break
            upcoming = item.upcoming[:payments]
            payments -= len(upcoming)
            currencies.append(
                {
                    **vars(item),
                    "upcoming": upcoming,
                    "upcoming_omitted": len(item.upcoming) - len(upcoming),
                }
            )
            groups -= 1
        # An empty ledger is itself one summary block.
        if not ledger.currencies:
            groups -= 1
        selected.append({"ledger_name": ledger.ledger_name, "currencies": currencies})
    return selected


def render_weekly_overview(
    *,
    context: dict[str, Any],
    language: Language = "en",
    html_budget: int = WEEKLY_OVERVIEW_HTML_BUDGET,
) -> tuple[str, str]:
    """Keep all summaries before upcoming rows, then a prefix of summary blocks.

    Every probe includes localized omission notices and the full-data link.
    Neither the input objects nor any monetary values are modified.
    """
    locale = EmailLocale(language)
    ledgers = context["ledgers"]
    total_groups = sum(max(1, len(ledger.currencies)) for ledger in ledgers)
    total_payments = sum(
        len(item.upcoming) for ledger in ledgers for item in ledger.currencies
    )

    def render(candidate: dict[str, Any], extension: str) -> str:
        return render_email_template(
            template_name=f"weekly_monthly_overview_report.{extension}",
            context=candidate,
            language=language,
        )

    full = {**context, "weekly_size_notice": ""}
    html = render(full, "html")
    if len(html.encode("utf-8")) <= html_budget:
        return html, render(full, "txt")

    def candidate(groups: int, payments: int) -> dict[str, Any]:
        selected = _take_ledgers(ledgers, groups, payments)
        return {
            **context,
            "ledgers": selected,
            "weekly_size_notice": locale.tr(
                "weekly_size_notice",
                shown_groups=sum(
                    max(1, len(ledger["currencies"])) for ledger in selected
                ),
                total_groups=total_groups,
                shown_payments=sum(
                    len(item["upcoming"])
                    for ledger in selected
                    for item in ledger["currencies"]
                ),
                total_payments=total_payments,
            ),
        }

    # First reserve space for all currency summaries without payment rows.
    summaries = candidate(total_groups, 0)
    summaries_html = render(summaries, "html")
    if len(summaries_html.encode("utf-8")) <= html_budget:
        best, best_html = summaries, summaries_html
        low, high = 1, total_payments
        search_payments = True
    else:
        best = candidate(0, 0)
        best_html = render(best, "html")
        if len(best_html.encode("utf-8")) > html_budget:
            raise ValueError("Weekly overview layout exceeds HTML budget")
        low, high = 1, total_groups
        search_payments = False
    while low <= high:
        middle = (low + high) // 2
        probe = (
            candidate(total_groups, middle) if search_payments else candidate(middle, 0)
        )
        rendered = render(probe, "html")
        if len(rendered.encode("utf-8")) <= html_budget:
            best, best_html = probe, rendered
            low = middle + 1
        else:
            high = middle - 1
    return best_html, render(best, "txt")
