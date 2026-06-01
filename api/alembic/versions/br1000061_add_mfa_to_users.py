"""add MFA columns to users

Revision ID: br1000061
Revises: bq1000060
Create Date: 2026-05-23 00:00:00.000000

Adds email-based MFA support. Login flow:
1. POST /auth/login: verify password; if mfa_enabled, generate a 6-digit
   code, store its SHA-256 hash + expiry on the user, email the code,
   and return a short-lived "pending" JWT instead of an access token.
2. POST /auth/login/verify-mfa: client submits pending JWT + code; we
   compare the hash, clear the code, and issue normal tokens.

Columns:
- `mfa_enabled` (bool, default false, server_default 'false') — opt-in
  flag set via /auth/mfa/enable. Districts can require MFA via their
  own policy; we don't force it at the platform level yet.
- `mfa_code_hash` (varchar(64), nullable) — SHA-256 hex of the
  in-flight 6-digit challenge code. Cleared on successful verify or
  when attempts exceed the limit.
- `mfa_code_expires_at` (timestamptz, nullable) — challenge expiry,
  typically now+10min.
- `mfa_code_attempts` (int, default 0) — count of incorrect code
  submissions for the current challenge. Code is invalidated when
  this reaches the MAX_MFA_ATTEMPTS threshold (defined in api.core.mfa)
  to bound online brute force against a 6-digit secret.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "br1000061"
down_revision: str | None = "bq1000060"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "mfa_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "users",
        sa.Column("mfa_code_hash", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column(
            "mfa_code_expires_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "mfa_code_attempts",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "mfa_code_attempts")
    op.drop_column("users", "mfa_code_expires_at")
    op.drop_column("users", "mfa_code_hash")
    op.drop_column("users", "mfa_enabled")
