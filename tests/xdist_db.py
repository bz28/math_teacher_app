"""One Postgres database per pytest-xdist worker (`pytest -n auto`).

conftest's setup_db drops and recreates the schema, and tests truncate
tables, so workers sharing one database would wipe each other's rows
mid-test. Each worker runs in `<DATABASE_URL's database>_<worker id>`
(mathapp_test_gw0, mathapp_test_gw1, ...), created on first use; setup_db
then builds its schema exactly as it does for a serial run.

Kept free of api imports: conftest calls this before anything reads
Settings, which captures DATABASE_URL at import.
"""

import asyncio
import os

import asyncpg
from sqlalchemy.engine import make_url


def worker_database_url(url: str) -> str:
    """`url` itself outside xdist; otherwise this worker's own database's
    URL, after creating that database if an earlier run hasn't."""
    worker = os.environ.get("PYTEST_XDIST_WORKER")
    if not worker:
        return url
    base = make_url(url)
    name = f"{base.database}_{worker}"

    async def create() -> None:
        # Connect to the base database: the worker's may not exist yet.
        conn = await asyncpg.connect(base.set(drivername="postgresql").render_as_string(hide_password=False))
        try:
            await conn.execute(f'CREATE DATABASE "{name}"')
        except asyncpg.DuplicateDatabaseError:
            pass  # left by an earlier run; setup_db rebuilds its schema
        finally:
            await conn.close()

    asyncio.run(create())
    return base.set(database=name).render_as_string(hide_password=False)
