from fastapi import APIRouter
from sqlalchemy import text

from api.database import get_session_factory

router = APIRouter()


@router.get("/health")
async def health_check() -> dict[str, str]:
    async with get_session_factory()() as session:
        await session.execute(text("SELECT 1"))
    return {"status": "healthy"}
