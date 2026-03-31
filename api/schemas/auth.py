import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, field_validator


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    name: str
    grade_level: int

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v

    @field_validator("grade_level")
    @classmethod
    def validate_grade_level(cls, v: int) -> int:
        if not 1 <= v <= 16:
            raise ValueError("Grade level must be between 1 and 16")
        return v


class CheckEmailRequest(BaseModel):
    email: EmailStr


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    grade_level: int
    role: str
    subscription_tier: str = "free"
    subscription_status: str = "none"
    subscription_expires_at: datetime | None = None
    is_pro: bool = False


class EntitlementLimits(BaseModel):
    daily_sessions_used: int
    daily_sessions_limit: int | None


class EntitlementsResponse(BaseModel):
    is_pro: bool
    subscription_tier: str
    subscription_status: str
    subscription_expires_at: datetime | None
    limits: EntitlementLimits
    gated_features: list[str]
