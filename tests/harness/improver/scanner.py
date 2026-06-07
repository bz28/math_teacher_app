"""Drive the real app to one full-page screenshot + objective signal per surface.

Reuses the harness browser (cached Chromium + token injection in `browser.py`)
and an isolated seeded world (`seed.py`). The card-level harness screenshots a
single question card; the improver captures the WHOLE page, because the
question it asks ("what could be better here") is about the page, not one card.

Each surface is scanned in its own fresh browser context and any failure is
recorded as data on the PageObservation — one broken route never aborts the
sweep.
"""

from __future__ import annotations

import time

from playwright.async_api import ConsoleMessage

from tests.harness.browser import HarnessBrowser
from tests.harness.improver.detectors import run_detectors
from tests.harness.improver.judge import judge_page
from tests.harness.improver.types import PageObservation, Surface
from tests.harness.seed import Seed


def seed_ids(seed: Seed) -> dict[str, str]:
    """The placeholder values a surface path may reference."""
    return {
        "course_id": seed.course_id,
        "unit_id": seed.unit_id,
        "assignment_id": seed.assignment_id,
        "teacher_id": seed.teacher_id,
        "student_id": seed.student_id,
    }


def _tokens_for(role: str, seed: Seed) -> tuple[str, str]:
    """Which seeded (access, refresh) pair to inject for a surface's role.
    Public pages get empty tokens (the app treats absent/empty as logged-out)."""
    if role == "teacher":
        return seed.teacher_token, seed.teacher_refresh
    if role == "student":
        return seed.student_token, seed.student_refresh
    if role == "admin":
        return seed.admin_token, seed.admin_refresh
    return "", ""


async def scan_surface(
    browser: HarnessBrowser,
    surface: Surface,
    base_url: str,
    seed: Seed,
    *,
    judge: bool = True,
    timeout_ms: int = 30000,
) -> PageObservation:
    """Open one surface authenticated for its role, time the load, screenshot the
    full page, then run the objective detectors (live DOM) and — unless `judge`
    is off — the UX vision judge. All signal lands on `obs.hits`."""
    path = surface.resolve(seed_ids(seed))
    full_url = path if "://" in path else f"{base_url.rstrip('/')}{path}"
    access, refresh = _tokens_for(surface.role, seed)
    # The admin dashboard stores its session under different localStorage keys
    # than the web app, so admin surfaces must inject under those.
    key_kwargs = (
        {"access_key": "admin_access_token", "refresh_key": "admin_refresh_token"}
        if surface.app == "admin" else {}
    )

    obs = PageObservation(
        surface_key=surface.key, url=full_url, role=surface.role, ok=False,
    )
    errors: list[str] = []

    def _on_console(msg: ConsoleMessage) -> None:
        if msg.type == "error":
            errors.append(msg.text)

    async with browser.authed_page(access, refresh, **key_kwargs) as page:
        page.on("console", _on_console)
        page.on("pageerror", lambda e: errors.append(str(e)))
        try:
            started = time.monotonic()
            await page.goto(full_url, wait_until="networkidle", timeout=timeout_ms)
            if surface.ready_selector:
                await page.wait_for_selector(surface.ready_selector, timeout=timeout_ms)
            obs.load_ms = (time.monotonic() - started) * 1000
            obs.png = await page.screenshot(full_page=True)
            obs.ok = True
            # Objective detectors need the live page, so run them before the
            # context closes; the judge only needs the screenshot bytes.
            obs.hits = await run_detectors(page, load_ms=obs.load_ms)
        except Exception as e:  # noqa: BLE001 — a broken route is data, not a crash
            obs.error = str(e)[:200]

    obs.console_errors = errors
    if judge and obs.png is not None:
        obs.hits.extend(await judge_page(
            obs.png, surface_key=surface.key, title=surface.title, role=surface.role,
        ))
    return obs


async def scan_surfaces(
    browser: HarnessBrowser,
    surfaces: list[Surface],
    bases: dict[str, str],
    seed: Seed,
    *,
    judge: bool = True,
    timeout_ms: int = 30000,
) -> list[PageObservation]:
    """Scan every surface serially (each in its own context). Surfaces whose app
    has no configured base URL are skipped with an explanatory observation."""
    out: list[PageObservation] = []
    for s in surfaces:
        base = bases.get(s.app)
        if not base:
            out.append(PageObservation(
                surface_key=s.key, url=s.path, role=s.role, ok=False,
                error=f"no base URL configured for app '{s.app}'",
            ))
            continue
        out.append(await scan_surface(
            browser, s, base, seed, judge=judge, timeout_ms=timeout_ms,
        ))
    return out
