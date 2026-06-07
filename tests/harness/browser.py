"""Browser driver — drives the real app in the cached Chromium.

What a probe needs from the browser: log in as a role, open a page, find a
specific question card, screenshot it (for the judge), and report whether
the figure overflows its container or the page logged console errors.

Auth matches the web app (web/src/lib/api.ts reads `veradic_access_token`
from localStorage): we inject the Bearer token via an init script that runs
before app JS, so the SPA boots already authenticated. The cached Chromium
binary is launched via `executable_path` so we never download another browser.
"""

from __future__ import annotations

import json
import os
import urllib.parse
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from playwright.async_api import (
    Browser,
    BrowserContext,
    ConsoleMessage,
    Page,
    Playwright,
    async_playwright,
)

# Both roles use the same primary token storage (web/src/lib/api.ts); the role
# comes from the token's claims, not the key. hasStoredTokens() requires BOTH
# an access AND a refresh token, so we must inject both or the auth guard
# bounces to /login. (veradic_teacher_* keys are a preview-mode stash, not a
# login.)
_ACCESS_KEY = "veradic_access_token"
_REFRESH_KEY = "veradic_refresh_token"
# The admin dashboard (dashboard/src/lib/api.ts) keeps its session under its OWN
# localStorage keys, not the web app's — so admin surfaces must inject under
# these or the dashboard auth guard bounces to /login.
_ADMIN_ACCESS_KEY = "admin_access_token"
_ADMIN_REFRESH_KEY = "admin_refresh_token"


def find_cached_chromium() -> str | None:
    """Locate a Chromium binary to reuse (env override, else the ms-playwright
    cache). Returns None to let Playwright use its own managed browser."""
    env = os.environ.get("HARNESS_CHROMIUM_PATH")
    if env:
        return env
    cache = Path.home() / "Library" / "Caches" / "ms-playwright"
    for pattern in (
        "chromium-*/chrome-mac*/*.app/Contents/MacOS/*",
        "chromium-*/chrome-linux/chrome",
    ):
        for path in sorted(cache.glob(pattern), reverse=True):
            if path.is_file():
                return str(path)
    return None


@dataclass
class CardShot:
    """Result of screenshotting one question card from one role's view."""

    role: str
    url: str
    found: bool
    png: bytes | None
    console_errors: list[str] = field(default_factory=list)
    overflow: bool = False


