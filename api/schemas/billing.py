"""Billing API schemas — teacher Stripe Checkout responses."""

from pydantic import BaseModel


class CheckoutResponse(BaseModel):
    checkout_url: str


class PortalResponse(BaseModel):
    portal_url: str
