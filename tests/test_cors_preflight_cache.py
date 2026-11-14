"""The web app is cross-origin to the API (veradicai.com → railway), so
every authed request is preceded by a preflight. Browsers may cache a
preflight for as long as the API allows — keep that at Chrome's 2h cap."""

from __future__ import annotations

from starlette.testclient import TestClient

from api.config import settings
from api.main import app

# An origin this environment actually allows (prod's include veradicai.com).
ORIGIN = settings.cors_origins[0]


def test_preflight_is_cacheable_for_two_hours() -> None:
    with TestClient(app) as c:
        res = c.options(
            "/v1/teacher/courses",
            headers={
                "Origin": ORIGIN,
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization",
            },
        )
    assert res.status_code == 200
    assert res.headers["access-control-allow-origin"] == ORIGIN
    assert res.headers["access-control-max-age"] == "7200"
