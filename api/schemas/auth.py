import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    name: str
    grade_level: int = 12
    role: str = "student"
    invite_token: str | None = None
    section_invite_token: str | None = None
    join_code: str | None = None
    # Capped at the DB column width (User.signup_school_name is
    # VARCHAR(200)). Without this, a >200 char POST bypasses Pydantic
    # and surfaces as a 500 from asyncpg's StringDataRightTruncationError.
    signup_school_name: str | None = Field(None, max_length=200)

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

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in ("student", "teacher"):
            raise ValueError("Role must be 'student' or 'teacher'")
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
    school_id: uuid.UUID | None = None
    school_name: str | None = None
    subscription_tier: str = "free"
    subscription_status: str = "none"
    subscription_provider: str | None = None
    subscription_expires_at: datetime | None = None
    is_pro: bool = False
    # True when the user has a stripe_customer_id on file. Lets the
    # frontend conditionally render the "Manage Subscription" button
    # without leaking the actual customer id to the client.
    has_stripe_customer: bool = False
    # Shadow-student preview marker. Lets the student app's layout
    # guard admit preview accounts even when school_id is null (solo
    # teachers don't have one), so the "Try as Student" flow works
    # for independent teachers too.
    is_preview: bool = False


class DeleteAccountRequest(BaseModel):
    password: str


class EntitlementLimits(BaseModel):
    daily_sessions_used: int
    daily_sessions_limit: int | None
    daily_scans_used: int
    daily_scans_limit: int | None
    daily_chats_used: int
    daily_chats_limit: int | None


class EntitlementsResponse(BaseModel):
    is_pro: bool
    subscription_tier: str
    subscription_status: str
    subscription_expires_at: datetime | None
    limits: EntitlementLimits
    gated_features: list[str]
