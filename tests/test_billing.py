"""Stripe Checkout + Customer Portal endpoint tests.

Mocks the Stripe SDK end-to-end — no real API calls.
"""

import uuid
from unittest.mock import patch

import pytest
import stripe
from httpx import AsyncClient
from sqlalchemy import select

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.user import User

from .conftest import auth_headers

CHECKOUT_URL = "/v1/billing/teacher-checkout"
PORTAL_URL = "/v1/billing/teacher-portal"
USAGE_URL = "/v1/billing/teacher-usage"

# Stripe settings have to be non-empty for `is_configured()` to pass.
# The patch decorator stubs both fields; the real env stays unset.
STRIPE_PATCH = {
    "stripe_secret_key": "sk_test_dummy",
    "teacher_pro_stripe_price_id": "price_dummy",
}


async def _make_user(*, role: str, stripe_customer_id: str | None = None) -> tuple[User, str]:
    """Insert a user and return (user, access_token)."""
    async with get_session_factory()() as s:
        user = User(
            email=f"{role}_{uuid.uuid4().hex[:6]}@t.com",
            name=f"Test {role}",
            password_hash=hash_password("StrongPass1"),
            grade_level=12,
            role=role,
            stripe_customer_id=stripe_customer_id,
        )
        s.add(user)
        await s.commit()
        await s.refresh(user)
    token = create_access_token(str(user.id), role)
    return user, token


def _patch_settings():
    """Patch the billing-module settings without touching the global env."""
    return patch.multiple(
        "api.routes.billing.settings",
        stripe_secret_key=STRIPE_PATCH["stripe_secret_key"],
        teacher_pro_stripe_price_id=STRIPE_PATCH["teacher_pro_stripe_price_id"],
        stripe_checkout_success_url="https://example.com/success",
        stripe_checkout_cancel_url="https://example.com/cancel",
        stripe_portal_return_url="https://example.com/portal-return",
    ), patch.multiple(
        "api.services.stripe_client.settings",
        stripe_secret_key=STRIPE_PATCH["stripe_secret_key"],
        teacher_pro_stripe_price_id=STRIPE_PATCH["teacher_pro_stripe_price_id"],
    )


class _FakeSession:
    def __init__(self, url: str, sid: str = "cs_test_fake") -> None:
        self.url = url
        self.id = sid


class _FakeCustomer:
    def __init__(self, cid: str = "cus_test_fake") -> None:
        self.id = cid


@pytest.mark.asyncio
async def test_checkout_rejects_unconfigured(client: AsyncClient) -> None:
    """503 when Stripe isn't configured (default for CI/dev)."""
    _, token = await _make_user(role="teacher")
    resp = await client.post(CHECKOUT_URL, headers=auth_headers(token))
    assert resp.status_code == 503


@pytest.mark.asyncio
async def test_checkout_rejects_student(client: AsyncClient) -> None:
    """Students aren't allowed on the teacher checkout endpoint."""
    _, token = await _make_user(role="student")
    s1, s2 = _patch_settings()
    with s1, s2:
        resp = await client.post(CHECKOUT_URL, headers=auth_headers(token))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_checkout_returns_url_for_teacher(client: AsyncClient) -> None:
    """A teacher gets a Stripe Checkout URL back. Customer ID is persisted."""
    user, token = await _make_user(role="teacher")

    fake_customer = _FakeCustomer(cid="cus_TEST_NEW")
    fake_session = _FakeSession(url="https://checkout.stripe.com/session/test")

    s1, s2 = _patch_settings()
    with (
        s1,
        s2,
        patch("stripe.Customer.create", return_value=fake_customer) as create_cust,
        patch("stripe.checkout.Session.create", return_value=fake_session) as create_sess,
    ):
        resp = await client.post(CHECKOUT_URL, headers=auth_headers(token))

    assert resp.status_code == 200, resp.text
    assert resp.json() == {"checkout_url": "https://checkout.stripe.com/session/test"}
    create_cust.assert_called_once()
    create_sess.assert_called_once()

    # Customer ID persisted on the user row.
    async with get_session_factory()() as s:
        refreshed = (await s.execute(select(User).where(User.id == user.id))).scalar_one()
        assert refreshed.stripe_customer_id == "cus_TEST_NEW"


