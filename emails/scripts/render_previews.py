"""Render synthetic fixtures through the production Python/Jinja renderer."""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.email_rendering import render_email_template  # noqa: E402


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
    print(f"Rendered fixture previews in {args.out}")  # noqa: T201


if __name__ == "__main__":
    main()
