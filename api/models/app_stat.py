"""Key-value store for app-level counters (e.g. deleted accounts)."""

from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from api.database import Base


class AppStat(Base):
    __tablename__ = "app_stats"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
