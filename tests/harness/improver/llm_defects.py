"""Channel A (CI side): turn production LLM-call defects into improver proposals.

The backend's read-only `/admin/llm-calls/defects` endpoint
(`api/routes/admin_llm.py`) surfaces recent prod calls that failed or carry the
control-char corruption fingerprint (the LaTeX-class bug), grouped by signature
with a keyset `watermark`. This module is the CI half of the loop:

  1. `fetch_defects` — GET those groups over HTTP with the static improver
     service key, so prod DB credentials never leave the backend.
  2. `defects_to_proposals` — deterministically ($0, no LLM) turn each group into
     a fix Proposal that flows through the SAME dedupe → rank → approve → execute
     pipeline as every other source. The defect IS the evidence; the execute
     subagent does the actual investigation.
  3. `read_watermark` / `write_watermark` — persist the keyset cursor in the
     improver state dir so each scan sees only NEW defects (no re-processing).

Proposal titles are deliberately COUNT-FREE: the proposal id hashes
`surface_key + title`, so a title that embedded the occurrence count would mint a
"new" id every run and defeat dedup. The volatile count lives in the rationale.
"""

from __future__ import annotations

from pathlib import Path

import httpx

from tests.harness.improver.proposals import Proposal, rank_filter

_WATERMARK_FILE = "llm_watermark.txt"


async def fetch_defects(
    *, api_base: str, service_key: str, since: str | None,
    hours: int = 24, limit: int = 1000, timeout: float = 30.0,
) -> dict[str, object]:
    """GET the defect groups + watermark from the backend. `api_base` is the API
    root (e.g. https://api.example.com/v1); the endpoint is appended. Auth is the
    static improver service key (X-Improver-Key header) — admin JWTs expire in
    minutes and can't be a stored CI secret. Raises on a non-2xx so CI sees auth /
    connectivity failures loudly (the key rides in a header, never the URL)."""
    params: dict[str, str | int] = {"hours": hours, "limit": limit}
    if since:
        params["since"] = since
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.get(
            f"{api_base.rstrip('/')}/admin/llm-calls/defects",
            params=params,
            headers={"X-Improver-Key": service_key},
        )
    resp.raise_for_status()
    data: dict[str, object] = resp.json()
    return data


def defects_to_proposals(
    defects: list[dict[str, object]], *, max_size: str = "M",
) -> list[Proposal]:
    """One fix Proposal per defect group. Deterministic — no LLM. `corrupt`
    groups point at the normalization path and rank high; `failed` groups are
    lower-confidence investigations."""
    out: list[Proposal] = []
    for d in defects:
        fn = str(d.get("function", "?"))
        kind = str(d.get("kind", "failed"))
        raw_count = d.get("count", 1)
        count = raw_count if isinstance(raw_count, int) else 1
        sample = str(d.get("sample_call_id", ""))
        raw_chars = d.get("corruption_chars", [])
        chars = ", ".join(str(c) for c in raw_chars) if isinstance(raw_chars, list) else ""
        if kind == "corrupt":
            title = f"Fix corrupted output from the `{fn}` LLM call"
            rationale = (
                f"{count} production `{fn}` call(s) produced output with control-char "
                f"corruption ({chars or 'control chars'}) — the LaTeX-class normalization "
                f"bug. Sample call {sample}."
            )
            change = (
                "Trace the output through `api/core/llm_client.py` _normalize_arrays / the "
                "JSON parse path; reproduce with the sample call and fix the corruption at "
                "the source."
            )
            severity, confidence = "high", 0.9
        else:
            title = f"Investigate failing `{fn}` LLM calls"
            rationale = (
                f"{count} production `{fn}` call(s) failed (success=false). Sample call {sample}."
            )
            change = (
                f"Inspect the `{fn}` call path and its error handling; reproduce with the "
                "sample call and address the failure."
            )
            severity, confidence = "medium", 0.6
        out.append(Proposal(
            surface_key=f"llm:{fn}", title=title, category="bug",
            severity=severity, rationale=rationale, change=change,
            est_size="M", confidence=confidence,
            # Canonical dedup anchor: one defect per (kind, function), stable
            # across runs regardless of the count baked into the title.
            defect_key=f"llm-{kind}/{fn}",
        ))
    return rank_filter(out, max_size=max_size)


def read_watermark(state_dir: Path) -> str | None:
    """The persisted keyset cursor from the last scan, or None on first run."""
    path = state_dir / _WATERMARK_FILE
    if not path.exists():
        return None
    cursor = path.read_text().strip()
    return cursor or None


def write_watermark(state_dir: Path, cursor: str) -> None:
    """Persist the keyset cursor so the next scan only sees newer rows."""
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / _WATERMARK_FILE).write_text(cursor)
