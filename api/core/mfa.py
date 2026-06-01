"""Email-based multi-factor authentication.

Pragmatic MFA for K-12 procurement. Email codes are weaker than TOTP
(an attacker who compromises the email account gets both the password
reset and the second factor), but they're meaningfully better than
nothing and accepted as a valid second factor in district policy. No
authenticator app required, no QR setup, no recovery codes — the email
account doubles as the recovery channel.

Flow:
1. /auth/login (with password): verify password, generate a 6-digit
   code, store SHA-256 hex of the code + 10-minute expiry on the user,
   email the code, return a short-lived "mfa_pending" JWT.
2. /auth/login/verify-mfa: client submits pending JWT + code. If the
   hash matches and the code hasn't expired and attempts haven't been
   exhausted, clear the challenge and issue normal access + refresh
   tokens.

If a code arrives after MAX_MFA_ATTEMPTS bad guesses, the challenge is
invalidated server-side — the client has to restart at /auth/login.
This bounds the online brute-force surface against a 6-digit secret to
roughly 5/1,000,000 success probability per challenge.
"""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

import jwt

from api.config import settings
from api.core.email import send_email

CODE_LENGTH = 6
CODE_TTL_MINUTES = 10
PENDING_TOKEN_TTL_MINUTES = 5
MAX_MFA_ATTEMPTS = 5
PENDING_TOKEN_TYPE = "mfa_pending"


def generate_code() -> str:
    """Return a CSPRNG-derived 6-digit numeric code as a string.

    secrets.randbelow gives a uniform draw over [0, 10**N) which is
    important here — `random.randint` would be biased. Zero-padded so
    "000123" doesn't get mistaken for a 3-digit code.
    """
    n = secrets.randbelow(10**CODE_LENGTH)
    return f"{n:0{CODE_LENGTH}d}"


def hash_code(code: str) -> str:
    """SHA-256 hex of the code. Constant-time comparison is enforced
    by caller via `secrets.compare_digest` against another hex string.
    """
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def verify_code(submitted: str, expected_hash: str) -> bool:
    """Constant-time comparison of submitted code against stored hash."""
    return secrets.compare_digest(hash_code(submitted), expected_hash)


def code_expiry() -> datetime:
    return datetime.now(UTC) + timedelta(minutes=CODE_TTL_MINUTES)


def is_code_expired(expires_at: datetime | None) -> bool:
    if expires_at is None:
        return True
    return datetime.now(UTC) >= expires_at


def create_pending_token(user_id: str) -> str:
    """Issue a short-lived JWT that proves the holder just passed the
    password step for `user_id`. Required as the second factor on
    /auth/login/verify-mfa so an attacker can't try random codes
    against a known email without first knowing the password.
    """
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "type": PENDING_TOKEN_TYPE,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=PENDING_TOKEN_TTL_MINUTES)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def decode_pending_token(token: str) -> str:
    """Return the user_id encoded in a valid pending token.

    Raises jwt.PyJWTError-derived exceptions on signature failure,
    expiry, or type mismatch. Caller turns these into 401s.
    """
    payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    if payload.get("type") != PENDING_TOKEN_TYPE:
        raise jwt.InvalidTokenError("Wrong token type")
    user_id = payload.get("sub")
    if not user_id:
        raise jwt.InvalidTokenError("Missing subject")
    return str(user_id)


async def send_mfa_code_email(*, to: str, name: str, code: str) -> None:
    """Deliver an MFA code via Resend.

    Keep the email itself plain and direct — no marketing chrome, no
    tracking pixels, no clickable links. The code expires in 10 minutes;
    if the user didn't request this, the message reassures rather than
    alarms (a stolen-password attacker would only get a code, not
    access).
    """
    subject = "Your Veradic sign-in code"
    # Source-formatted on multiple lines for the 120-char lint limit;
    # whitespace inside <p> collapses on render so the body renders as
    # a single paragraph in the recipient's mail client.
    html = f"""\
<div style="font-family: -apple-system, system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <p>Hi {name or "there"},</p>
  <p>Your Veradic sign-in code is:</p>
  <p style="font-size: 28px; letter-spacing: 6px; font-weight: bold; padding: 16px 0;">{code}</p>
  <p>This code will expire in {CODE_TTL_MINUTES} minutes.
  If you didn't request this code, you can safely ignore this message
  — someone may have entered your email by mistake.</p>
  <p style="color: #666; font-size: 13px; margin-top: 32px;">— Veradic AI</p>
</div>"""
    await send_email(to=[to], subject=subject, html=html)
