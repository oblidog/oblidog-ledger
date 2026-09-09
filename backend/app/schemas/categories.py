import uuid
from datetime import date, datetime
from typing import Any, cast

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    model_serializer,
    model_validator,
)

from app.domain import Currency, DataSourcePolicy, RecurrenceUnit
from app.schemas.counterparties import CounterpartySummaryPublic


class CategoryGroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None


class CategoryGroupUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None


class CategoryCreate(BaseModel):
    category_group_id: uuid.UUID
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    code: str = Field(min_length=4, max_length=4, pattern=r"^[A-Z]{4}$")
    data_source_policy: DataSourcePolicy = DataSourcePolicy.HYBRID
    recurrence_interval: int | None = Field(default=None, gt=0)
    recurrence_unit: RecurrenceUnit | None = None
    first_due_date: date | None = None
    currency: Currency = Currency.PLN


class CategoryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category_group_id: uuid.UUID | None = None
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    data_source_policy: DataSourcePolicy
    recurrence_interval: int | None = Field(default=None, gt=0)
    recurrence_unit: RecurrenceUnit | None = None
    first_due_date: date | None = None
    currency: Currency = Currency.PLN


class CategoryGroupPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    ledger_id: uuid.UUID
    name: str
    description: str | None
    is_active: bool
    archived_at: datetime | None


class CategoryGroupsPublic(BaseModel):
    data: list[CategoryGroupPublic]
    count: int


class CategoryPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    ledger_id: uuid.UUID
    category_group_id: uuid.UUID
    counterparty_id: uuid.UUID | None
    counterparty: CounterpartySummaryPublic | None
    name: str
    description: str | None
    is_active: bool
    code: str
    data_source_policy: DataSourcePolicy
    recurrence_interval: int | None
    recurrence_unit: RecurrenceUnit | None
    first_due_date: date | None
    currency: Currency
    archived_at: datetime | None
    has_data_schema: bool
    active_data_schema_version: int | None


class CategoriesPublic(BaseModel):
    data: list[CategoryPublic]
    count: int


class CategoryDataRecordCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    observed_at: datetime
    data: dict[str, Any]
    source: str | None = Field(default=None, min_length=1, max_length=255)
    external_id: str | None = Field(default=None, min_length=1, max_length=255)


class CategoryDataRecordPublic(BaseModel):
    id: uuid.UUID
    schema_version: int
    observed_at: datetime
    created_at: datetime
    data: dict[str, Any]
    source: str | None
    external_id: str | None


class CategoryDataRecordsPublic(BaseModel):
    data: list[CategoryDataRecordPublic]
    count: int


def _schema_create_openapi(schema: dict[str, Any]) -> None:
    properties = schema["properties"]
    properties["schema"] = properties.pop("definition")
    schema["required"] = ["schema"]


def _schema_public_openapi(schema: dict[str, Any]) -> None:
    schema.clear()
    schema.update(
        {
            "type": "object",
            "properties": {
                "version": {"type": "integer"},
                "schema": {"type": "object", "additionalProperties": True},
                "is_active": {"type": "boolean"},
                "created_at": {"type": "string", "format": "date-time"},
            },
            "required": ["version", "schema", "is_active", "created_at"],
        }
    )


class CategoryDataSchemaCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", json_schema_extra=_schema_create_openapi)

    definition: dict[str, Any]

    @model_validator(mode="before")
    @classmethod
    def map_schema_field(cls, value: Any) -> Any:
        if isinstance(value, dict) and "schema" in value:
            return {
                "definition": value["schema"],
                **{key: item for key, item in value.items() if key != "schema"},
            }
        return value


class CategoryDataSchemaPublic(BaseModel):
    version: int
    definition: dict[str, Any]
    is_active: bool
    created_at: datetime

    @classmethod
    def __get_pydantic_json_schema__(
        cls, core_schema: Any, handler: Any
    ) -> dict[str, Any]:
        schema = cast(dict[str, Any], handler(core_schema))
        _schema_public_openapi(schema)
        return schema

    @model_serializer
    def serialize_model(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "schema": self.definition,
            "is_active": self.is_active,
            "created_at": self.created_at,
        }
