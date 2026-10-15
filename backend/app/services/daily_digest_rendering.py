"""Fit a complete daily-digest presentation into an explicit UTF-8 HTML budget."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import replace
from typing import TYPE_CHECKING, Any

from ..email_rendering import render_email_template
from .daily_digest_presentation import DailyDigest, DigestSection

if TYPE_CHECKING:
    from .daily_obligation_report import DailyActivityItem, IntegrationHealthItem

# Leave room below Gmail's approximately 102 KB clipping threshold.
DAILY_DIGEST_HTML_BUDGET = 90 * 1024


def _take_groups[T](
    groups: Mapping[str, Sequence[T]], limit: int
) -> dict[str, Sequence[T]]:
    selected = {}
    for name, items in groups.items():
        if limit <= 0:
            break
        selected[name] = items[:limit]
        limit -= len(selected[name])
    return selected


def _take_obligations(digest: DailyDigest, limit: int) -> DailyDigest:
    sections: list[DigestSection] = []
    for section in digest.sections:
        ledgers = []
        shown = 0
        for ledger in section.ledgers:
            rows = ledger.obligations[: max(0, limit)]
            if rows:
                ledgers.append(replace(ledger, obligations=rows))
                shown += len(rows)
                limit -= len(rows)
        sections.append(
            replace(
                section, ledgers=tuple(ledgers), omitted_count=section.count - shown
            )
        )
    # Summary counts and currency subtotals describe the complete selection.
    return replace(digest, sections=tuple(sections))


def render_daily_digest(
    *,
    project_name: str,
    report_date: str,
    digest: DailyDigest,
    activity: Mapping[str, Sequence[DailyActivityItem]],
    activity_truncated: bool,
    integration_health: Mapping[str, Sequence[IntegrationHealthItem]],
    integration_health_truncated: bool,
    app_url: str,
    html_budget: int = DAILY_DIGEST_HTML_BUDGET,
) -> tuple[str, str]:
    """Retain a priority prefix, with explicit omissions in both MIME alternatives.

    Only presentation is shortened. Never slice rendered HTML or mutate the
    original selection. The binary search bounds rendering to O(log N) probes.
    """
    obligation_count = sum(section.count for section in digest.sections)
    health_count = sum(len(items) for items in integration_health.values())
    activity_count = sum(len(items) for items in activity.values())
    total = obligation_count + health_count + activity_count

    def candidate(keep: int, *, shortened: bool) -> dict[str, Any]:
        obligations_kept = min(keep, obligation_count)
        health_kept = min(max(0, keep - obligation_count), health_count)
        activity_kept = min(
            max(0, keep - obligation_count - health_count), activity_count
        )
        notice = (
            "This email was shortened. "
            f"Showing {obligations_kept} of {obligation_count} selected obligations, "
            f"{health_kept} of {health_count} selected integrations and "
            f"{activity_kept} of {activity_count} selected activity updates. "
            "Open Oblidog to review the remaining items."
            if shortened
            else ""
        )
        return {
            "project_name": project_name,
            "report_date": report_date,
            "digest": _take_obligations(digest, obligations_kept)
            if shortened
            else digest,
            "activity": _take_groups(activity, activity_kept),
            "activity_truncated": activity_truncated or activity_kept < activity_count,
            "integration_health": _take_groups(integration_health, health_kept),
            "integration_health_truncated": integration_health_truncated
            or health_kept < health_count,
            "size_notice": notice,
            "app_url": app_url,
        }

    def render(context: dict[str, Any], extension: str) -> str:
        return render_email_template(
            template_name=f"daily_obligation_report.{extension}", context=context
        )

    full = candidate(total, shortened=False)
    html = render(full, "html")
    if len(html.encode("utf-8")) <= html_budget:
        return html, render(full, "txt")

    # The omitted-items notices and full-data link are included in every probe.
    best = candidate(0, shortened=True)
    best_html = render(best, "html")
    if len(best_html.encode("utf-8")) > html_budget:
        raise ValueError(
            "Daily digest layout exceeds HTML budget even without detail rows"
        )
    low, high = 1, total
    while low <= high:
        middle = (low + high) // 2
        context = candidate(middle, shortened=True)
        rendered = render(context, "html")
        if len(rendered.encode("utf-8")) <= html_budget:
            best, best_html = context, rendered
            low = middle + 1
        else:
            high = middle - 1
    return best_html, render(best, "txt")
