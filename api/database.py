from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from api.config import settings

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        # In tests, use NullPool: every session gets a fresh asyncpg
        # connection that's never returned to a pool. This avoids the
        # classic "Task got Future attached to a different loop" failure
        # where pytest creates a new event loop per test but the engine
        # singleton hands out connections bound to the loop they were
        # first created in. NullPool sidesteps the binding entirely.
        if settings.app_env == "test":
            _engine = create_async_engine(settings.database_url, poolclass=NullPool)
        else:
            _engine = create_async_engine(
                settings.database_url,
                pool_size=10,
                max_overflow=20,
                pool_pre_ping=True,
                pool_recycle=300,
            )
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(get_engine(), class_=AsyncSession, expire_on_commit=False)
    return _session_factory


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncIterator[AsyncSession]:
    async with get_session_factory()() as session:
        yield session
