export function formatRelativeDate(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// Cost formatter — tiered precision so a $400/mo school bill and a
// $0.0008 per-submission unit cost both render legibly. Single source
// of truth so the same value reads the same on every page.
export function fmtCost(n: number): string {
  if (n >= 1000) return `$${n.toFixed(0)}`;
  if (n >= 10) return `$${n.toFixed(2)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

export function fmtPercent(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`;
}

// Wall-time formatter — handles seconds, minutes, hours so a multi-
// hour pathological flight-recorder run reads as "3h 12m" not
// "192m 0s".
export function fmtWallTime(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    const s = Math.round((ms % 60_000) / 1000);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

// Sub-second elapsed offset — used inside the flight recorder for
// "+offset from start" timing on each call row.
export function fmtRelativeMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// First UUID segment as a compact stable handle — enough to scan
// visually while keeping chips/links short.
export function shortId(id: string): string {
  const idx = id.indexOf("-");
  return idx > 0 ? id.slice(0, idx) : id.slice(0, 8);
}

// Human-readable Claude model label — collapses the "claude-…-YYYYMMDD"
// IDs into a generation+tier label.
export function shortModel(model: string): string {
  if (model.includes("sonnet")) return "Sonnet 4";
  if (model.includes("haiku")) return "Haiku 4.5";
  if (model.includes("opus")) return "Opus 4";
  return model.replace(/-\d{8}$/, "").replace(/^claude-/, "");
}

// JSON-stringify nested values so a chip never shows "[object Object]"
// when a future caller stamps a structured metadata value. Primitives
// pass through unchanged.
export function renderChipValue(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return "[unserializable]";
    }
  }
  return String(v);
}
