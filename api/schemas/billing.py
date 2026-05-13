"""Billing API schemas — teacher Stripe Checkout responses."""

from pydantic import BaseModel


class CheckoutResponse(BaseModel):
    checkout_url: str


class PortalResponse(BaseModel):
    portal_url: str


class UsageResponse(BaseModel):
    """Today's GENERATE_PROBLEM usage for a teacher.

    `bypass=true` when the user isn't subject to the cap (school
    teacher on an active school, Pro tier, or settings.bypass_subscription).
    The frontend hides the meter pill entirely in that case.
    """

    used: int
    limit: int
    bypass: bool
