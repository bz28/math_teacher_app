"""Budget governor — the guarantee the improver never runs away with spend.

Three layers, matching what was locked with Ben:
  1. A hard self-imposed LEDGER + caps. Every scan/execution is recorded with
     its measured cost; before each run the governor refuses to start once the
     rolling-window caps are hit. This is the backstop that makes runaway spend
     impossible even if the schedule is misconfigured.
  2. A SEPARATE API KEY seam. When IMPROVER_ANTHROPIC_API_KEY is set, the scan
     process points the LLM client at it (see __main__), so scan/judge/ideation
     spend is metered Console dollars, never the Claude subscription. The ledger
     then tracks real dollars.
  3. An optional LOCAL-USAGE throttle. A best-effort sum of this machine's
     Claude Code transcript tokens in the window, so the improver can also back
     off when Ben's own manual usage is hot. Approximate + machine-local — a
     courtesy, never the guarantee.

State (the ledger) lives as JSON under IMPROVER_STATE_DIR; the cloud loop
(Phase 4) persists that dir on the `improver/state` branch so it survives the
fresh-clone-per-run model.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path

_FIVE_HOURS = timedelta(hours=5)
_SEVEN_DAYS = timedelta(days=7)


def _atomic_write(path: Path, text: str) -> None:
    """Write via a temp file + atomic replace, so a crash mid-write or a
    concurrent reader never sees a half-written (corrupt) state file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.tmp")
    tmp.write_text(text)
    tmp.replace(path)


def state_dir() -> Path:
    """Where the ledger + proposal queue + decline-list live."""
    return Path(os.environ.get(
        "IMPROVER_STATE_DIR",
        str(Path(__file__).parent / "_state"),
    ))


def improver_api_key() -> str | None:
    """The dedicated Console key for the improver's LLM spend, if configured.
    __main__ applies it to the client by exporting CLAUDE_API_KEY before app
    import, so all scan/judge/ideation calls bill this key, not the subscription."""
    key = os.environ.get("IMPROVER_ANTHROPIC_API_KEY", "").strip()
    return key or None


@dataclass
class BudgetCaps:
    """Conservative defaults; override via env. Cadence tied to the limit-reset
    window means ~1 scan per 5h, so the default cap leaves headroom for a retry."""

    max_scans_per_5h: int = 2
    max_executions_per_7d: int = 8
    max_usd_per_7d: float = 15.0
    # Courtesy throttle: skip a scan if local Claude usage in the last 5h already
    # exceeds this many tokens (0 disables). Approximate; off by default.
    local_token_ceiling_5h: int = 0

    @classmethod
    def from_env(cls) -> BudgetCaps:
        def _int(name: str, default: int) -> int:
            try:
                return int(os.environ.get(name, default))
            except ValueError:
                return default

        def _float(name: str, default: float) -> float:
            try:
                return float(os.environ.get(name, default))
            except ValueError:
                return default

        return cls(
            max_scans_per_5h=_int("IMPROVER_MAX_SCANS_5H", cls.max_scans_per_5h),
            max_executions_per_7d=_int("IMPROVER_MAX_EXEC_7D", cls.max_executions_per_7d),
            max_usd_per_7d=_float("IMPROVER_MAX_USD_7D", cls.max_usd_per_7d),
            local_token_ceiling_5h=_int("IMPROVER_LOCAL_TOKEN_CEILING_5H", cls.local_token_ceiling_5h),
        )


@dataclass
class LedgerEntry:
    ts: str  # ISO-8601 UTC
    kind: str  # "scan" | "execute"
    cost_usd: float = 0.0
    note: str = ""

    @property
    def when(self) -> datetime:
        return datetime.fromisoformat(self.ts)


