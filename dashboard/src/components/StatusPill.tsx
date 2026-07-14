/**
 * StatusPill — the ONE status chip for the whole console. A tiny mono-
 * uppercase dot+label on a soft fill. Never hand-roll a status badge on
 * a page; pick a tone here so "active" reads the same everywhere.
 *
 *   ok      — moss   — OK / ACTIVE / HEALTHY
 *   warn    — amber  — STALE / WARN / DEGRADED
 *   danger  — red    — FAIL / AT-RISK / DOWN
 *   live    — sienna — LIVE (the single decisive accent; use sparingly)
 *   info    — blue   — informational
 *   neutral — muted  — DORMANT / INACTIVE / n-a
 */
export type PillTone = "ok" | "warn" | "danger" | "live" | "info" | "neutral";

interface Props {
  tone: PillTone;
  label: string;
  /** Sienna "live" tones get a soft pulse; opt out for static labels. */
  pulse?: boolean;
  title?: string;
}

export default function StatusPill({ tone, label, pulse, title }: Props) {
  return (
    <span className={`status-pill status-pill-${tone}`} title={title}>
      <span
        aria-hidden="true"
        className={`status-pill-dot${pulse && tone === "live" ? " status-pill-dot-pulse" : ""}`}
      />
      {label}
    </span>
  );
}
