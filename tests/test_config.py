
import pytest


def test_settings_loads_from_env() -> None:
    from api.config import settings

    assert settings.jwt_secret == "test-secret-key"
    assert settings.app_env == "test"
    assert settings.jwt_access_token_expire_minutes == 15


def test_settings_fails_without_required_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify pydantic-settings validation catches missing keys."""
    from pydantic import ValidationError

    from api.config import Settings

    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.delenv("CLAUDE_API_KEY", raising=False)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)  # type: ignore[call-arg]
