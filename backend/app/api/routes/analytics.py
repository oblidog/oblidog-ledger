import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query

from app.api.deps import SessionDep, require_ledger_view_access
from app.core.api_errors import ApplicationError as HTTPException
from app.domain import BillingPeriod
from app.models import Ledger
from app.schemas import (
    CategoryAmountHistoryPointPublic,
    CategoryAmountHistoryPublic,
    ComponentHistoryGroupPublic,
    ComponentHistoryPublic,
    ComponentHistoryTotalPublic,
    ComponentHistoryValuePublic,
    CurrencyCashflowPublic,
    CurrencyPaymentSummaryPublic,
    CurrencyPeriodTotalPublic,
    DailyCashflowPublic,
    ObligationPeriodPublic,
    ObligationPeriodTotalPublic,
    ObligationPeriodTotalsPublic,
    PeriodCashflowPublic,
    PeriodPaymentSummaryPublic,
)
from app.schemas.analytics import AvailableHistoryPeriodPublic
from app.schemas.attention import AttentionOverviewPublic
from app.use_cases import analytics as analytics_use_cases
from app.use_cases.attention import get_attention_overview
from app.use_cases.exceptions import CategoryNotFoundError

router = APIRouter(tags=["analytics"])


@router.get(
    "/ledgers/{ledger_id}/analytics/period-summary",
    response_model=PeriodPaymentSummaryPublic,
)
def read_period_payment_summary(
    *,
    session: SessionDep,
    year: int = Query(ge=1, le=9999),
    month: int = Query(ge=1, le=12),
    ledger: Ledger = Depends(require_ledger_view_access),
) -> Any:
    summary = analytics_use_cases.summarize_period_payment_progress(
        session=session,
        ledger_id=ledger.id,
        period=BillingPeriod(year=year, month=month),
    )
    return PeriodPaymentSummaryPublic(
        period=ObligationPeriodPublic(year=year, month=month),
        total_obligation_count=summary.total_obligation_count,
        paid_obligation_count=summary.paid_obligation_count,
        paid_percentage=summary.paid_percentage,
        unknown_amount_count=summary.unknown_amount_count,
        is_complete=summary.is_complete,
        amount_summaries=[
            CurrencyPaymentSummaryPublic(
                currency=item.currency,
                total_known_amount=item.total_known_amount,
                paid_known_amount=item.paid_known_amount,
                paid_percentage=item.paid_percentage,
            )
            for item in summary.amount_summaries
        ],
    )


