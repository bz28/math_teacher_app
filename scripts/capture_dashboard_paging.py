"""Screenshot the dashboard's paged list surfaces.

Standalone (not a durable test) — drives an already-running stack:
    dashboard :5173 (override with DASH_BASE), API :8000

    .venv/bin/python -m scripts.capture_dashboard_paging

READ-ONLY. Unlike the other capture_* scripts this one seeds nothing and
truncates nothing: it reuses whatever the local API is already serving and
mints an access token for an admin that already exists. Point it at two dev
servers on different ports to get honest before/after evidence of a change
to how much a list shows.

    DASH_BASE=http://localhost:5200 SHOT_PREFIX=before \\
        .venv/bin/python -m scripts.capture_dashboard_paging

Writes docs/design/<prefix>-<name>.png.

On a port other than :5173 the API rejects the browser's calls — `cors_origins`
lists :5173 alone, so the page loads, the injected token survives, and every
fetch fails with the console showing "API UNREACHABLE" rather than a login
bounce. Serve that dashboard through a vite dev-server `proxy` for `/v1` and
set VITE_API_URL to the dashboard's OWN origin; the request is then same-origin
and vite forwards it to :8000 server-side. Widening cors_origins works too, but
edits config every other local service shares.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

from sqlalchemy import text

from api.core.auth import create_access_token
from api.database import get_session_factory
from tests.harness.browser import HarnessBrowser

DASH_BASE = os.environ.get("DASH_BASE", "http://localhost:5173").rstrip("/")
SHOT_PREFIX = os.environ.get("SHOT_PREFIX", "dashboard-paging")
OUT_DIR = Path(__file__).resolve().parents[1] / "docs" / "design"

# The dashboard keeps its session under its own localStorage keys; the web
# app's keys leave the admin auth guard bouncing to /login.
ADMIN_ACCESS_KEY = "admin_access_token"
ADMIN_REFRESH_KEY = "admin_refresh_token"

# One per paging shape, so the evidence covers both halves of the split:
# server-paged surfaces fetch a page and render their own <Pagination>,
# client-paged ones fetch the set and let DataTable page it.
# `hours` widens the surfaces that default to a 24h window — a local DB
# whose activity is older than a day shows an empty table otherwise, which
# proves nothing about how much a full one displays.
TARGETS = [
    ("users", "/users"),  # server-paged
    ("audit-logs", "/audit-logs?hours=8760"),  # server-paged
    ("llm-calls", "/llm-calls?hours=8760"),  # server-paged
    ("schools", "/schools"),  # client-paged, DataTable-owned
]


async def admin_token() -> str:
    """Mint an access token for an admin already in the local DB.

    No user is created and nothing is written — if the local database has
    no admin the script says so rather than inventing one, because seeding
    a privileged account as a side effect of taking a screenshot is a
    surprise nobody wants from a capture script.
    """
    async with get_session_factory()() as s:
        row = (
            await s.execute(
                text("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1")
            )
        ).first()
    if row is None:
        raise SystemExit("No admin user in the local database — start the stack with seeded data.")
    return create_access_token(str(row[0]), "admin")


async def main() -> None:
    token = await admin_token()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    async with HarnessBrowser(DASH_BASE) as hb:
        for name, path in TARGETS:
            async with hb.authed_page(
                token, token,
                access_key=ADMIN_ACCESS_KEY, refresh_key=ADMIN_REFRESH_KEY,
            ) as page:
                await page.goto(f"{DASH_BASE}{path}", wait_until="networkidle")
                # The tables render off a second fetch that resolves after
                # networkidle on a warm dev server, so settle before shooting
                # or the shot catches the shimmer loader instead of rows.
                await page.wait_for_timeout(1200)
                out = OUT_DIR / f"{SHOT_PREFIX}-{name}.png"
                await page.screenshot(path=str(out), full_page=True)
                print(f"✓ {out.relative_to(OUT_DIR.parents[1])}")


if __name__ == "__main__":
    asyncio.run(main())
