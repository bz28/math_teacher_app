import uuid
from datetime import datetime
from typing import Literal

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

    def enforce_invite_only_signup(self) -> None:
        """Veradic is invite-only: every new account arrives through a school.

        Teachers come in on a teacher invite (sent after a demo); students
        come in on a class invite or their teacher's join code. A signup
        with none of the three is refused, whatever role it asks for.

        This replaces the old under-13 self-signup gate: students under 13
        may only sign up through their teacher's class (the school-consent
        exception, 15 U.S.C. section 6502), and with no personal signup path
        left there is nothing for a separate age gate to block.

        Called first in /auth/register; raises ValueError, which the route
        turns into a 400.
        """
        # Strip first: a whitespace-only code must not count as a code.
        if any((t or "").strip() for t in (
            self.invite_token, self.section_invite_token, self.join_code,
        )):
            return
        if self.role == "teacher":
            raise ValueError(
                "Teacher accounts are set up with your school. Book a demo at "
                "veradicai.com/demo, or use the link in your invite email."
            )
        raise ValueError(
            "To create a student account you need a class join code from "
            "your teacher, or the invite link they emailed you."
        )


class CheckEmailRequest(BaseModel):
    email: EmailStr


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class MfaChallengeResponse(BaseModel):
    """Returned from /auth/login when the account has MFA enabled.

    The client should hide the password field and prompt for the
    6-digit code sent to the user's email, then POST to
    /auth/login/verify-mfa with the pending_token + code.
    """
    mfa_required: bool = True
    mfa_pending_token: str


class LoginVerifyMfaRequest(BaseModel):
    mfa_pending_token: str
    code: str

    @field_validator("code")
    @classmethod
    def validate_code(cls, v: str) -> str:
        v = v.strip()
        if not v.isdigit() or len(v) != 6:
            raise ValueError("Code must be 6 digits")
        return v


class MfaDisableRequest(BaseModel):
    # Password re-entry is required to disable MFA. Without it, anyone
    # with a live session (e.g. a momentarily-unlocked workstation)
    # could remove the second factor and weaken the account.
    password: str


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
    mfa_enabled: bool = False
    # True when the user has a stripe_customer_id on file. Lets the
    # frontend conditionally render the "Manage Subscription" button
    # without leaking the actual customer id to the client.
    has_stripe_customer: bool = False
    # Shadow-student preview marker. Lets the student app's layout
    # guard admit preview accounts even when school_id is null (solo
    # teachers don't have one), so the "Preview as student" flow works
    # for independent teachers too.
    is_preview: bool = False
    # First-run onboarding tours the user has already seen, keyed by
    # persona. The frontend auto-mounts a persona's tour only while its
    # key is absent from this list.
    tours_seen: list[str] = []


# Keys for a first-run onboarding tour the frontend marks "seen" once.
# One per persona overview (login-time): "teacher" (courses dashboard +
# a comprehensive walk over every course-workspace tab), "student"
# (school-student dashboard), "personal" (the non-school learner's
# /home). The old per-feature first-use coachmarks (hw-create,
# review-flow, integrity, insights) were retired — they fired once,
# invisibly, and confused teachers; the teacher overview now covers
# those surfaces itself.
TourPersona = Literal[
    "teacher",
    "student",
    "personal",
]


class MarkTourSeenRequest(BaseModel):
    persona: TourPersona


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