@pytest.mark.asyncio
async def test_checkout_reuses_existing_customer(client: AsyncClient) -> None:
    """If the user already has a stripe_customer_id, don't create a new one."""
    _, token = await _make_user(role="teacher", stripe_customer_id="cus_existing")
    fake_session = _FakeSession(url="https://checkout.stripe.com/session/reuse")

    s1, s2 = _patch_settings()
    with (
        s1,
        s2,
        patch("stripe.Customer.create") as create_cust,
        patch("stripe.checkout.Session.create", return_value=fake_session) as create_sess,
    ):
        resp = await client.post(CHECKOUT_URL, headers=auth_headers(token))

    assert resp.status_code == 200
    create_cust.assert_not_called()
    create_sess.assert_called_once()
    # Confirm it used the existing customer id.
    kwargs = create_sess.call_args.kwargs
    assert kwargs["customer"] == "cus_existing"


@pytest.mark.asyncio
async def test_portal_404_without_customer(client: AsyncClient) -> None:
    """A teacher with no stripe_customer_id can't open the portal."""
    _, token = await _make_user(role="teacher")
    s1, s2 = _patch_settings()
    with s1, s2:
        resp = await client.get(PORTAL_URL, headers=auth_headers(token))
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_portal_returns_url(client: AsyncClient) -> None:
    """A user with a customer id gets a portal URL back."""
    _, token = await _make_user(role="teacher", stripe_customer_id="cus_portal")
    fake_portal = _FakeSession(url="https://billing.stripe.com/p/test")

    s1, s2 = _patch_settings()
    with (
        s1,
        s2,
        patch("stripe.billing_portal.Session.create", return_value=fake_portal) as create_p,
    ):
        resp = await client.get(PORTAL_URL, headers=auth_headers(token))

    assert resp.status_code == 200
    assert resp.json() == {"portal_url": "https://billing.stripe.com/p/test"}
    create_p.assert_called_once()


# ── Stripe webhook ──────────────────────────────────────────────────────


STRIPE_WEBHOOK_URL = "/v1/webhooks/stripe"


@pytest.mark.asyncio
async def test_stripe_webhook_checkout_completed_flips_to_pro(client: AsyncClient) -> None:
    """A checkout.session.completed event for a known customer flips them to pro."""
    user, _ = await _make_user(role="teacher", stripe_customer_id="cus_wh_1")

    payload = {
        "type": "checkout.session.completed",
        "data": {"object": {"customer": "cus_wh_1"}},
    }
    # No signature header — dev-mode path (webhook_secret unset).
    with patch.multiple(
        "api.routes.webhook.settings",
        stripe_webhook_secret="",
        app_env="development",
    ):
        resp = await client.post(STRIPE_WEBHOOK_URL, json=payload)

    assert resp.status_code == 200
    async with get_session_factory()() as s:
        refreshed = (await s.execute(select(User).where(User.id == user.id))).scalar_one()
        assert refreshed.subscription_tier == "pro"
        assert refreshed.subscription_status == "active"
        assert refreshed.subscription_provider == "stripe"


@pytest.mark.asyncio
async def test_stripe_webhook_subscription_deleted_flips_to_free(client: AsyncClient) -> None:
    """A customer.subscription.deleted event reverts the user to free.

    Also asserts that subscription_expires_at is cleared — so a stale
    period-end can't be misused if a future re-flip happens.
    """
    from datetime import UTC, datetime, timedelta

    user, _ = await _make_user(role="teacher", stripe_customer_id="cus_wh_2")
    async with get_session_factory()() as s:
        u = (await s.execute(select(User).where(User.id == user.id))).scalar_one()
        u.subscription_tier = "pro"
        u.subscription_status = "active"
        u.subscription_expires_at = datetime.now(UTC) + timedelta(days=30)
        await s.commit()

    payload = {
        "type": "customer.subscription.deleted",
        "data": {"object": {"customer": "cus_wh_2"}},
    }
    with patch.multiple(
        "api.routes.webhook.settings",
        stripe_webhook_secret="",
        app_env="development",
    ):
        resp = await client.post(STRIPE_WEBHOOK_URL, json=payload)

    assert resp.status_code == 200
    async with get_session_factory()() as s:
        refreshed = (await s.execute(select(User).where(User.id == user.id))).scalar_one()
        assert refreshed.subscription_tier == "free"
        assert refreshed.subscription_status == "cancelled"
        assert refreshed.subscription_expires_at is None


