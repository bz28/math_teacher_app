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
    jwt_refresh_grace_period_seconds: int = 30

    # Claude API
    claude_api_key: str

    # GitHub — used by the admin "Debug with agent" button to dispatch a
    # debug-llm-call workflow. Empty token disables the feature (endpoint 503s).
    github_dispatch_token: str = ""
    github_repo: str = "bz28/math_teacher_app"

    # Harness ingest — shared secret that lets CI (GitHub Actions, which can't
    # open a Postgres connection to prod) POST autonomous-harness run summaries
    # to the admin "Harness Runs" tab over HTTPS. Empty token disables the
    # endpoint (503).
    harness_ingest_token: str = ""
    # Shared secret for POST /internal/grading/drain. Empty disables
    # the endpoint (503) rather than leaving it open — an unguarded
    # drain lets anyone force every pending class to grade on demand.
    grading_drain_token: str = ""

    # Improver — a static service key the scheduled LLM-defect scan presents
    # (X-Improver-Key) to the read-only defect endpoint. Admin JWTs expire in
    # minutes, so they can't be a stored CI secret; this long random key can.
    # Empty disables service-key auth (admin JWT still works); rotate to revoke.
    improver_api_key: str = ""

    # Sentry
    sentry_dsn: str = ""

    # App
    app_env: str = "development"
    log_level: str = "INFO"
    cors_origins: list[str] = [
        "http://localhost:8081",
        "http://localhost:3000",
        "https://veradicai.com",
        "https://www.veradicai.com",
        "https://math-teacher-app-eight.vercel.app",
    ]

    # LLM Models
    # Sonnet 4.6 is priced identically to Sonnet 4.0 per Anthropic's
    # pricing table ($3 input / $15 output per MTok), so the bump is
    # cost-neutral. Env var override still available via LLM_MODEL_SONNET.
    llm_model_sonnet: str = "claude-sonnet-4-6"
    llm_model_haiku: str = "claude-haiku-4-5-20251001"
    # Reads students' handwriting. On 50 of the hardest real problems,
    # checked blind against the photos, it made 2 reading errors to
    # Sonnet 4.6's 30.
    # Also grades. Told that the answer key's theorem isn't required,
    # Sonnet 4.6 gave an SSA proof labelled SAS full credit in 4 of 6 runs;
    # Opus gave it partial credit every time, and full credit to valid
    # alternatives (Triangle Sum, AAS), 6 of 6 runs on each case.
    llm_model_opus: str = "claude-opus-5-5"

    # Geometry figures: the AI places named points and lists what to draw
    # ("construction" figures); code draws them, checks them against the
    # problem, and writes the chat's sentence about the figure. Off restores
    # the triangle / circle / polygon prompts and schemas. On by default.
    geometry_construction_figures: bool = True

    # Cost Alerting
    daily_cost_limit_usd: float = 50.0

    # Request size limit (bytes) - 10MB
    max_request_size: int = 10 * 1024 * 1024

    # Frontend URL (used for password reset links, etc.)
    frontend_url: str = "https://veradicai.com"

    # Email (Resend)
    resend_api_key: str = ""
    email_from_address: str = "Veradic AI <support@veradicai.com>"
    admin_alert_emails: list[str] = [
        "ben@veradicai.com",
        "nathaniel@veradicai.com",
        "support@veradicai.com",
    ]

    # Subscriptions
    revenuecat_webhook_secret: str = ""
    bypass_subscription: bool = False

    # Stripe (teacher self-serve subscription)
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    teacher_pro_stripe_price_id: str = ""
    stripe_checkout_success_url: str = "https://veradicai.com/pricing/success"
    stripe_checkout_cancel_url: str = "https://veradicai.com/pricing"
    stripe_portal_return_url: str = "https://veradicai.com/pricing"

    @field_validator("cors_origins", "admin_alert_emails", mode="before")
    @classmethod
    def parse_string_list(cls, v: str | list[str]) -> list[str]:
        if isinstance(v, str):
            return [str(item) for item in json.loads(v)]
        return v

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
