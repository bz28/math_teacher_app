"""Record/replay cassettes for Claude calls — the harness's cost guardrail.

The harness exercises real AI generation, but paying for every rerun would
be wasteful and non-deterministic. So we intercept the three `call_claude_*`
helpers at their boundary (via a hook in `api/core/llm_client.py`) and:

  - **replay** (default for reruns): return the saved response. $0, no
    network, byte-identical every time. A miss is a hard error — we never
    silently fall back to a live call in replay mode.
  - **record**: always call live, then save the response.
  - **auto**: replay if a cassette exists, else call live and save it
    (first run / newly-added inputs).
  - **off** (unset env): the hook is inert; production is unaffected.

The mode comes from the `HARNESS_LLM_MODE` env var. Cassettes live on disk
under `_cassettes/<fn>/<key>.json`, keyed by a stable hash of the call's
*identity* inputs (model, prompts, messages/image content, tool schema,
token budget) — excluding noise like session/user ids that don't change
the response. Only the RESPONSE is stored (not the input), so cassettes
stay small and reviewable even when the input carries a base64 image.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any

# Sentinel for "no cassette on disk" — distinct from a recorded `None`.
MISS: Any = object()

_VALID_MODES = {"off", "replay", "record", "auto"}
_DEFAULT_DIR = Path(__file__).parent / "_cassettes"

# Call arguments that identify the logging/metadata context but never the
# response content — excluded from the cassette key so the same prompt
# replays regardless of who/when called it.
_IDENTITY_EXCLUDE = {
    "session_id",
    "user_id",
    "submission_id",
    "call_metadata",
    "max_retries",
}


class CassetteMissError(RuntimeError):
    """Raised in replay mode when no cassette exists for a call — surfaces
    a missing recording loudly instead of silently spending on a live call.
    """


def build_identity(bound_args: dict[str, Any], default_model: str) -> dict[str, Any]:
    """Reduce a bound call's arguments to the fields that determine the
    response. Resolves the model default so `model=None` and the explicit
    default hash identically."""
    ident = {k: v for k, v in bound_args.items() if k not in _IDENTITY_EXCLUDE}
    ident["model"] = bound_args.get("model") or default_model
    return ident


class Cassette:
    """A disk-backed record/replay store for one harness run."""

    def __init__(self, mode: str, root: Path) -> None:
        self.mode = mode
        self.root = root

    def key(self, fn_name: str, identity: dict[str, Any]) -> str:
        """Stable content hash of a call. `default=str` canonicalizes any
        non-JSON-native values (e.g. enum labels); `sort_keys` makes dict
        ordering irrelevant. Truncated to 32 hex chars — ample to avoid
        collisions within a run."""
        payload = json.dumps(
            {"fn": fn_name, **identity}, sort_keys=True, default=str,
        )
        return hashlib.sha256(payload.encode()).hexdigest()[:32]

    def _path(self, fn_name: str, key: str) -> Path:
        return self.root / fn_name / f"{key}.json"

    def get(self, fn_name: str, key: str) -> Any:
        """Return the recorded response, or MISS if none on disk."""
        path = self._path(fn_name, key)
        if not path.exists():
            return MISS
        return json.loads(path.read_text())["response"]

    def put(
        self,
        fn_name: str,
        key: str,
        response: Any,
        summary: dict[str, Any],
    ) -> None:
        """Persist a live response. Stores a small human-readable `meta`
        block (mode/model/prompt snippet) alongside the response so a
        reviewer can tell cassettes apart without decoding the hash."""
        path = self._path(fn_name, key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "meta": {"fn": fn_name, "recorded_at": time.time(), **summary},
                    "response": response,
                },
                indent=2,
                default=str,
            ),
        )


_instance: Cassette | None = None


def get_cassette() -> Cassette | None:
    """Return the active cassette, or None when the harness is off.

    Cheap and safe to call on every LLM request: a single env read in the
    common (production) case where the var is unset returns None.
    """
    mode = os.environ.get("HARNESS_LLM_MODE", "off")
    if mode not in _VALID_MODES or mode == "off":
        return None
    root = Path(os.environ.get("HARNESS_CASSETTE_DIR", str(_DEFAULT_DIR)))
    global _instance
    if _instance is None or _instance.mode != mode or _instance.root != root:
        _instance = Cassette(mode, root)
    return _instance


def summarize(identity: dict[str, Any]) -> dict[str, Any]:
    """A compact, human-readable label for a stored cassette."""
    prompt = identity.get("system_prompt") or identity.get("user_message") or ""
    return {
        "mode": identity.get("mode"),
        "model": identity.get("model"),
        "prompt": str(prompt)[:120],
    }
