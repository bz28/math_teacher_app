"""The walkthrough recorder's seed rewrites join codes and emails across the
whole database it points at, so it must refuse anything but a local DB with
local photo storage."""

import pytest

from api.config import settings
from scripts.walkthrough.seed import assert_local_world


@pytest.mark.parametrize(
    "url",
    [
        "postgresql+asyncpg://u:p@db.prod.internal:5432/veradic",
        "postgresql+asyncpg://u:p@localhost.evil.com:5432/veradic",
        "",
    ],
)
def test_refuses_non_local_database(monkeypatch, url):
    monkeypatch.setattr(settings, "database_url", url)
    monkeypatch.setattr(settings, "photo_bucket", "")
    with pytest.raises(SystemExit, match="localhost"):
        assert_local_world()


def test_refuses_real_photo_bucket(monkeypatch):
    monkeypatch.setattr(settings, "database_url", "postgresql+asyncpg://u:p@localhost:5432/w")
    monkeypatch.setattr(settings, "photo_bucket", "veradic-photos")
    with pytest.raises(SystemExit, match="PHOTO_BUCKET"):
        assert_local_world()


def test_allows_local(monkeypatch):
    monkeypatch.setattr(settings, "database_url", "postgresql+asyncpg://u:p@127.0.0.1:5432/w")
    monkeypatch.setattr(settings, "photo_bucket", "")
    assert_local_world()
