"""Smoke tests for the browser driver against local HTML fixtures.

No app boot needed — we point the driver at file:// pages to verify it
launches the cached Chromium, finds + screenshots a card, and detects when
a figure overflows its container. Skipped where no Chromium is available
(e.g. CI without a browser install)."""

from __future__ import annotations

import pytest

from tests.harness.browser import HarnessBrowser, find_cached_chromium

pytestmark = pytest.mark.skipif(
    find_cached_chromium() is None,
    reason="no cached Chromium binary available (browser harness is local-only)",
)

_CONTAINED = """
<div id="card" style="width:300px;height:300px;border:1px solid #ccc;
     display:flex;align-items:center;justify-content:center;overflow:hidden">
  <svg viewBox="0 0 10 10" role="img" style="height:80%;width:auto">
    <circle cx="5" cy="5" r="4" fill="none" stroke="black" stroke-width="0.3"/>
  </svg>
  <p>What is the area of this circle?</p>
</div>"""

_OVERFLOWING = """
<div id="card" style="width:100px;height:100px;border:1px solid #ccc">
  <svg viewBox="0 0 10 10" role="img" style="width:300px;height:300px">
    <rect x="1" y="1" width="8" height="8" fill="none" stroke="black"/>
  </svg>
</div>"""


def _data_url(html: str) -> str:
    import urllib.parse
    return "data:text/html," + urllib.parse.quote(html)


async def test_finds_and_screenshots_contained_card() -> None:
    async with HarnessBrowser(web_base="http://unused") as br:
        shot = await br.shoot_card(
            role="student", token="t", url=_data_url(_CONTAINED),
            card_selector="#card",
        )
    assert shot.found
    assert shot.png is not None and len(shot.png) > 0
    assert shot.overflow is False
    assert shot.console_errors == []


async def test_detects_overflowing_figure() -> None:
    async with HarnessBrowser(web_base="http://unused") as br:
        shot = await br.shoot_card(
            role="student", token="t", url=_data_url(_OVERFLOWING),
            card_selector="#card",
        )
    assert shot.found
    assert shot.overflow is True


async def test_missing_card_reported_not_crashed() -> None:
    async with HarnessBrowser(web_base="http://unused") as br:
        shot = await br.shoot_card(
            role="teacher", token="t", url=_data_url("<p>no card here</p>"),
            card_selector="#card",
        )
    assert shot.found is False
    assert shot.png is None
