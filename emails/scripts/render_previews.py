"""Render synthetic fixtures through the production Python/Jinja renderer."""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.email_rendering import render_email_template  # noqa: E402
from localized_fixtures import render_localized_fixture  # noqa: E402
from weekly_fixtures import render_weekly_fixture  # noqa: E402


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
    for fixture in sorted((ROOT / "emails/fixtures/weekly").glob("*.json")):
        raw = json.loads(fixture.read_text())
        for language in ("en", "pl"):
            html, text = render_weekly_fixture(raw, language)
            for extension, content in (("html", html), ("txt", text)):
                (args.out / f"weekly-{fixture.stem}-{language}.{extension}").write_text(
                    content
                )
    for fixture in sorted((ROOT / "emails/fixtures/transactional").glob("*.json")):
        messages = json.loads(fixture.read_text())
        for language in ("en", "pl"):
            for template, context in messages.items():
                for extension in ("html", "txt"):
                    content = render_email_template(
                        template_name=f"{template}.{extension}",
                        context=context,
                        language=language,
                    )
                    (
                        args.out / f"{template}-{fixture.stem}-{language}.{extension}"
                    ).write_text(content)
    print(f"Rendered fixture previews in {args.out}")  # noqa: T201


if __name__ == "__main__":
    main()
