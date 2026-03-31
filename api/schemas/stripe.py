from pydantic import BaseModel


class CheckoutSessionRequest(BaseModel):
    price_id: str
    success_url: str
    cancel_url: str


class CheckoutSessionResponse(BaseModel):
    checkout_url: str


class PortalSessionRequest(BaseModel):
    return_url: str


class PortalSessionResponse(BaseModel):
    portal_url: str
