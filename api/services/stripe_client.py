"""Stripe SDK initialization.

Lazy-init so importing this module doesn't blow up when STRIPE_SECRET_KEY
is unset (local dev without billing). Callers should check `is_configured()`
before invoking the SDK; the route layer returns a 503 with a clear
message rather than letting a missing-key crash bubble up as a 500.
"""

import stripe

from api.config import settings


def _init() -> None:
    """Initialize the SDK with the configured secret. Safe to call repeatedly."""
    if settings.stripe_secret_key and stripe.api_key != settings.stripe_secret_key:
        stripe.api_key = settings.stripe_secret_key


def is_configured() -> bool:
    """True when both the secret key and the teacher price are set.

    Both are required for the teacher-checkout endpoint to function.
    Local dev / CI typically run with these empty and routes return
    503 if hit without configuration.
    """
    return bool(settings.stripe_secret_key and settings.teacher_pro_stripe_price_id)


# Initialize on import so the first route handler doesn't pay the cost.
# When the key is empty (dev/CI), this is a no-op.
_init()