class HarnessBrowser:
    """Async context manager owning one Chromium instance for a run."""

    def __init__(self, web_base: str, executable_path: str | None = None) -> None:
        self.web_base = web_base.rstrip("/")
        self.executable_path = executable_path or find_cached_chromium()
        self._pw: Playwright | None = None
        self._browser: Browser | None = None

    async def __aenter__(self) -> HarnessBrowser:
        self._pw = await async_playwright().start()
        kwargs: dict[str, Any] = {"headless": True, "args": ["--disable-gpu"]}
        if self.executable_path:
            kwargs["executable_path"] = self.executable_path
        self._browser = await self._pw.chromium.launch(**kwargs)
        return self

    async def __aexit__(self, *exc: object) -> None:
        if self._browser is not None:
            await self._browser.close()
        if self._pw is not None:
            await self._pw.stop()

    async def _context_for(
        self, access_token: str, refresh_token: str,
        *, access_key: str = _ACCESS_KEY, refresh_key: str = _REFRESH_KEY,
    ) -> BrowserContext:
        assert self._browser is not None, "browser not started"
        ctx = await self._browser.new_context(
            viewport={"width": 1100, "height": 1400}, device_scale_factor=2,
        )
        # Inject both tokens before any app script runs, so the SPA boots
        # authenticated rather than bouncing to /login. Keys default to the web
        # app's; admin surfaces pass the dashboard's keys.
        script = (
            f"try {{ var ls = window.localStorage;"
            f"ls.setItem({json.dumps(access_key)}, {json.dumps(access_token)});"
            f"ls.setItem({json.dumps(refresh_key)}, {json.dumps(refresh_token)});"
            f"}} catch (e) {{}}"
        )
        await ctx.add_init_script(script)
        return ctx

    async def shoot_card(
        self,
        *,
        role: str,
        token: str,
        url: str,
        card_selector: str,
        refresh_token: str = "",
        ready_selector: str | None = None,
        timeout_ms: int = 30000,
    ) -> CardShot:
        """Open `url` as `role`, wait for readiness, and screenshot the first
        element matching `card_selector`. Captures console errors throughout
        and checks whether the card's SVG spills outside the card box."""
        # Absolute (has a scheme: http/https/file/data) → use as-is; else
        # treat as a path relative to the web app base.
        is_absolute = bool(urllib.parse.urlsplit(url).scheme)
        full_url = url if is_absolute else f"{self.web_base}{url}"
        ctx = await self._context_for(token, refresh_token)
        errors: list[str] = []

        def _on_console(msg: ConsoleMessage) -> None:
            if msg.type == "error":
                errors.append(msg.text)

        page = await ctx.new_page()
        page.on("console", _on_console)
        page.on("pageerror", lambda e: errors.append(str(e)))

        found = False
        png: bytes | None = None
        overflow = False
        try:
            await page.goto(full_url, wait_until="networkidle", timeout=timeout_ms)
            if ready_selector:
                await page.wait_for_selector(ready_selector, timeout=timeout_ms)
            card = page.locator(card_selector).first
            if await card.count() > 0:
                found = True
                await card.scroll_into_view_if_needed()
                png = await card.screenshot()
                overflow = await self._svg_overflows(page, card_selector)
        finally:
            await ctx.close()

        return CardShot(
            role=role, url=full_url, found=found, png=png,
            console_errors=errors, overflow=overflow,
        )

    @asynccontextmanager
    async def plain_page(self) -> AsyncIterator[Page]:
        """Yield a Page in a fresh UNauthenticated context (no token injection),
        for flows that drive the real login / sign-up path from logged-out."""
        assert self._browser is not None, "browser not started"
        ctx = await self._browser.new_context(
            viewport={"width": 1100, "height": 1400}, device_scale_factor=2,
        )
        try:
            page = await ctx.new_page()
            yield page
        finally:
            await ctx.close()

    @asynccontextmanager
    async def authed_page(
        self, access_token: str, refresh_token: str,
        *, access_key: str = _ACCESS_KEY, refresh_key: str = _REFRESH_KEY,
    ) -> AsyncIterator[Page]:
        """Yield a Page in a fresh context authenticated with the given
        tokens, for probes that drive custom UI flows (clicks, modals). The
        context is torn down on exit. `access_key`/`refresh_key` default to the
        web app's localStorage keys; pass the dashboard's for admin surfaces."""
        ctx = await self._context_for(
            access_token, refresh_token, access_key=access_key, refresh_key=refresh_key,
        )
        try:
            page = await ctx.new_page()
            yield page
        finally:
            await ctx.close()

    async def svg_overflows(self, page: Page, scope_selector: str) -> bool:
        """Public wrapper for the overflow probe, scoped to `scope_selector`
        (e.g. a dialog or card). Used by probes driving custom flows."""
        return await self._svg_overflows(page, scope_selector)

    async def _svg_overflows(self, page: Any, card_selector: str) -> bool:
        """True if the card's <svg> extends beyond the card's box — i.e. the
        figure clips or spills into surrounding content."""
        result = await page.evaluate(
            """(sel) => {
                const card = document.querySelector(sel);
                if (!card) return false;
                const svg = card.querySelector('svg');
                if (!svg) return false;
                const c = card.getBoundingClientRect();
                const s = svg.getBoundingClientRect();
                const pad = 1; // tolerate sub-pixel rounding
                return s.right > c.right + pad || s.bottom > c.bottom + pad
                    || s.left < c.left - pad || s.top < c.top - pad;
            }""",
            card_selector,
        )
        return bool(result)
