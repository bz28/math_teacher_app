"""The website's contact form: it emails the admins and stores nothing.

Leads moved out of the database (to a table in the founder's Blob Space),
so the alert email is the only record of an inquiry. These pin that the
form still answers the same way, still mails every field (escaped — it
lands in an inbox as HTML), and still validates its input.
"""

from __future__ import annotations

import logging
from typing import Any

import pytest
from httpx import AsyncClient

import api.routes.contact as mod

URL = "/v1/contact/lead"

FORM = {
    "school_name": "Lincoln <b>High</b>",
    "contact_name": "Pat Doe",
    "contact_email": "Pat@Example.com",
    "role": "teacher",
    "approx_students": 120,
    "message": "<script>x</script> we'd like a demo",
}


@pytest.fixture
def sent(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    async def fake_deliver(*, to: list[str], subject: str, html: str) -> bool:
        out.append({"to": to, "subject": subject, "html": html})
        return True

    monkeypatch.setattr(mod, "deliver_email", fake_deliver)
    monkeypatch.setattr(mod.settings, "admin_alert_emails", ["founder@t.com"])
    return out


async def test_form_emails_the_admins_and_answers_as_before(
    client: AsyncClient, sent: list[dict[str, Any]],
) -> None:
    r = await client.post(URL, json=FORM)
    assert r.status_code == 200, r.text
    # The web form reads this shape; it must not change.
    assert r.json() == {"status": "ok", "message": "Thank you! We'll be in touch soon."}
    assert len(sent) == 1
    m = sent[0]
    assert m["to"] == ["founder@t.com"]
    assert m["subject"] == "New school lead: Lincoln <b>High</b>"
    # Every field reaches the inbox, escaped.
    assert "Lincoln &lt;b&gt;High&lt;/b&gt;" in m["html"]
    assert "Pat Doe" in m["html"] and "pat@example.com" in m["html"].lower()
    assert "120" in m["html"]
    assert "&lt;script&gt;x&lt;/script&gt;" in m["html"] and "<script>" not in m["html"]
    # No dashboard to send them to any more.
    assert "/leads" not in m["html"]


def _kept_in_error_log(caplog: pytest.LogCaptureFixture) -> None:
    """The whole inquiry — the parts only the visitor knows — is in an
    ERROR line, the one place it survives an undelivered email."""
    errors = [r.getMessage() for r in caplog.records if r.levelno >= logging.ERROR]
    assert len(errors) == 1
    for value in ("Pat Doe", "pat@example.com", "we'd like a demo", "120"):
        assert value in errors[0].lower() or value in errors[0]


async def test_form_with_no_admins_keeps_the_inquiry_in_the_error_log(
    client: AsyncClient, sent: list[dict[str, Any]], monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(mod.settings, "admin_alert_emails", [])
    r = await client.post(URL, json=FORM)
    assert r.status_code == 200, r.text
    assert sent == []
    _kept_in_error_log(caplog)


async def test_failed_send_keeps_the_inquiry_in_the_error_log(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
) -> None:
    async def failing(*, to: list[str], subject: str, html: str) -> bool:
        return False

    monkeypatch.setattr(mod, "deliver_email", failing)
    monkeypatch.setattr(mod.settings, "admin_alert_emails", ["founder@t.com"])
    r = await client.post(URL, json=FORM)
    assert r.status_code == 200, r.text
    _kept_in_error_log(caplog)


async def test_delivered_inquiry_logs_no_error(
    client: AsyncClient, sent: list[dict[str, Any]], caplog: pytest.LogCaptureFixture,
) -> None:
    r = await client.post(URL, json=FORM)
    assert r.status_code == 200, r.text
    assert len(sent) == 1
    assert not [r for r in caplog.records if r.levelno >= logging.ERROR]


async def test_deliver_email_reports_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """The contact form trusts this bool; a swallowed Resend error must
    come back False, not look like a send."""
    import api.core.email as email

    def boom(_: Any) -> None:
        raise RuntimeError("resend down")

    monkeypatch.setattr(email.settings, "resend_api_key", "re_test")
    monkeypatch.setattr(email.resend.Emails, "send", boom)
    assert await email.deliver_email(to=["a@t.com"], subject="s", html="h") is False
    monkeypatch.setattr(email.resend.Emails, "send", lambda _: {"id": "x"})
    assert await email.deliver_email(to=["a@t.com"], subject="s", html="h") is True


@pytest.mark.parametrize(
    "patch",
    [
        {"contact_email": "not-an-email"},
        {"approx_students": -5},
        {"school_name": "x" * 201},
    ],
)
async def test_form_still_validates(
    client: AsyncClient, sent: list[dict[str, Any]], patch: dict[str, Any],
) -> None:
    r = await client.post(URL, json={**FORM, **patch})
    assert r.status_code == 422
    assert sent == []
