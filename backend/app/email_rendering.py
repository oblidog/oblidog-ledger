"""Render trusted, packaged Jinja templates without a JavaScript runtime."""

from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

from .email_i18n import EmailLocale, recipient_language

_TEMPLATE_DIRECTORY = Path(__file__).parent / "email-templates" / "build"
_ENVIRONMENT = Environment(
    loader=FileSystemLoader(_TEMPLATE_DIRECTORY),
    autoescape=select_autoescape(enabled_extensions=("html", "xml")),
    keep_trailing_newline=True,
)


def render_email_template(
    *, template_name: str, context: dict[str, Any], language: object = None
) -> str:
    """Escape HTML data; preserve literal text for multipart plain-text bodies.

    Templates are developer-owned. Context values must never be compiled as
    Jinja source or marked safe. Callers own URL validation and business rules.
    """
    locale = EmailLocale(recipient_language(language))
    return _ENVIRONMENT.get_template(template_name).render(
        {
            **context,
            "language": locale.language,
            "tr": locale.tr,
            "fmt_amount": locale.amount,
            "fmt_date": locale.date,
        }
    )
