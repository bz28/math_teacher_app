"""Reusable screenshot pipeline for the Veradic web app.

Seeds a rich world (school + student + a published practice set with real
bank items), then drives a headless Chromium that's logged in via
localStorage token injection and screenshots a parameterized list of
authenticated routes into `docs/design/`. Re-run after a build to refresh
PR-evidence shots.

Usage:

    .venv/bin/python -m scripts.capture_screens

The script targets whatever DB / JWT secret the local API serves (read
from `.env` via api.config), so the tokens it mints authenticate against
the running API — start the stack first (web :3000, API :8000).

Override the web origin with WEB_BASE=http://localhost:3000 if needed.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from pathlib import Path

from playwright.async_api import Page

from tests.harness.browser import HarnessBrowser
from tests.harness.seed import RichSeed, seed_world_rich

WEB_BASE = os.environ.get("WEB_BASE", "http://localhost:3000").rstrip("/")
OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "design"

# Settle time (ms) after networkidle so framer-motion / late layout
# shifts finish before we shoot.
_ANIM_SETTLE_MS = 900


@dataclass
class Target:
    """One screenshot job: a friendly file name, the app-relative path,
    and the access/refresh tokens to inject for it."""

    name: str
    path: str
    access: str
    refresh: str


def default_targets(seed: RichSeed) -> list[Target]:
    """The school-student surfaces that exercise the seeded practice set.

    Note on "learn": for school-linked students the standalone /learn
    route redirects back to the dashboard (app-layout guard), so the
    Learn experience lives INLINE on the practice detail page (the
    "Learn it" button expands the teacher-authored solution steps). The
    practice-detail shot therefore covers both practice and learn.
    """
    st, rt = seed.student_token, seed.student_refresh
    course, practice = seed.course_id, seed.practice_assignment_id
    return [
        Target("school-student-dashboard", "/school/student", st, rt),
        Target(
            "school-student-practice-list",
            f"/school/student/courses/{course}?tab=practice", st, rt,
        ),
        Target(
            "school-student-practice-detail",
            f"/school/student/courses/{course}/practice/{practice}", st, rt,
        ),
    ]


async def _diagnose(page: Page) -> str:
    """Cheap blank/error heuristic so we report honestly instead of
    shipping a broken screenshot. Returns 'ok' or a short reason."""
    try:
        text = (await page.inner_text("body")).strip()
    except Exception as e:  # noqa: BLE001
        return f"no-body ({e})"
    low = text.lower()
    if len(text) < 15:
        return f"near-blank ({len(text)} chars)"
    if "this page could not be found" in low or "404" == low.strip():
        return "Next 404 (route not served — is the Veradic web app running here?)"
    if "couldn't load" in low or "something went wrong" in low:
        return "error-state rendered"
    if low in {"loading…", "loading..."} or low.startswith("loading…"):
        return "stuck on Loading…"
    return "ok"


async def capture(targets: list[Target]) -> list[tuple[Target, Path, str]]:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    results: list[tuple[Target, Path, str]] = []

    # Group by token so same-role targets share one authenticated context.
    by_token: dict[tuple[str, str], list[Target]] = {}
    for t in targets:
        by_token.setdefault((t.access, t.refresh), []).append(t)

    async with HarnessBrowser(WEB_BASE) as browser:
        for (access, refresh), group in by_token.items():
            async with browser.authed_page(access, refresh) as page:
                errors: list[str] = []
                page.on(
                    "console",
                    lambda m: errors.append(m.text) if m.type == "error" else None,
                )
                page.on("pageerror", lambda e: errors.append(str(e)))
                for t in group:
                    errors.clear()
                    url = f"{WEB_BASE}{t.path}"
                    try:
                        await page.goto(url, wait_until="networkidle", timeout=30000)
                    except Exception as e:  # noqa: BLE001
                        results.append((t, OUT_DIR / f"{t.name}.png", f"goto failed: {e}"))
                        continue
                    await page.wait_for_timeout(_ANIM_SETTLE_MS)
                    status = await _diagnose(page)
                    out = OUT_DIR / f"{t.name}.png"
                    await page.screenshot(path=str(out), full_page=True)
                    note = status
                    if errors:
                        note += f"; {len(errors)} console error(s)"
                    results.append((t, out, note))
    return results


async def _main() -> int:
    print("Seeding rich world …")
    seed = await seed_world_rich()
    print(
        f"  student_id={seed.student_id}\n"
        f"  course_id={seed.course_id}\n"
        f"  practice_assignment_id={seed.practice_assignment_id}"
    )
    targets = default_targets(seed)
    print(f"Capturing {len(targets)} route(s) from {WEB_BASE} …")
    results = await capture(targets)
    print("\nResults:")
    for t, path, note in results:
        print(f"  [{note}] {t.path}\n      -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
