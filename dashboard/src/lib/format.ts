// Shared contract — keep byte-identical with web/src/lib/utils.ts and
// mobile/src/utils/dateFormatting.ts: "just now" / "Nm ago" / "Nh ago" / "Nd ago" (<7d), then "Mon D".
export function formatRelativeDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;

  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Cost formatter — tiered precision so a $400/mo school bill and a
// $0.0008 per-submission unit cost both render legibly. Single source
// of truth so the same value reads the same on every page. Exactly-zero
// spend renders as an em-dash ("no spend"): "$0.0000" reads oddly and
// buries genuine zero-cost rows in noise.
export function fmtCost(n: number): string {
  if (n === 0) return "—";
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
// Rounding the remainder independently of the quotient could carry it
// to a full unit and print it anyway: 86_390_000ms rendered "23h 60m",
// and 359_600ms rendered "5m 60s". Round to the smaller unit FIRST,
// then divide, so the carry lands where it belongs.
export function fmtWallTime(ms: number): string {
  // Tier on the ROUNDED value, not the raw one. Choosing the tier first
  // let the carry escape upward: 59_999ms rounded to "60.0s" and
  // 3_599_600ms to "60m 0s" — the same defect as "23h 60m", just one
  // tier further along each time.
  if (ms < 59_950) return `${(ms / 1000).toFixed(1)}s`;
  const totalS = Math.round(ms / 1000);
  if (totalS < 3600) return `${Math.floor(totalS / 60)}m ${totalS % 60}s`;
  const totalM = Math.round(ms / 60_000);
  return `${Math.floor(totalM / 60)}h ${totalM % 60}m`;
}

// Elapsed offset from the first call — the "+X from start" on each row.
//
// This was sub-second only, which was right when a trace was one
// pipeline burst. It isn't any more: grading is deliberately deferred to
// the assignment's due date by the durable queue, so the gap between the
// Vision read and the grading call is routinely hours or days. A
// day-long offset rendered as "+86389.00s from start" — technically
// true, unreadable, and the number an operator most wants to grasp at a
// glance on this page.
export function fmtRelativeMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 90_000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms < 5_400_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 172_800_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

// First UUID segment as a compact stable handle — enough to scan
// visually while keeping chips/links short.
export function shortId(id: string): string {
  const idx = id.indexOf("-");
  return idx > 0 ? id.slice(0, idx) : id.slice(0, 8);
}

/**
 * Human-readable Claude model label.
 *
 * Reads the version out of the id instead of hardcoding it per tier. The
 * previous version mapped any id containing "sonnet" to the literal
 * "Sonnet 4", so `claude-sonnet-4-6` — every sonnet call we make — was
 * displayed as Sonnet 4. On a console whose job is judging AI output that
 * is the worst possible field to round off: "the same prompt got worse"
 * and "we moved a minor version" are the first two hypotheses for a
 * quality regression, and the label silently erased the second one.
 *
 * The dated-snapshot suffix IS dropped — `-20251001` never disambiguates
 * anything you'd act on, and the full id is one hover away at every call
 * site.
 */
export function shortModel(model: string): string {
  // The minor group is bounded to 1-2 digits so an 8-digit dated
  // snapshot can't be read as a minor version:
  //   claude-sonnet-4-20250514  -> Sonnet 4    (not "Sonnet 4.20250514")
  //   claude-opus-4-1-20250805  -> Opus 4.1
  const m = /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/.exec(model);
  if (!m) return model.replace(/-\d{8}$/, "").replace(/^claude-/, "");
  const tier = m[1][0].toUpperCase() + m[1].slice(1);
  return `${tier} ${m[3] ? `${m[2]}.${m[3]}` : m[2]}`;
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

/**
 * Absolute wall-clock time for a log row.
 *
 * Relative dates ("3d ago") are right for "when was this teacher last
 * seen" and wrong for a call log: at day granularity nine consecutive
 * calls all read "3d ago", so the column that should order and correlate
 * them carries no information at all. Debugging needs to line a call up
 * against a submission and a teacher action, which needs a clock.
 *
 * Today collapses to the time alone; anything older keeps its date, and
 * a different year keeps that too.
 *
 * Rendered in the VIEWER'S timezone. Call sites pair it with the raw ISO
 * timestamp in `title`, which is UTC — across midnight the two disagree
 * by a day, so anything comparing against a server log should read the
 * hover, not the cell.
 */
export function fmtClockTime(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "—";
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const today = new Date();
  const sameDay =
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();
  if (sameDay) return time;
  // Carry the year once the row is from a different one — submissions
  // spanning school years were otherwise indistinguishable.
  const date = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
  return `${date} ${time}`;
}
