"""Render synthetic fixtures through the production Python/Jinja renderer."""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.email_rendering import render_email_template  # noqa: E402
from localized_fixtures import render_localized_fixture, weekly_fixture_context  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "emails" / "previews")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    for fixture in sorted((ROOT / "emails" / "fixtures").glob("*.json")):
        context = {"report": json.loads(fixture.read_text())}
        for extension in ("html", "txt"):
            rendered = render_email_template(
                template_name=f"foundation.{extension}", context=context
            )
            (args.out / f"{fixture.stem}.{extension}").write_text(rendered)
    for fixture in sorted((ROOT / "emails" / "fixtures" / "daily").glob("*.json")):
        context = json.loads(fixture.read_text())
        for extension in ("html", "txt"):
            rendered = render_email_template(
                template_name=f"daily_obligation_report.{extension}", context=context
            )
            (args.out / f"daily-{fixture.stem}.{extension}").write_text(rendered)
    for fixture in sorted((ROOT / "emails/fixtures/localized").glob("*.json")):
        raw = json.loads(fixture.read_text())
        for language in ("en", "pl"):
            html, text = render_localized_fixture(raw, language)
            for extension, content in (("html", html), ("txt", text)):
                (args.out / f"daily-{fixture.stem}-{language}.{extension}").write_text(
                    content
                )
    for language in ("en", "pl"):
        for empty in (False, True):
            for extension in ("html", "txt"):
                content = render_email_template(
                    template_name=f"weekly_monthly_overview_report.{extension}",
                    context=weekly_fixture_context(language, empty=empty),
                    language=language,
                )
                (
                    args.out
                    / f"weekly-{'empty' if empty else 'multi-currency'}-{language}.{extension}"
                ).write_text(content)
        transactional = {
            "project_name": "Oblidog",
            "email": "recipient@example.com",
            "username": "Custom_User_<>&",
            "password": "synthetic-password",
            "valid_hours": 22,
            "link": "https://example.com/unchanged-link",
        }
        for template in (
            "test_email",
            "reset_password",
            "new_account",
            "user_invitation",
        ):
            for extension in ("html", "txt"):
                content = render_email_template(
                    template_name=f"{template}.{extension}",
                    context=transactional,
                    language=language,
                )
                (args.out / f"{template}-{language}.{extension}").write_text(content)
    print(f"Rendered fixture previews in {args.out}")  # noqa: T201


if __name__ == "__main__":
    main()