@pytest.mark.asyncio
async def test_stripe_webhook_unknown_customer_is_no_op(client: AsyncClient) -> None:
    """An event for a customer we don't recognize is a clean no-op.

    Asserts both the 200 response AND that no user state mutated —
    a previously-tautological test was strengthened to verify
    no side-effects on any user row.
    """
    # Seed a known user with a different customer id so we can confirm
    # they weren't touched.
    user, _ = await _make_user(role="teacher", stripe_customer_id="cus_known")
    async with get_session_factory()() as s:
        u = (await s.execute(select(User).where(User.id == user.id))).scalar_one()
        u.subscription_tier = "free"
        u.subscription_status = "none"
        await s.commit()

    payload = {
        "type": "checkout.session.completed",
        "data": {"object": {"customer": "cus_unknown_xxx"}},
    }
    with patch.multiple(
        "api.routes.webhook.settings",
        stripe_webhook_secret="",
        app_env="development",
    ):
        resp = await client.post(STRIPE_WEBHOOK_URL, json=payload)
    assert resp.status_code == 200

    # Untouched.
    async with get_session_factory()() as s:
        refreshed = (await s.execute(select(User).where(User.id == user.id))).scalar_one()
        assert refreshed.subscription_tier == "free"
        assert refreshed.subscription_status == "none"


@pytest.mark.asyncio
async def test_stripe_webhook_subscription_updated_active(client: AsyncClient) -> None:
    """customer.subscription.updated with status=active sets tier=pro + refreshes period_end."""
    from datetime import UTC, datetime

    user, _ = await _make_user(role="teacher", stripe_customer_id="cus_upd_active")
    new_period_end = int(datetime(2027, 1, 1, tzinfo=UTC).timestamp())

    payload = {
        "type": "customer.subscription.updated",
        "data": {
            "object": {
                "customer": "cus_upd_active",
                "status": "active",
                "current_period_end": new_period_end,
            }
        },
    }
    with patch.multiple(
        "api.routes.webhook.settings",
        stripe_webhook_secret="",
        app_env="development",
    ):
        resp = await client.post(STRIPE_WEBHOOK_URL, json=payload)
    assert resp.status_code == 200

    async with get_session_factory()() as s:
        refreshed = (await s.execute(select(User).where(User.id == user.id))).scalar_one()
        assert refreshed.subscription_tier == "pro"
        assert refreshed.subscription_status == "active"
        assert refreshed.subscription_provider == "stripe"
        assert refreshed.subscription_expires_at is not None
        assert int(refreshed.subscription_expires_at.timestamp()) == new_period_end


@pytest.mark.asyncio
async def test_stripe_webhook_subscription_updated_past_due(client: AsyncClient) -> None:
    """status=past_due sets subscription_status=billing_issue, keeps tier."""
    user, _ = await _make_user(role="teacher", stripe_customer_id="cus_upd_past")
    async with get_session_factory()() as s:
        u = (await s.execute(select(User).where(User.id == user.id))).scalar_one()
        u.subscription_tier = "pro"
        u.subscription_status = "active"
        await s.commit()

    payload = {
        "type": "customer.subscription.updated",
        "data": {"object": {"customer": "cus_upd_past", "status": "past_due"}},
    }
    with patch.multiple(
        "api.routes.webhook.settings",
        stripe_webhook_secret="",
        app_env="development",
    ):
        resp = await client.post(STRIPE_WEBHOOK_URL, json=payload)
    assert resp.status_code == 200

    async with get_session_factory()() as s:
        refreshed = (await s.execute(select(User).where(User.id == user.id))).scalar_one()
        assert refreshed.subscription_status == "billing_issue"


@pytest.mark.asyncio
async def test_stripe_webhook_signature_valid(client: AsyncClient) -> None:
    """With a webhook secret configured, a valid signature lets the event through."""
    user, _ = await _make_user(role="teacher", stripe_customer_id="cus_sig_ok")

    # construct_event returns the parsed event dict on success.
    fake_event = {
        "type": "checkout.session.completed",
        "data": {"object": {"customer": "cus_sig_ok"}},
    }
    with (
        patch.multiple(
            "api.routes.webhook.settings",
            stripe_webhook_secret="whsec_test",
            app_env="production",
        ),
        patch("stripe.Webhook.construct_event", return_value=fake_event),
    ):
        resp = await client.post(
            STRIPE_WEBHOOK_URL,
            content=b"{}",
            headers={
                "Content-Type": "application/json",
                "stripe-signature": "t=1,v1=anything",
            },
        )
    assert resp.status_code == 200
    async with get_session_factory()() as s:
        refreshed = (await s.execute(select(User).where(User.id == user.id))).scalar_one()
        assert refreshed.subscription_tier == "pro"


