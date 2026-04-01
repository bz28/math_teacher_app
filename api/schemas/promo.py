import uuid
from datetime import datetime

from pydantic import BaseModel


class RedeemPromoRequest(BaseModel):
    code: str


class RedeemPromoResponse(BaseModel):
    status: str
    message: str
    expires_at: datetime | None


class CreatePromoCodeRequest(BaseModel):
    code: str
    duration_days: int
    max_redemptions: int = 1
    expires_at: datetime | None = None


class UpdatePromoCodeRequest(BaseModel):
    is_active: bool | None = None
    max_redemptions: int | None = None
    expires_at: datetime | None = None


class PromoCodeResponse(BaseModel):
    id: uuid.UUID
    code: str
    duration_days: int
    max_redemptions: int
    times_redeemed: int
    expires_at: datetime | None
    is_active: bool
    created_at: datetime


class PromoRedemptionResponse(BaseModel):
    user_id: uuid.UUID
    user_email: str
    redeemed_at: datetime
    expires_at: datetime | None
