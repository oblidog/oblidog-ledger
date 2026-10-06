import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import (
    SessionDep,
    require_ledger_edit_access,
    require_ledger_view_access,
)
from app.core.business_date import business_today
from app.core.config import settings
from app.domain.business_calendar import BusinessCalendar
from app.domain.payment_schedule import next_payment
from app.models import (
    Category,
    CategoryDataRecord,
    CategoryDataSchema,
    CategoryGroup,
    Ledger,
)
from app.schemas import (
    CategoriesPublic,
    CategoryCreate,
    CategoryDataRecordPublic,
    CategoryDataRecordsPublic,
    CategoryDataSchemaCreate,
    CategoryDataSchemaPublic,
    CategoryGroupCreate,
    CategoryGroupPublic,
    CategoryGroupsPublic,
    CategoryGroupUpdate,
    CategoryPublic,
    CategoryUpdate,
)
from app.schemas.categories import SchedulePreviewPublic, SchedulePreviewRequest
from app.services import demo_limits
from app.use_cases import categories as category_use_cases
from app.use_cases import category_data_records as category_data_record_use_cases
from app.use_cases.exceptions import (
    CategoryDataSchemaNotFoundError,
    CategoryGroupArchivedError,
    CategoryGroupHasActiveChildrenError,
    CategoryGroupNotFoundError,
    CategoryNotFoundError,
    CrossLedgerReferenceError,
    DuplicateCategoryCodeError,
    DuplicateCategoryError,
    DuplicateCategoryGroupError,
    IncompatibleCategoryDataSchemaError,
    InvalidCategoryCodeError,
    InvalidCategoryDataSchemaError,
)

router = APIRouter(tags=["categories"])


@router.post(
    "/ledgers/{ledger_id}/categories/schedule-preview",
    response_model=SchedulePreviewPublic,
)
def preview_payment_schedule(
    *,
    schedule_in: SchedulePreviewRequest,
    _ledger: Ledger = Depends(require_ledger_view_access),
) -> SchedulePreviewPublic:
    """Preview an unsaved schedule without creating or changing obligations."""
    payment = next_payment(
        first_due_date=schedule_in.first_due_date,
        interval=schedule_in.recurrence_interval,
        unit=schedule_in.recurrence_unit,
        reference_date=schedule_in.reference_date or business_today(),
        calendar=BusinessCalendar(settings.BUSINESS_CALENDAR_COUNTRY),
    )
    return SchedulePreviewPublic(
        period_year=payment.period.year if payment else None,
        period_month=payment.period.month if payment else None,
        scheduled_date=payment.scheduled_date if payment else None,
        due_date=payment.due_date if payment else None,
        calendar_country=settings.BUSINESS_CALENDAR_COUNTRY,
    )


def _to_category_group_public(category_group: CategoryGroup) -> CategoryGroupPublic:
    return CategoryGroupPublic.model_validate(category_group)


def _to_category_public(category: Category) -> CategoryPublic:
    return CategoryPublic.model_validate(category)


def _to_category_data_record_public(
    category_data: CategoryDataRecord,
) -> CategoryDataRecordPublic:
    return CategoryDataRecordPublic(
        id=category_data.id,
        schema_version=category_data.schema_version,
        observed_at=category_data.observed_at,
        created_at=category_data.created_at,
        data=category_data.data,
        source=category_data.source,
        external_id=category_data.external_id,
    )


def _to_category_data_schema_public(
    category_schema: CategoryDataSchema,
) -> CategoryDataSchemaPublic:
    return CategoryDataSchemaPublic(
        version=category_schema.version,
        definition=category_schema.schema,
        is_active=category_schema.is_active,
        created_at=category_schema.created_at,
    )


@router.get("/ledgers/{ledger_id}/category-groups", response_model=CategoryGroupsPublic)
def read_category_groups(
    session: SessionDep,
    include_archived: bool = False,
    ledger: Ledger = Depends(require_ledger_view_access),
) -> Any:
    category_groups = category_use_cases.list_category_groups_for_ledger(
        session=session,
        ledger_id=ledger.id,
        include_archived=include_archived,
    )
    return CategoryGroupsPublic(
        data=[_to_category_group_public(group) for group in category_groups],
        count=len(category_groups),
    )


