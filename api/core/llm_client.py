"""Shared AsyncAnthropic client singleton.

Reuses a single HTTP connection pool across all LLM calls instead of
creating a new client (and pool) per request.
"""

from anthropic import AsyncAnthropic

from api.config import settings

_client: AsyncAnthropic | None = None


def get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        _client = AsyncAnthropic(api_key=settings.claude_api_key)
    return _client
