"""The website's contact form: it emails the admins and stores nothing.

Leads moved out of the database (to a table in the founder's Blob Space),
so the alert email is the only record of an inquiry. These pin that the
form still answers the same way, still mails every field (escaped — it
lands in an inbox as HTML), and still validates its input.
"""

from __future__ import annotations

import asyncio
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

    async def fake_send(*, to: list[str], subject: str, html: str) -> None:
        out.append({"to": to, "subject": subject, "html": html})

    monkeypatch.setattr(mod, "send_email", fake_send)
    monkeypatch.setattr(mod.settings, "admin_alert_emails", ["founder@t.com"])
    return out


async def test_form_emails_the_admins_and_answers_as_before(
    client: AsyncClient, sent: list[dict[str, Any]],
) -> None:
    r = await client.post(URL, json=FORM)
    assert r.status_code == 200, r.text
    # The web form reads this shape; it must not change.
    assert r.json() == {"status": "ok", "message": "Thank you! We'll be in touch soon."}
    await asyncio.sleep(0)  # let the fire-and-forget send run
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


async def test_form_with_no_admins_still_answers_and_sends_nothing(
    client: AsyncClient, sent: list[dict[str, Any]], monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(mod.settings, "admin_alert_emails", [])
    r = await client.post(URL, json=FORM)
    assert r.status_code == 200, r.text
    await asyncio.sleep(0)
    assert sent == []


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
    await asyncio.sleep(0)
    assert sent == []
