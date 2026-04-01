import uuid
from datetime import datetime

from pydantic import BaseModel, field_validator


class RedeemPromoRequest(BaseModel):
    code: str

    @field_validator("code")
    @classmethod
    def code_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Code cannot be empty")
        return v


class RedeemPromoResponse(BaseModel):
    status: str
    message: str
    expires_at: datetime | None


class CreatePromoCodeRequest(BaseModel):
    code: str
    duration_days: int
    max_redemptions: int = 1
    expires_at: datetime | None = None

    @field_validator("duration_days")
    @classmethod
    def duration_non_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError("Duration must be 0 (lifetime) or positive")
        return v

    @field_validator("max_redemptions")
    @classmethod
    def max_redemptions_positive(cls, v: int) -> int:
        if v < 1:
            raise ValueError("Max redemptions must be at least 1")
        return v


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
