"""Immutable per-render email locale. No process-wide locale or browser inference."""

import json
from dataclasses import dataclass
from datetime import date as CalendarDate
from datetime import datetime as Timestamp
from decimal import Decimal, InvalidOperation
from pathlib import Path
from types import MappingProxyType
from typing import Literal

Language = Literal["en", "pl", "de"]
_DIRECTORY = Path(__file__).parent / "email-locales"
_CATALOGS = MappingProxyType(
    {
        language: MappingProxyType(
            json.loads((_DIRECTORY / f"{language}.json").read_text())
        )
        for language in ("en", "pl", "de")
    }
)


def recipient_language(preference: object = None) -> Language:
    if preference == "de":
        return "de"
    return "pl" if preference == "pl" else "en"


@dataclass(frozen=True, slots=True)
class EmailLocale:
    language: Language = "en"

    def tr(self, key: str, *, count: object = None, **params: object) -> str:
        if count is not None:
            if not isinstance(count, int):
                raise TypeError("Email plural count must be an integer")
            if self.language == "pl":
                suffix = (
                    "one"
                    if count == 1
                    else "few"
                    if count % 10 in (2, 3, 4) and count % 100 not in (12, 13, 14)
                    else "many"
                )
            else:
                suffix = "one" if count == 1 else "other"
            key = f"{key}_{suffix}"
            params["count"] = count
        return str(_CATALOGS[self.language][key]).format(**params)

    def amount(self, value: object) -> str:
        if value is None:
            return self.tr("unknown_amount_lower")
        try:
            number = Decimal(str(value))
            if not number.is_finite():
                return str(value)
        except InvalidOperation:
            return str(value)
        whole, _, fraction = format(number, "f").partition(".")
        separator = "," if self.language in ("pl", "de") else "."
        return f"{whole}{separator}{fraction.ljust(2, '0')}"

    def date(self, value: CalendarDate | str) -> str:
        parsed = CalendarDate.fromisoformat(value) if isinstance(value, str) else value
        return (
            parsed.strftime("%d.%m.%Y")
            if self.language in ("pl", "de")
            else parsed.isoformat()
        )

    def datetime(self, value: Timestamp) -> str:
        return (
            value.strftime("%d.%m.%Y %H:%M %z")
            if self.language in ("pl", "de")
            else value.isoformat(timespec="minutes")
        )

    def period(self, value: CalendarDate) -> str:
        return (
            value.strftime("%m.%Y")
            if self.language in ("pl", "de")
            else value.strftime("%Y-%m")
        )
