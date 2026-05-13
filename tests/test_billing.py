"""Stripe Checkout + Customer Portal endpoint tests.

Mocks the Stripe SDK end-to-end — no real API calls.
"""

import uuid
from unittest.mock import patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from api.core.auth import create_access_token, hash_password
from api.database import get_session_factory
from api.models.user import User

from .conftest import auth_headers

CHECKOUT_URL = "/v1/billing/teacher-checkout"
PORTAL_URL = "/v1/billing/teacher-portal"

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