@router.post("/ledgers/{ledger_id}/category-groups", response_model=CategoryGroupPublic)
def create_category_group(
    *,
    session: SessionDep,
    category_group_in: CategoryGroupCreate,
    ledger: Ledger = Depends(require_ledger_edit_access),
) -> Any:
    demo_limits.remaining_capacity(
        session,
        owner_user_id=ledger.owner_user_id,
        model=CategoryGroup,
        predicate=CategoryGroup.ledger_id == ledger.id,
        limit=demo_limits.MAX_GROUPS,
        resource="category groups per ledger",
    )
    try:
        category_group = category_use_cases.create_category_group(
            session=session,
            ledger_id=ledger.id,
            name=category_group_in.name,
            description=category_group_in.description,
        )
    except DuplicateCategoryGroupError as caught_error:
        raise HTTPException(
            status_code=409, detail="Category group already exists"
        ) from caught_error

    return _to_category_group_public(category_group)


@router.patch(
    "/ledgers/{ledger_id}/category-groups/{category_group_id}",
    response_model=CategoryGroupPublic,
)
def update_category_group(
    *,
    session: SessionDep,
    category_group_id: uuid.UUID,
    category_group_in: CategoryGroupUpdate,
    ledger: Ledger = Depends(require_ledger_edit_access),
) -> Any:
    try:
        category_group = category_use_cases.update_category_group(
            session=session,
            ledger_id=ledger.id,
            category_group_id=category_group_id,
            name=category_group_in.name,
            description=category_group_in.description,
        )
    except CategoryGroupNotFoundError as caught_error:
        raise HTTPException(
            status_code=404, detail="Category group not found"
        ) from caught_error
    except DuplicateCategoryGroupError as caught_error:
        raise HTTPException(
            status_code=409, detail="Category group already exists"
        ) from caught_error
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return _to_category_group_public(category_group)


@router.patch(
    "/ledgers/{ledger_id}/category-groups/{category_group_id}/archive",
    response_model=CategoryGroupPublic,
)
def archive_category_group(
    *,
    session: SessionDep,
    category_group_id: uuid.UUID,
    ledger: Ledger = Depends(require_ledger_edit_access),
) -> Any:
    try:
        category_group = category_use_cases.archive_category_group(
            session=session,
            ledger_id=ledger.id,
            category_group_id=category_group_id,
        )
    except CategoryGroupNotFoundError as caught_error:
        raise HTTPException(
            status_code=404, detail="Category group not found"
        ) from caught_error
    except CategoryGroupHasActiveChildrenError as caught_error:
        raise HTTPException(
            status_code=409,
            detail="Category group has active categories",
        ) from caught_error

    return _to_category_group_public(category_group)


@router.get("/ledgers/{ledger_id}/categories", response_model=CategoriesPublic)
def read_categories(
    session: SessionDep,
    include_archived: bool = False,
    category_group_id: uuid.UUID | None = None,
    ledger: Ledger = Depends(require_ledger_view_access),
) -> Any:
    categories = category_use_cases.list_categories_for_ledger(
        session=session,
        ledger_id=ledger.id,
        category_group_id=category_group_id,
        include_archived=include_archived,
    )
    return CategoriesPublic(
        data=[_to_category_public(category) for category in categories],
        count=len(categories),
    )


@router.post("/ledgers/{ledger_id}/categories", response_model=CategoryPublic)
def create_category(
    *,
    session: SessionDep,
    category_in: CategoryCreate,
    ledger: Ledger = Depends(require_ledger_edit_access),
) -> Any:
    demo_limits.remaining_capacity(
        session,
        owner_user_id=ledger.owner_user_id,
        model=Category,
        predicate=Category.ledger_id == ledger.id,
        limit=demo_limits.MAX_CATEGORIES,
        resource="categories per ledger",
    )
    try:
        category = category_use_cases.create_category(
            session=session,
            ledger_id=ledger.id,
            category_group_id=category_in.category_group_id,
            name=category_in.name,
            description=category_in.description,
            code=category_in.code,
            data_source_policy=category_in.data_source_policy,
            recurrence_interval=category_in.recurrence_interval,
            recurrence_unit=category_in.recurrence_unit,
            first_due_date=category_in.first_due_date,
            currency=category_in.currency,
        )
    except CategoryGroupNotFoundError as caught_error:
        raise HTTPException(
            status_code=404, detail="Category group not found"
        ) from caught_error
    except CrossLedgerReferenceError as caught_error:
        raise HTTPException(
            status_code=404, detail="Category group not found"
        ) from caught_error
    except DuplicateCategoryError as caught_error:
        raise HTTPException(
            status_code=409, detail="Category already exists"
        ) from caught_error
    except DuplicateCategoryCodeError as caught_error:
        raise HTTPException(
            status_code=409, detail="Category code already exists"
        ) from caught_error
    except InvalidCategoryCodeError as caught_error:
        raise HTTPException(
            status_code=422,
            detail="Category code must contain exactly four uppercase English letters",
        ) from caught_error
    except CategoryGroupArchivedError as caught_error:
        raise HTTPException(
            status_code=409, detail="Category group is archived"
        ) from caught_error

    return _to_category_public(category)


