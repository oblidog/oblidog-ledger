from fastapi import APIRouter

from app.api.deps import CurrentUser, SessionDep
from app.core.config import settings
from app.domain import BillingPeriod
from app.domain.business_calendar import BusinessCalendar
from app.domain.payment_schedule import payment_for_period
from app.schemas.categories import SchedulePreviewPublic
from app.schemas.onboarding import (
    FirstPaymentPreview,
    OnboardingCommand,
    OnboardingState,
)
from app.use_cases import onboarding

router = APIRouter(prefix="/onboarding", tags=["onboarding"])


@router.get("/", response_model=OnboardingState)
def read_onboarding(current_user: CurrentUser) -> OnboardingState:
    return onboarding.read_progress(current_user)


@router.post("/", response_model=OnboardingState)
def advance_onboarding(
    command: OnboardingCommand,
    session: SessionDep,
    current_user: CurrentUser,
) -> OnboardingState:
    return onboarding.advance(session=session, user_id=current_user.id, command=command)


@router.post("/schedule-preview", response_model=SchedulePreviewPublic)
def preview_first_payment(
    schedule: FirstPaymentPreview, _current_user: CurrentUser
) -> SchedulePreviewPublic:
    """Pure calculation, including an unsaved workspace in the demo preview."""
    country = schedule.business_calendar_country or settings.BUSINESS_CALENDAR_COUNTRY
    payment = payment_for_period(
        first_due_date=schedule.first_due_date,
        period=BillingPeriod.from_date(schedule.first_due_date),
        calendar=BusinessCalendar(country),
    )
    return SchedulePreviewPublic(
        period_year=payment.period.year,
        period_month=payment.period.month,
        scheduled_date=payment.scheduled_date,
        due_date=payment.due_date,
        calendar_country=country,
    )
