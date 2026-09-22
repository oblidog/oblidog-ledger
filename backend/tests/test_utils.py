from emails.message import Message

from app import utils
from app.core.config import settings


def test_send_email_does_not_silence_smtp_failures(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    sent_with: dict[str, object] = {}

    def fake_send(_self, *, to, smtp):  # type: ignore[no-untyped-def]
        del to
        sent_with.update(smtp)
        raise OSError("SMTP host unavailable")

    monkeypatch.setattr(Message, "send", fake_send)
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(settings, "EMAILS_FROM_EMAIL", "sender@example.com")

    try:
        utils.send_email(
            email_to="recipient@example.com",
            subject="Test",
            html_content="<p>Test</p>",
        )
    except OSError as exc:
        assert str(exc) == "SMTP host unavailable"
    else:
        raise AssertionError("SMTP errors must reach the caller")

    assert sent_with["fail_silently"] is False