@router.get(
    "/ledgers/{ledger_id}/analytics/categories/{category_id}/history",
    response_model=CategoryAmountHistoryPublic,
)
def read_category_amount_history(
    *,
    session: SessionDep,
    category_id: uuid.UUID,
    from_: str = Query(alias="from", pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    to: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    ledger: Ledger = Depends(require_ledger_view_access),
) -> Any:
    from_period = _parse_period(from_)
    to_period = _parse_period(to)
    try:
        history = analytics_use_cases.get_category_amount_history(
            session=session,
            ledger_id=ledger.id,
            category_id=category_id,
            from_period=from_period,
            to_period=to_period,
        )
    except CategoryNotFoundError as caught_error:
        raise HTTPException(
            code="category_not_found", status_code=404, detail="Category not found"
        ) from caught_error
    except ValueError as exc:
        raise HTTPException(
            code="analytics_invalid_range", status_code=422, detail=str(exc)
        ) from exc

    return CategoryAmountHistoryPublic(
        category_id=history.category_id,
        points=[
            CategoryAmountHistoryPointPublic(
                period=ObligationPeriodPublic(
                    year=point.period.year, month=point.period.month
                ),
                state=point.state,
                current_amount=point.current_amount,
                currency=point.currency,
            )
            for point in history.points
        ],
    )


@router.get(
    "/ledgers/{ledger_id}/analytics/period-totals",
    response_model=ObligationPeriodTotalsPublic,
)
def read_obligation_period_totals(
    *,
    session: SessionDep,
    from_: str = Query(alias="from", pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    to: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"),
    ledger: Ledger = Depends(require_ledger_view_access),
) -> Any:
    try:
        totals = analytics_use_cases.get_obligation_period_totals(
            session=session,
            ledger_id=ledger.id,
            from_period=_parse_period(from_),
            to_period=_parse_period(to),
        )
    except ValueError as exc:
        raise HTTPException(
            code="analytics_invalid_range", status_code=422, detail=str(exc)
        ) from exc

    return ObligationPeriodTotalsPublic(
        points=[
            ObligationPeriodTotalPublic(
                period=ObligationPeriodPublic(
                    year=point.period.year, month=point.period.month
                ),
                total_obligation_count=point.total_obligation_count,
                unknown_amount_count=point.unknown_amount_count,
                is_complete=point.is_complete,
                currency_summaries=[
                    CurrencyPeriodTotalPublic(
                        currency=summary.currency,
                        total_known_amount=summary.total_known_amount,
                    )
                    for summary in point.currency_summaries
                ],
            )
            for point in totals.points
        ]
    )


@router.get(
    "/ledgers/{ledger_id}/analytics/component-history",
    response_model=ComponentHistoryPublic,
)
def read_component_history(
    *,
    session: SessionDep,
    category_id: uuid.UUID,
    end_year: int = Query(ge=1, le=9999),
    end_month: int = Query(ge=1, le=12),
    periods: int = Query(default=6, ge=1, le=24),
    match_by: Literal["label", "external_id"] = Query(default="label"),
    available_only: bool = Query(default=False),
    ledger: Ledger = Depends(require_ledger_view_access),
) -> Any:
    try:
        history = analytics_use_cases.get_component_history(
            session=session,
            ledger_id=ledger.id,
            category_id=category_id,
            end_period=BillingPeriod(year=end_year, month=end_month),
            periods=periods,
            match_by=match_by,
            available_only=available_only,
        )
    except CategoryNotFoundError as caught_error:
        raise HTTPException(
            code="category_not_found", status_code=404, detail="Category not found"
        ) from caught_error
    except ValueError as exc:
        raise HTTPException(
            code="analytics_invalid_range", status_code=422, detail=str(exc)
        ) from exc

    return ComponentHistoryPublic(
        match_by=history.match_by,
        periods=[
            ObligationPeriodPublic(year=item.year, month=item.month)
            for item in history.periods
        ],
        components=[
            ComponentHistoryGroupPublic(
                identity=group.identity,
                label=group.label,
                type=group.type,
                source=group.source,
                external_id=group.external_id,
                values=[
                    ComponentHistoryValuePublic(
                        period=ObligationPeriodPublic(
                            year=value.period.year, month=value.period.month
                        ),
                        amount=value.amount,
                        state=value.state,
                        label=value.label,
                        source=value.source,
                        external_id=value.external_id,
                    )
                    for value in group.values
                ],
            )
            for group in history.components
        ],
        totals=[
            ComponentHistoryTotalPublic(
                period=ObligationPeriodPublic(
                    year=total.period.year, month=total.period.month
                ),
                amount=total.amount,
                currency=total.currency,
                obligation_amount=total.obligation_amount,
                unpriced_component_count=total.unpriced_component_count,
            )
            for total in history.totals
        ],
    )


def _parse_period(value: str) -> BillingPeriod:
    year, month = value.split("-")
    return BillingPeriod(year=int(year), month=int(month))


@router.get(
    "/ledgers/{ledger_id}/analytics/cashflow", response_model=PeriodCashflowPublic
)
def read_remaining_period_cashflow(
    *,
    session: SessionDep,
    year: int = Query(ge=1, le=9999),
    month: int = Query(ge=1, le=12),
    ledger: Ledger = Depends(require_ledger_view_access),
) -> Any:
    cashflow = analytics_use_cases.get_remaining_period_cashflow(
        session=session,
        ledger_id=ledger.id,
        period=BillingPeriod(year=year, month=month),
    )
    return PeriodCashflowPublic(
        period=ObligationPeriodPublic(year=year, month=month),
        as_of_date=cashflow.as_of_date,
        unknown_amount_count=cashflow.unknown_amount_count,
        without_due_date_count=cashflow.without_due_date_count,
        is_complete=cashflow.is_complete,
        currency_summaries=[
            CurrencyCashflowPublic(
                currency=summary.currency,
                total_known_amount=summary.total_known_amount,
                scheduled_known_amount=summary.scheduled_known_amount,
                unscheduled_known_amount=summary.unscheduled_known_amount,
                overdue_known_amount=summary.overdue_known_amount,
                daily=[
                    DailyCashflowPublic(
                        due_date=item.due_date,
                        amount=item.amount,
                        cumulative_amount=item.cumulative_amount,
                        is_overdue=item.is_overdue,
                    )
                    for item in summary.daily
                ],
            )
            for summary in cashflow.currency_summaries
        ],
    )


@router.get(
    "/ledgers/{ledger_id}/analytics/history-periods",
    response_model=list[AvailableHistoryPeriodPublic],
)
def read_available_history_periods(
    *,
    session: SessionDep,
    ledger: Ledger = Depends(require_ledger_view_access),
) -> Any:
    return [
        AvailableHistoryPeriodPublic(
            category_id=item.category_id,
            period=ObligationPeriodPublic(
                year=item.period.year, month=item.period.month
            ),
            has_components=item.has_components,
        )
        for item in analytics_use_cases.get_available_history_periods(
            session=session, ledger_id=ledger.id
        )
    ]


@router.get(
    "/ledgers/{ledger_id}/analytics/attention", response_model=AttentionOverviewPublic
)
def read_attention_overview(
    *,
    session: SessionDep,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=8, ge=1, le=50),
    ledger: Ledger = Depends(require_ledger_view_access),
) -> AttentionOverviewPublic:
    return get_attention_overview(
        session=session, ledger=ledger, offset=offset, limit=limit
    )