@router.patch(
    "/ledgers/{ledger_id}/categories/{category_id}",
    response_model=CategoryPublic,
)
def update_category(
    *,
    session: SessionDep,
    category_id: uuid.UUID,
    category_in: CategoryUpdate,
    ledger: Ledger = Depends(require_ledger_edit_access),
) -> Any:
    try:
        category = category_use_cases.update_category(
            session=session,
            ledger_id=ledger.id,
            category_id=category_id,
            category_group_id=category_in.category_group_id,
            name=category_in.name,
            description=category_in.description,
            data_source_policy=category_in.data_source_policy,
            recurrence_interval=category_in.recurrence_interval,
            recurrence_unit=category_in.recurrence_unit,
            first_due_date=category_in.first_due_date,
            currency=category_in.currency,
        )
    except CategoryNotFoundError as caught_error:
        raise HTTPException(
            status_code=404, detail="Category not found"
        ) from caught_error
    except CategoryGroupNotFoundError as caught_error:
        raise HTTPException(
            status_code=404, detail="Category group not found"
        ) from caught_error
    except CategoryGroupArchivedError as caught_error:
        raise HTTPException(
            status_code=409, detail="Category group is archived"
        ) from caught_error
    except DuplicateCategoryError as caught_error:
        raise HTTPException(
            status_code=409, detail="Category already exists"
        ) from caught_error
    except DuplicateCategoryCodeError as caught_error:
        raise HTTPException(
            status_code=409, detail="Category code already exists"
        ) from caught_error
    except InvalidCategoryCodeError as caught_error:
        raise HTTPException(
            status_code=422,
            detail="Category code must contain exactly four uppercase English letters",
        ) from caught_error
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return _to_category_public(category)