@pytest.mark.asyncio
async def test_stripe_webhook_signature_invalid(client: AsyncClient) -> None:
    """A bad signature must 403, not accept the payload."""
    def _raise(*_args, **_kwargs):
        raise stripe.SignatureVerificationError("bad sig", "sig_header")

    with (
        patch.multiple(
            "api.routes.webhook.settings",
            stripe_webhook_secret="whsec_test",
            app_env="production",
        ),
        patch("stripe.Webhook.construct_event", side_effect=_raise),
    ):
        resp = await client.post(
            STRIPE_WEBHOOK_URL,
            content=b"{}",
            headers={
                "Content-Type": "application/json",
                "stripe-signature": "t=1,v1=forged",
            },
        )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_stripe_webhook_rejects_unconfigured_prod(client: AsyncClient) -> None:
    """In production, an unset webhook secret must hard-fail (503), not silent-skip."""
    payload = {"type": "checkout.session.completed", "data": {"object": {}}}
    with patch.multiple(
        "api.routes.webhook.settings",
        stripe_webhook_secret="",
        app_env="production",
    ):
        resp = await client.post(STRIPE_WEBHOOK_URL, json=payload)
    assert resp.status_code == 503


# ── /billing/teacher-usage ──────────────────────────────────────────────


async def _log_generate_problem(user_id: uuid.UUID, n: int) -> None:
    """Insert N generate_problem LLMCall rows for `user_id` today."""
    from datetime import UTC, datetime

    from api.models.llm_call import LLMCall
    async with get_session_factory()() as s:
        for _ in range(n):
            s.add(LLMCall(
                user_id=user_id,
                function="generate_problem",
                model="claude-test",
                input_tokens=0,
                output_tokens=0,
                latency_ms=0.0,
                cost_usd=0.0,
                success=True,
                created_at=datetime.now(UTC),
            ))
        await s.commit()


@pytest.mark.asyncio
async def test_teacher_usage_rejects_student(client: AsyncClient) -> None:
    """Students can't hit the teacher-usage endpoint (no meter pill on student side)."""
    _, token = await _make_user(role="student")
    resp = await client.get(USAGE_URL, headers=auth_headers(token))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_teacher_usage_independent_teacher(client: AsyncClient) -> None:
    """Independent free teacher: returns the live count + cap, bypass=False."""
    user, token = await _make_user(role="teacher")
    await _log_generate_problem(user.id, 3)

    resp = await client.get(USAGE_URL, headers=auth_headers(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["used"] == 3
    assert body["limit"] == 10
    assert body["bypass"] is False


@pytest.mark.asyncio
async def test_teacher_usage_pro_teacher_bypasses(client: AsyncClient) -> None:
    """Pro teacher: bypass=True so the frontend hides the pill entirely."""
    async with get_session_factory()() as s:
        teacher = User(
            email=f"pro_usage_{uuid.uuid4().hex[:6]}@t.com",
            name="Pro",
            password_hash=hash_password("StrongPass1"),
            grade_level=12,
            role="teacher",
            subscription_tier="pro",
            subscription_status="active",
        )
        s.add(teacher)
        await s.commit()
        await s.refresh(teacher)
        teacher_id = teacher.id

    token = create_access_token(str(teacher_id), "teacher")
    resp = await client.get(USAGE_URL, headers=auth_headers(token))
    assert resp.status_code == 200
    assert resp.json()["bypass"] is True


@pytest.mark.asyncio
async def test_teacher_usage_school_teacher_bypasses(client: AsyncClient) -> None:
    """School teacher (school_id set on active school): bypass=True."""
    from api.models.school import School

    async with get_session_factory()() as s:
        school = School(
            name="Bypass High",
            contact_name="C",
            contact_email="c@s.com",
            is_active=True,
        )
        s.add(school)
        await s.commit()
        await s.refresh(school)
        teacher = User(
            email=f"school_usage_{uuid.uuid4().hex[:6]}@t.com",
            name="School T",
            password_hash=hash_password("StrongPass1"),
            grade_level=12,
            role="teacher",
            school_id=school.id,
        )
        s.add(teacher)
        await s.commit()
        await s.refresh(teacher)
        teacher_id = teacher.id

    token = create_access_token(str(teacher_id), "teacher")
    resp = await client.get(USAGE_URL, headers=auth_headers(token))
    assert resp.status_code == 200
    assert resp.json()["bypass"] is True
