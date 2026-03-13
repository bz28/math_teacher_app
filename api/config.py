import json

from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database
    database_url: str

    # Auth
    jwt_secret: str
    jwt_access_token_expire_minutes: int = 15
    jwt_refresh_token_expire_days: int = 7

    # Claude API
    claude_api_key: str

    # Sentry
    sentry_dsn: str = ""

    # App
    app_env: str = "development"
    log_level: str = "INFO"
    cors_origins: list[str] = ["http://localhost:8081", "http://localhost:3000"]

    # Rate Limits
    daily_request_cap_free: int = 50

    # LLM Models
    llm_model_sonnet: str = "claude-sonnet-4-20250514"
    llm_model_haiku: str = "claude-haiku-4-5-20251001"

    # Cost Alerting
    daily_cost_limit_usd: float = 50.0

    # Request size limit (bytes) - 10MB
    max_request_size: int = 10 * 1024 * 1024

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: str | list[str]) -> list[str]:
        if isinstance(v, str):
            return [str(item) for item in json.loads(v)]
        return v

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