@dataclass
class Ledger:
    path: Path
    entries: list[LedgerEntry] = field(default_factory=list)

    @classmethod
    def load(cls, directory: Path | None = None) -> Ledger:
        d = directory or state_dir()
        path = d / "ledger.json"
        entries: list[LedgerEntry] = []
        if path.exists():
            try:
                raw = json.loads(path.read_text())
            except json.JSONDecodeError:
                raw = []
            for e in raw:  # skip only the corrupt rows, never reset the window to 0
                try:
                    entries.append(LedgerEntry(**e))
                except TypeError:
                    continue
        return cls(path=path, entries=entries)

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        _atomic_write(self.path, json.dumps([asdict(e) for e in self.entries], indent=2))

    def record(self, kind: str, *, cost_usd: float = 0.0, note: str = "", now: datetime | None = None) -> None:
        self.entries.append(LedgerEntry(
            ts=(now or datetime.now(UTC)).isoformat(), kind=kind,
            cost_usd=round(cost_usd, 4), note=note,
        ))
        self.save()

    def _within(self, window: timedelta, now: datetime) -> list[LedgerEntry]:
        cutoff = now - window
        out: list[LedgerEntry] = []
        for e in self.entries:
            try:
                if e.when >= cutoff:
                    out.append(e)
            except ValueError:
                continue
        return out

    def scans_in_5h(self, now: datetime) -> int:
        return sum(1 for e in self._within(_FIVE_HOURS, now) if e.kind == "scan")

    def executions_in_7d(self, now: datetime) -> int:
        return sum(1 for e in self._within(_SEVEN_DAYS, now) if e.kind == "execute")

    def spend_in_7d(self, now: datetime) -> float:
        return round(sum(e.cost_usd for e in self._within(_SEVEN_DAYS, now)), 4)


@dataclass
class BudgetVerdict:
    ok: bool
    reason: str


def check_scan(caps: BudgetCaps, ledger: Ledger, *, now: datetime | None = None) -> BudgetVerdict:
    """May a scan start now? Refuses past the rolling caps or the local-usage
    courtesy ceiling."""
    now = now or datetime.now(UTC)
    if ledger.spend_in_7d(now) >= caps.max_usd_per_7d:
        return BudgetVerdict(False, f"7d spend ${ledger.spend_in_7d(now):.2f} >= cap ${caps.max_usd_per_7d:.2f}")
    if ledger.scans_in_5h(now) >= caps.max_scans_per_5h:
        return BudgetVerdict(False, f"{ledger.scans_in_5h(now)} scans in last 5h >= cap {caps.max_scans_per_5h}")
    if caps.local_token_ceiling_5h:
        used = local_usage_estimate(_FIVE_HOURS)
        if used >= caps.local_token_ceiling_5h:
            return BudgetVerdict(False, f"local usage ~{used} tok in 5h >= ceiling {caps.local_token_ceiling_5h}")
    return BudgetVerdict(True, "within budget")


def check_execute(caps: BudgetCaps, ledger: Ledger, *, now: datetime | None = None) -> BudgetVerdict:
    """May an execution (autopilot run that opens a PR) start now?"""
    now = now or datetime.now(UTC)
    if ledger.spend_in_7d(now) >= caps.max_usd_per_7d:
        return BudgetVerdict(False, f"7d spend ${ledger.spend_in_7d(now):.2f} >= cap ${caps.max_usd_per_7d:.2f}")
    execs = ledger.executions_in_7d(now)
    if execs >= caps.max_executions_per_7d:
        return BudgetVerdict(False, f"{execs} executions in 7d >= cap {caps.max_executions_per_7d}")
    return BudgetVerdict(True, "within budget")


def local_usage_estimate(window: timedelta) -> int:
    """Best-effort sum of this machine's Claude Code token usage in `window`,
    read from the session transcripts (~/.claude/projects/**/*.jsonl). Approximate
    and local-only — used solely for the optional courtesy throttle. Returns 0 on
    any error (never blocks on its own failure)."""
    try:
        root = Path.home() / ".claude" / "projects"
        if not root.exists():
            return 0
        cutoff = datetime.now(UTC) - window
        total = 0
        for jf in root.rglob("*.jsonl"):
            try:
                if datetime.fromtimestamp(jf.stat().st_mtime, UTC) < cutoff:
                    continue  # whole file older than the window
            except OSError:
                continue
            for line in jf.read_text(errors="ignore").splitlines():
                if '"usage"' not in line:
                    continue
                try:
                    usage = json.loads(line).get("message", {}).get("usage", {})
                except (json.JSONDecodeError, AttributeError):
                    continue
                total += int(usage.get("input_tokens", 0)) + int(usage.get("output_tokens", 0))
        return total
    except Exception:  # noqa: BLE001 — the throttle must never crash the run
        return 0
