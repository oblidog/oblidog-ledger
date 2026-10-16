"""Transactional React Email/Jinja contracts using synthetic data and no SMTP."""

import html
import importlib
import json
import sys
from email import policy
from email.parser import BytesParser
from html.parser import HTMLParser
from pathlib import Path

import pytest
from emails.message import Message

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.email_i18n import EmailLocale  # noqa: E402
from app.email_rendering import render_email_template  # noqa: E402

KINDS = ("reset_password", "user_invitation", "new_account", "test_email")
CASES = ("normal", "long-content", "escaped", "missing-name")


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.targets = []
        self.text = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self.targets.append(dict(attrs).get("href"))

    def handle_data(self, data):
        self.text.append(data)


@pytest.mark.parametrize("language", ["en", "pl"])
@pytest.mark.parametrize("name", CASES)
@pytest.mark.parametrize("kind", KINDS)
def test_all_transactional_parts_keep_context_actions_expiry_and_shared_layout(
    kind, name, language
):
    context = json.loads(
        (ROOT / f"emails/fixtures/transactional/{name}.json").read_text()
    )[kind]
    locale = EmailLocale(language)
    markup = render_email_template(
        template_name=f"{kind}.html", context=context, language=language
    )
    text = render_email_template(
        template_name=f"{kind}.txt", context=context, language=language
    )
    assert f'lang="{language}"' in markup
    assert 'class="email-shell"' in markup
    assert 'role="presentation"' in markup
    assert "OBLIDOG_JINJA_" not in markup and "{%" not in markup
    assert "<img" not in markup and "<script" not in markup
    assert "fonts.googleapis" not in markup and "@import" not in markup
    parsed = Links()
    parsed.feed(markup)
    visible = " ".join(parsed.text)
    assert context["project_name"] in visible
    assert context["project_name"] in text
    if kind in ("user_invitation", "test_email"):
        assert context["email"] in visible and context["email"] in text
    if kind != "test_email":
        assert parsed.targets == [context["link"], context["link"]]
        assert context["link"] in visible and context["link"] in text
        assert locale.tr("copy_link") in visible
    else:
        assert parsed.targets == []
        assert (
            locale.tr("test_delivery_ok") in visible
            and locale.tr("test_delivery_ok") in text
        )
    if kind in ("user_invitation", "reset_password"):
        key = "invitation_expiry" if kind == "user_invitation" else "reset_expiry"
        assert locale.tr(key, count=context["valid_hours"]) in visible
        assert locale.tr(key, count=context["valid_hours"]) in text
    if kind == "reset_password":
        greeting = locale.tr(
            "hello", username=context.get("username") or context["email"]
        )
        assert greeting in visible and greeting in text
    if kind == "new_account":
        assert context["password"] in visible and context["password"] in text
        if not context.get("username"):
            assert locale.tr("username") + ":" not in visible + text
    if name == "escaped":
        assert "Custom_&lt;&gt;&amp;" in markup
        if kind in ("new_account", "reset_password"):
            assert "&lt;img src=x&gt; &amp; {{ 7*7 }}" in markup
            assert "<img src=x> & {{ 7*7 }}" in text
    message = Message(
        html=markup,
        text=text,
        subject="Synthetic transactional email",
        mail_from=("Oblidog", "noreply@example.com"),
    )
    wire = BytesParser(policy=policy.default).parsebytes(
        message.as_message().as_bytes()
    )
    parts = {
        part.get_content_type(): part.get_content()
        for part in wire.walk()
        if part.get_content_type() in ("text/html", "text/plain")
    }
    assert set(parts) == {"text/html", "text/plain"}
    assert context["project_name"] in html.unescape(parts["text/html"])
    if "link" in context:
        delivered = Links()
        delivered.feed(parts["text/html"])
        assert delivered.targets == [context["link"], context["link"]]
        assert context["link"] in parts["text/plain"]


@pytest.mark.parametrize("language", ["en", "pl"])
def test_actual_generators_preserve_encoded_tokens_and_subjects(monkeypatch, language):
    from urllib.parse import parse_qs, urlparse

    for line in (ROOT / ".github/ci.env").read_text().splitlines():
        if line and not line.startswith("#"):
            key, value = line.split("=", 1)
            monkeypatch.setenv(key, value)
    mail = importlib.import_module("app.utils")
    monkeypatch.setattr(mail.settings, "FRONTEND_HOST", "https://example.com")
    token = "opaque-part_%2B%2F%3D.signature"
    messages = (
        (
            "reset-password",
            mail.generate_reset_password_email(
                "recipient@example.com",
                "recipient@example.com",
                token,
                language=language,
            ),
        ),
        (
            "accept-invitation",
            mail.generate_user_invitation_email(
                "recipient@example.com", token, 22, language=language
            ),
        ),
    )
    for path, message in messages:
        parsed = Links()
        parsed.feed(message.html_content)
        expected = f"https://example.com/{path}?token={token}"
        assert parsed.targets == [expected, expected]
        assert expected in message.text_content
        assert parse_qs(urlparse(parsed.targets[0]).query)["token"] == [
            "opaque-part_+/=.signature"
        ]
    locale = EmailLocale(language)
    assert (
        messages[0][1].subject
        == f"Oblidog - {locale.tr('reset_subject', email='recipient@example.com')}"
    )
    assert messages[1][1].subject == f"Oblidog - {locale.tr('invitation_subject')}"
