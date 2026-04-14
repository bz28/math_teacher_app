import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, field_validator


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    name: str
    grade_level: int = 12
    role: str = "student"
    invite_token: str | None = None
    section_invite_token: str | None = None
    join_code: str | None = None

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
    subscription_expires_at: datetime | None = None
    is_pro: bool = False
    # True for the shadow account a teacher creates via "View as Student".
    # UI uses this to hide personal-subscription affordances that don't
    # apply to a preview session.
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
