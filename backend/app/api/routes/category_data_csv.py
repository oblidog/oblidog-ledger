import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from app.api.deps import SessionDep, require_ledger_view_access
from app.models import Ledger
from app.use_cases import category_data_csv
from app.use_cases.exceptions import (
    CategoryDataSchemaNotFoundError,
    CategoryNotFoundError,
)

router = APIRouter(tags=["categories"])


@router.get("/ledgers/{ledger_id}/categories/{category_id}/data-records.csv")
def export_category_data_records_csv(
    *,
    session: SessionDep,
    category_id: uuid.UUID,
    schema_version: int = Query(ge=1),
    observed_from: datetime | None = None,
    observed_to: datetime | None = None,
    ledger: Ledger = Depends(require_ledger_view_access),
) -> Response:
    try:
        filename, content = category_data_csv.export_category_data_csv(
            session=session,
            ledger_id=ledger.id,
            category_id=category_id,
            schema_version=schema_version,
            observed_from=observed_from,
            observed_to=observed_to,
        )
    except CategoryNotFoundError:
        raise HTTPException(status_code=404, detail="Category not found")
    except CategoryDataSchemaNotFoundError:
        raise HTTPException(status_code=404, detail="Category data schema not found")
    except category_data_csv.UnsupportedCategoryDataCsvSchemaError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return Response(
        content=content.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