@router.get(
    "/ledgers/{ledger_id}/categories/{category_id}/data-records",
    response_model=CategoryDataRecordsPublic,
)
def read_category_data_records(
    *,
    session: SessionDep,
    category_id: uuid.UUID,
    schema_version: int | None = Query(default=None, ge=1),
    observed_from: datetime | None = None,
    observed_to: datetime | None = None,
    limit: int = Query(default=100, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    ledger: Ledger = Depends(require_ledger_view_access),
) -> CategoryDataRecordsPublic:
    try:
        records = category_data_record_use_cases.list_category_data_records(
            session=session,
            ledger_id=ledger.id,
            category_id=category_id,
            schema_version=schema_version,
            observed_from=observed_from,
            observed_to=observed_to,
            limit=limit,
            offset=offset,
        )
        count = category_data_record_use_cases.count_category_data_records(
            session=session,
            ledger_id=ledger.id,
            category_id=category_id,
            schema_version=schema_version,
            observed_from=observed_from,
            observed_to=observed_to,
        )
    except CategoryNotFoundError as caught_error:
        raise HTTPException(
            status_code=404, detail="Category not found"
        ) from caught_error
    except CategoryDataSchemaNotFoundError as caught_error:
        raise HTTPException(
            status_code=404, detail="Category data schema not found"
        ) from caught_error
    return CategoryDataRecordsPublic(
        data=[_to_category_data_record_public(record) for record in records],
        count=count,
    )


@router.get(
    "/ledgers/{ledger_id}/categories/{category_id}/data-records/latest",
    response_model=CategoryDataRecordPublic,
)
def read_latest_category_data_record(
    *,
    session: SessionDep,
    category_id: uuid.UUID,
    ledger: Ledger = Depends(require_ledger_view_access),
) -> CategoryDataRecordPublic:
    try:
        record = category_use_cases.get_category_data_record(
            session=session,
            ledger_id=ledger.id,
            category_id=category_id,
        )
    except CategoryNotFoundError as caught_error:
        raise HTTPException(
            status_code=404, detail="Category not found"
        ) from caught_error
    except CategoryDataSchemaNotFoundError as caught_error:
        raise HTTPException(
            status_code=404, detail="Category data records not found"
        ) from caught_error
    return _to_category_data_record_public(record)


@router.get(
    "/ledgers/{ledger_id}/categories/{category_id}/data-schema",
    response_model=CategoryDataSchemaPublic,
)
def read_category_data_schema(
    *,
    session: SessionDep,
    category_id: uuid.UUID,
    ledger: Ledger = Depends(require_ledger_view_access),
) -> Any:
    try:
        category_schema = category_use_cases.get_category_data_schema(
            session=session, ledger_id=ledger.id, category_id=category_id
        )
    except CategoryNotFoundError as caught_error:
        raise HTTPException(
            status_code=404, detail="Category not found"
        ) from caught_error
    except CategoryDataSchemaNotFoundError as caught_error:
        raise HTTPException(
            status_code=404, detail="Category data schema not found"
        ) from caught_error
    return _to_category_data_schema_public(category_schema)


@router.post(
    "/ledgers/{ledger_id}/categories/{category_id}/data-schema",
    response_model=CategoryDataSchemaPublic,
)
def create_category_data_schema(
    *,
    session: SessionDep,
    category_id: uuid.UUID,
    category_schema_in: CategoryDataSchemaCreate,
    ledger: Ledger = Depends(require_ledger_edit_access),
) -> Any:
    demo_limits.remaining_capacity(
        session,
        owner_user_id=ledger.owner_user_id,
        model=CategoryDataSchema,
        predicate=CategoryDataSchema.category_id == category_id,
        limit=demo_limits.MAX_SCHEMA_VERSIONS,
        resource="schema versions per category",
    )
    try:
        category_schema = category_use_cases.set_category_data_schema(
            session=session,
            ledger_id=ledger.id,
            category_id=category_id,
            schema=category_schema_in.definition,
        )
    except CategoryNotFoundError as caught_error:
        raise HTTPException(
            status_code=404, detail="Category not found"
        ) from caught_error
    except InvalidCategoryDataSchemaError as exc:
        raise HTTPException(
            status_code=422, detail=f"Invalid JSON Schema: {exc}"
        ) from exc
    except IncompatibleCategoryDataSchemaError as exc:
        raise HTTPException(
            status_code=409,
            detail=f"Schema is incompatible with existing category data: {exc}",
        ) from exc
    return _to_category_data_schema_public(category_schema)


@router.patch(
    "/ledgers/{ledger_id}/categories/{category_id}/archive",
    response_model=CategoryPublic,
)
def archive_category(
    *,
    session: SessionDep,
    category_id: uuid.UUID,
    ledger: Ledger = Depends(require_ledger_edit_access),
) -> Any:
    try:
        category = category_use_cases.archive_category(
            session=session,
            ledger_id=ledger.id,
            category_id=category_id,
        )
    except CategoryNotFoundError as caught_error:
        raise HTTPException(
            status_code=404, detail="Category not found"
        ) from caught_error

    return _to_category_public(category)


@router.patch(
    "/ledgers/{ledger_id}/categories/{category_id}/restore",
    response_model=CategoryPublic,
)
def restore_category(
    *,
    session: SessionDep,
    category_id: uuid.UUID,
    ledger: Ledger = Depends(require_ledger_edit_access),
) -> Any:
    try:
        category = category_use_cases.restore_category(
            session=session,
            ledger_id=ledger.id,
            category_id=category_id,
        )
    except CategoryNotFoundError as caught_error:
        raise HTTPException(
            status_code=404, detail="Category not found"
        ) from caught_error
    except CategoryGroupArchivedError as caught_error:
        raise HTTPException(
            status_code=409,
            detail="Category group must be active before restoring a category",
        ) from caught_error

    return _to_category_public(category)
