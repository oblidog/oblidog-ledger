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


def test_scheduled_smtp_disconnect_is_not_retried(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    import smtplib

    import pytest

    class Client:
        calls = 0

        def sendmail(self, **kwargs):  # type: ignore[no-untyped-def]
            self.calls += 1
            raise smtplib.SMTPServerDisconnected("DATA outcome unknown")

    client = Client()
    backend = utils._SingleAttemptSMTPBackend(host="localhost", fail_silently=False)
    monkeypatch.setattr(backend, "get_client", lambda: client)
    message = Message(
        html="<p>Report</p>",
        mail_from="sender@example.com",
        message_id="<stable@oblidog.local>",
    )
    with pytest.raises(smtplib.SMTPServerDisconnected):
        message.send(to="recipient@example.com", smtp=backend)
    assert client.calls == 1


def test_send_email_checks_acceptance_and_message_id(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from types import SimpleNamespace

    import pytest

    captured = []

    def fake_send(self, **_kwargs):  # type: ignore[no-untyped-def]
        captured.append(self.message_id)
        return SimpleNamespace(success=False)

    monkeypatch.setattr(Message, "send", fake_send)
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(settings, "EMAILS_FROM_EMAIL", "sender@example.com")
    with pytest.raises(RuntimeError, match="acceptance not confirmed"):
        utils.send_email(
            email_to="recipient@example.com",
            html_content="<p>Report</p>",
            message_id="<stable@oblidog.local>",
        )
    assert captured == ["<stable@oblidog.local>"]
