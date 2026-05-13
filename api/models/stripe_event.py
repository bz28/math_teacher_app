"""Idempotency log for Stripe webhook deliveries.

A row is inserted before any state mutation on each webhook event.
The `event_id` PK is the Stripe event ID; a duplicate-insert means
this event has already been processed and the handler can return
200 without re-running its side effects. Stripe retries any non-2xx
and may also redeliver already-acknowledged events during outages,
so dedup at the application layer is mandatory.
"""

from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base


class StripeProcessedEvent(Base):
    __tablename__ = "stripe_processed_events"

    event_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    processed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )
