"""Mint access+refresh tokens for the teacher (Ms. Rivera) and the student
(Maya Chen) so the Playwright recorder can boot the SPA pre-authenticated.
Prints JSON to stdout.  Run from the shared checkout (needs .env)."""
from __future__ import annotations
import asyncio, json, uuid
from sqlalchemy import text
from api.database import get_session_factory
from api.core.auth import create_access_token, create_refresh_token

PEOPLE = {
    "teacher": ("td_teacher_d592cc@t.com", "teacher"),
    "maya":    ("maya_d52a@school.edu",    "student"),
}

async def main() -> None:
    out: dict[str, dict] = {}
    async with get_session_factory()() as s:
        for key, (email, role) in PEOPLE.items():
            uid = (await s.execute(text("select id from users where email=:e"), {"e": email})).scalar_one()
            access = create_access_token(str(uid), role)
            refresh = await create_refresh_token(s, uuid.UUID(str(uid)))
            out[key] = {"id": str(uid), "access": access, "refresh": refresh}
    print(json.dumps(out))

if __name__ == "__main__":
    asyncio.run(main())
