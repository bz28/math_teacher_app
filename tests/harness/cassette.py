"""Record/replay cassettes for Claude calls — the harness's cost guardrail.

The harness exercises real AI generation, but paying for every rerun would be
wasteful and non-deterministic. So we intercept the three `call_claude_*`
helpers at their boundary (via a hook in `api/core/llm_client.py`) and:

  - **replay** (default for reruns): return the saved response. $0, no
    network, byte-identical. A miss is a hard error — never a silent live call.
  - **record**: always call live, then save the response (force-refresh).
  - **auto**: replay if a cassette exists, else call live and save it.
  - **off** (unset env): the hook is inert; production is unaffected.

Storage: one readable JSON file per call function, `_cassettes/<fn>.json`, a
dict keyed by a stable hash of the call's *identity* inputs. Each entry keeps a
short human-readable `meta` (mode/model/prompt snippet) so a PR diff is
reviewable — not a folder of opaque hash-named files. Writes take an exclusive
`flock` (the API server AND the harness process both record), so concurrent
records don't clobber each other. Only the RESPONSE is stored (not the input),
so the vision judge's cassette stays small.

The vision judge's file (`call_claude_vision.json`) is treated as a LOCAL CACHE
and gitignored — the judge is advisory (never gates pass/fail), so its scores
don't need to be a versioned, shared artifact. The generation cassettes
(`call_claude_json.json`) ARE committed: they're the frozen fixtures the
deterministic regression gate replays against.
"""

from __future__ import annotations

import asyncio
import contextlib
import fcntl
import hashlib
import json
import os
import re
import time
from pathlib import Path
from typing import Any

# Canonical-UUID token: a DB-driven probe (e.g. integrity) creates fresh
# rows each run, so a random row PK like the integrity `problem_id` leaks
# into the agent's prompt/transcript and would change the cassette key on
# every run — defeating $0 replay. We redact any standard 8-4-4-4-12 UUID
# in the hashed key payload to a fixed token so the key is stable across
# runs. Distinct calls still hash distinctly: turns differ by their text
# (growing transcript) and cases differ by their question text, not by the
# UUID alone, so redaction can't collapse two real calls onto one key. A
# payload with no UUID (grading/geometry/etc.) is unchanged byte-for-byte,
# so existing committed cassette keys are unaffected.
_UUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
)

# Sentinel for "no cassette on disk" — distinct from a recorded `None`.
MISS: Any = object()

_VALID_MODES = {"off", "replay", "record", "auto"}
_DEFAULT_DIR = Path(__file__).parent / "_cassettes"

# Call arguments that identify the logging/metadata context but never the
# response content — excluded from the cassette key.
_IDENTITY_EXCLUDE = {
    "session_id",
    "user_id",
    "submission_id",
    "call_metadata",
    "max_retries",
}


class CassetteMissError(RuntimeError):
    """Raised in replay mode when no cassette exists for a call — surfaces a
    missing recording loudly instead of silently spending on a live call."""


def build_identity(bound_args: dict[str, Any], default_model: str) -> dict[str, Any]:
    """Reduce a bound call's arguments to the fields that determine the
    response. Resolves the model default so `model=None` and the explicit
    default hash identically."""
    ident = {k: v for k, v in bound_args.items() if k not in _IDENTITY_EXCLUDE}
    ident["model"] = bound_args.get("model") or default_model
    return ident


def summarize(identity: dict[str, Any]) -> dict[str, Any]:
    """A compact, human-readable label stored alongside each cassette so the
    file is reviewable without decoding the hash key."""
    sys_p = str(identity.get("system_prompt") or "")[:80]
    usr_p = str(identity.get("user_message") or "")[:160]
    return {
        "mode": identity.get("mode"),
        "model": identity.get("model"),
        "prompt": (f"{sys_p} || {usr_p}").strip()[:200],
    }


class Cassette:
    """A disk-backed record/replay store: one JSON file per call function."""

    def __init__(self, mode: str, root: Path) -> None:
        self.mode = mode
        self.root = root
        self._cache: dict[str, dict[str, Any]] = {}  # fn -> {key: entry}

    def key(self, fn_name: str, identity: dict[str, Any]) -> str:
        payload = json.dumps(
            {"fn": fn_name, **identity}, sort_keys=True, default=str,
        )
        # Redact random row UUIDs so a DB-driven probe replays at $0 (see
        # _UUID_RE). No-op on payloads without a UUID.
        payload = _UUID_RE.sub("<uuid>", payload)
        return hashlib.sha256(payload.encode()).hexdigest()[:32]

    def _file(self, fn_name: str) -> Path:
        return self.root / f"{fn_name}.json"

    def _load(self, fn_name: str) -> dict[str, Any]:
        if fn_name not in self._cache:
            path = self._file(fn_name)
            try:
                self._cache[fn_name] = (
                    json.loads(path.read_text()) if path.exists() else {}
                )
            except (json.JSONDecodeError, OSError):
                self._cache[fn_name] = {}
        return self._cache[fn_name]

    def get(self, fn_name: str, key: str) -> Any:
        """Return the recorded response, or MISS if none on disk."""
        entry = self._load(fn_name).get(key)
        return entry["response"] if isinstance(entry, dict) else MISS

    async def put(
        self, fn_name: str, key: str, response: Any, summary: dict[str, Any],
    ) -> None:
        """Persist a live response under an exclusive file lock (both the API
        server and the harness process record, so writes must not clobber)."""
        await asyncio.to_thread(self._put_locked, fn_name, key, response, summary)
        self._cache.pop(fn_name, None)  # force a fresh read next get

    def _put_locked(
        self, fn_name: str, key: str, response: Any, summary: dict[str, Any],
    ) -> None:
        path = self._file(fn_name)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a+") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            try:
                f.seek(0)
                content = f.read()
                data: dict[str, Any] = {}
                if content.strip():
                    with contextlib.suppress(json.JSONDecodeError):
                        data = json.loads(content)
                data[key] = {
                    "meta": {"recorded_at": time.time(), **summary},
                    "response": response,
                }
                f.seek(0)
                f.truncate()
                f.write(json.dumps(data, indent=2, sort_keys=True, default=str))
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)


_instance: Cassette | None = None


def get_cassette() -> Cassette | None:
    """Return the active cassette, or None when the harness is off. Cheap and
    safe on every request: a single env read returns None in production."""
    mode = os.environ.get("HARNESS_LLM_MODE", "off")
    if mode not in _VALID_MODES or mode == "off":
        return None
    root = Path(os.environ.get("HARNESS_CASSETTE_DIR", str(_DEFAULT_DIR)))
    global _instance
    if _instance is None or _instance.mode != mode or _instance.root != root:
        _instance = Cassette(mode, root)
    return _instance
