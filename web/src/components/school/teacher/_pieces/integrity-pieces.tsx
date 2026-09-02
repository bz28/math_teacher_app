"use client";

import { useState } from "react";
import {
  teacher,
  type IntegrityActivityReason,
  type IntegrityActivitySummary,
  type IntegrityDisposition,
  type IntegrityOverview,
  type IntegrityResolution,
  type IntegrityResolutionOutcome,
  type TeacherIntegrityDetail,
  type TeacherIntegrityTranscriptTurn,
} from "@/lib/api";
import { cn } from "@/lib/utils";

// ── Disposition badge ──

/** Format milliseconds as "Xm Ys" or "Ys" for short intervals. */
function formatMs(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

// Filled-style pills (solid bg + white text) so the count is legible
// regardless of where the pill sits — queue row hover bg, amber
// flag-for-review banner, neutral submission detail. Color thresholds:
// 0 = clean (muted gray), 1 = notable (yellow), ≥2 = heavy (orange).
// Yellow→orange keeps Activity in its own channel; amber/red are
// reserved for the disposition pill so the two surfaces don't
// collide visually.
function activityPillCopy(count: number): { text: string; style: string } {
  if (count <= 0) {
    return {
      text: "Activity: clean",
      style: "bg-gray-500 text-white dark:bg-gray-600",
    };
  }
  if (count === 1) {
    return {
      text: "Activity: 1 notable moment",
      style: "bg-yellow-500 text-white dark:bg-yellow-400 dark:text-gray-900",
    };
  }
  return {
    text: `Activity: ${count} notable moments`,
    style: "bg-orange-600 text-white dark:bg-orange-500",
  };
}

/** Compact pill for the queue row + the IntegritySection header +
 *  the digest. Renders nothing on null (older sessions, no
 *  telemetry, in-progress check) or on count=0 — clean rows stay
 *  quiet so loud rows actually stand out. Shows the count directly
 *  so a teacher doesn't have to interpret a severity word. */
export function ActivityPill({
  count,
  className,
  alwaysShow,
}: {
  count: number | null;
  className?: string;
  /** Force-render even on count=0. Used inside the digest panel
   *  where "Activity: clean" is the whole reason the panel exists;
   *  on the queue row we hide it instead. */
  alwaysShow?: boolean;
}) {
  if (count == null) return null;
  if (count === 0 && !alwaysShow) return null;
  const { text, style } = activityPillCopy(count);
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-bold",
        style,
        className,
      )}
    >
      {text}
    </span>
  );
}

// Loud, filled disposition pill for the queue row. Renders for the
// notable verdicts — flag-for-review (red, the only one that needs
// teacher action), tutor_pivot (amber, informational: the student was
// tutored through it), and inconclusive complete-with-no-disposition
// (gray). pass / needs_practice render nothing so quiet rows stay
// quiet. Color weights match ActivityPill so they sit visually as
// siblings on the row. Red is reserved for this disposition channel
// alone — Activity heavy stays orange so the eye doesn't conflate
// "behavior" with "AI verdict".
const ROW_DISPOSITION_COPY: Partial<
  Record<IntegrityDisposition, { text: string; style: string }>
> = {
  flag_for_review: {
    text: "Review",
    style: "bg-red-600 text-white dark:bg-red-500",
  },
  tutor_pivot: {
    text: "Tutored",
    style: "bg-[color:var(--color-warning-dark)] text-white dark:bg-[color:var(--color-warning-bg)]",
  },
};

const ROW_INCONCLUSIVE_STYLE =
  "bg-gray-500 text-white dark:bg-gray-600";

// De-emphasized pill for a check a teacher has already resolved. A
// handled flag should read as quiet history, not an open alarm — so we
// drop the loud filled fill for a muted outline and surface the
// outcome the teacher chose, so the row still says *what* was decided
// (cleared / concern / contacted) without shouting. "unresolved" never
// reaches the resolved branch.
const ROW_RESOLVED_COPY: Record<IntegrityResolutionOutcome, string> = {
  cleared: "Cleared",
  confirmed_concern: "Concern noted",
  contacted: "Contacted",
};

const ROW_RESOLVED_STYLE =
  "border border-border-light bg-transparent font-semibold text-text-muted";

/** Queue-row disposition pill. Shows only on actionable verdicts
 *  (flag / tutored / inconclusive). Pass / needs_practice / in-
 *  progress render null, keeping clean rows visually quiet. Once a
 *  teacher resolves the check, the loud verdict pill collapses to a
 *  muted "reviewed" outline carrying the chosen outcome — handled
 *  history, no longer an alarm. */
export function RowDispositionPill({
  overview,
  className,
}: {
  overview: IntegrityOverview | null;
  className?: string;
}) {
  if (!overview) return null;
  if (overview.overall_status !== "complete") return null;
  // Resolved → quiet outline pill with the outcome, regardless of the
  // underlying AI disposition. Mirrors the IntegrityBanner dropping to
  // NEUTRAL_STYLE and the roster flagged filter dropping the row.
  if (overview.resolution !== "unresolved") {
    return (
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-[11px]",
          ROW_RESOLVED_STYLE,
          className,
        )}
        title="Integrity check reviewed by a teacher"
      >
        ✓ {ROW_RESOLVED_COPY[overview.resolution]}
      </span>
    );
  }
  if (!overview.disposition) {
    return (
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-[11px] font-bold",
          ROW_INCONCLUSIVE_STYLE,
          className,
        )}
        title="Integrity check inconclusive — review"
      >
        Inconclusive
      </span>
    );
  }
  const cfg = ROW_DISPOSITION_COPY[overview.disposition];
  if (!cfg) return null;
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-bold",
        cfg.style,
        className,
      )}
    >
      {cfg.text}
    </span>
  );
}

const ACTIVITY_REASON_COPY: Record<
  IntegrityActivityReason,
  (turn: TeacherIntegrityTranscriptTurn) => string
> = {
  large_paste: (turn) => {
    const largest = Math.max(
      0,
      ...((turn.telemetry?.paste_events ?? []).map((p) => p.byte_count)),
    );
    return `pasted ${largest} chars before sending`;
  },
  full_paste: (turn) => {
    const total = (turn.telemetry?.paste_events ?? []).reduce(
      (s, p) => s + p.byte_count,
      0,
    );
    return `pasted ${total} chars; no typing on this turn`;
  },
  long_tab_out: (turn) => {
    const longest = Math.max(
      0,
      ...((turn.telemetry?.focus_blur_events ?? []).map((b) => b.duration_ms)),
    );
    return `tabbed out ${formatMs(longest)} during this turn`;
  },
  dominant_tab_out: (turn) => {
    const total = (turn.telemetry?.focus_blur_events ?? []).reduce(
      (s, b) => s + b.duration_ms,
      0,
    );
    return `tabbed out ${formatMs(total)} of this turn`;
  },
};

/** Lite shape: just the per-turn entry from activity_summary.notable_turns. */
export type IntegrityActivityNotableTurnLite = {
  ordinal: number;
  reasons: IntegrityActivityReason[];
};

/** Renders the gray inline note tucked under a notable student turn.
 *  Returns null if the turn has no notable reasons in this summary,
 *  or if the turn carries no telemetry — defensive bail-out so a
 *  drift between backend (which flagged the ordinal) and the
 *  per-turn telemetry blob doesn't render misleading "0 chars"
 *  / "0s" copy. Backend is currently lockstep, but this guards
 *  against future divergence. */
export function ActivityTurnMarker({
  turn,
  notable,
}: {
  turn: TeacherIntegrityTranscriptTurn;
  notable: IntegrityActivityNotableTurnLite | undefined;
}) {
  if (!notable || notable.reasons.length === 0) return null;
  if (!turn.telemetry) return null;
  return (
    <div className="mt-0.5 flex flex-wrap gap-1.5 text-[10px] text-text-muted">
      {notable.reasons.map((r) => (
        <span
          key={r}
          className="rounded-full bg-bg-subtle px-1.5 py-0.5 italic"
        >
          ↳ {ACTIVITY_REASON_COPY[r](turn)}
        </span>
      ))}
    </div>
  );
}

/**
 * Session-level digest at the top of the integrity section. Reads the
 * precomputed activity_summary off the detail payload — single source
 * of truth, same data that drives the queue pill and per-turn markers.
 *
 * Visual treatment: always neutral. The disposition banner above
 * already carries the verdict color and the at-a-glance Activity pill;
 * the digest is supporting evidence and shouldn't shout.
 */
export function ActivityDigest({
  summary,
}: {
  summary: IntegrityActivitySummary | null;
}) {
  if (!summary) return null;

  const t = summary.totals;

  // Digest is the detail view — title + per-event body lines tell the
  // teacher exactly what happened. The chip on the parent header card
  // already carries the at-a-glance "notable moments" signal, so we
  // don't restate count or chip here (would be 3× redundant).
  return (
    <div className="rounded-[--radius-md] border border-border-light bg-surface px-3.5 py-3 text-xs">
      <p className="text-[11px] font-bold uppercase tracking-wide text-text-primary">
        Activity during the integrity check
      </p>
      <div className="mt-2.5 border-t border-border-light pt-2" />
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-text-primary">
        <dt className="text-text-muted">Tabbed out</dt>
        <dd className="font-semibold">
          {t.tab_out_count === 0
            ? "never"
            : `${t.tab_out_count}× (${formatMs(t.tab_out_total_ms)} total)`}
        </dd>

        <dt className="text-text-muted">Paste events</dt>
        <dd className="font-semibold">
          {t.paste_count === 0
            ? "none"
            : `${t.paste_count} (largest ${t.paste_largest_chars} chars, ${t.paste_total_chars} total)`}
        </dd>
      </dl>
      <p className="mt-2.5 text-[10px] text-text-muted">
        Reflects behavior during the integrity check only — not the
        original homework session.
      </p>
    </div>
  );
}

const RESOLUTION_OUTCOMES: {
  value: IntegrityResolutionOutcome;
  label: string;
  icon: string;
}[] = [
  { value: "cleared", label: "Cleared — no concern", icon: "✓" },
  { value: "confirmed_concern", label: "Confirmed concern", icon: "⚑" },
  { value: "contacted", label: "Contacted student", icon: "✉" },
];

const RESOLUTION_LABEL: Record<IntegrityResolutionOutcome, string> = {
  cleared: "Cleared",
  confirmed_concern: "Confirmed concern",
  contacted: "Contacted student",
};

/** True for a terminal check the roster surfaces as needing the
 *  teacher's eyes — the states the "Mark reviewed" action can clear.
 *  Mirrors the review-page `isFlagged` + the backend flagged aggregate
 *  (flag_for_review / unreadable / inconclusive). `tutor_pivot` is NOT
 *  here: it's a learning outcome (student got it wrong on paper, AI
 *  tutored them — "a learning signal, not a cheating signal"), surfaced
 *  as an informational pill, and the backend aggregate excludes it too. */
export function integrityNeedsResolution(d: TeacherIntegrityDetail): boolean {
  if (d.overall_status === "skipped_unreadable") return true;
  if (d.overall_status === "complete" && !d.disposition) return true;
  return d.disposition === "flag_for_review";
}

function formatResolvedAt(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function ResolveIntegrityControl({
  submissionId,
  resolution,
  resolvedByName,
  resolvedAt,
  onResolved,
}: {
  submissionId: string;
  resolution: IntegrityResolution;
  resolvedByName: string | null;
  resolvedAt: string | null;
  onResolved: (resolution: IntegrityResolutionOutcome) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [submitting, setSubmitting] =
    useState<IntegrityResolutionOutcome | null>(null);
  const [error, setError] = useState(false);

  async function resolve(outcome: IntegrityResolutionOutcome) {
    setSubmitting(outcome);
    setError(false);
    try {
      await teacher.resolveIntegrity(submissionId, outcome);
      setPicking(false);
      onResolved(outcome);
    } catch {
      setError(true);
    } finally {
      setSubmitting(null);
    }
  }

  // Resolved state — a quiet chip, deliberately de-emphasized so a
  // handled check no longer reads as a loud alarm. "Change" reopens the
  // picker (re-resolving just overwrites the outcome).
  if (resolution !== "unresolved" && !picking) {
    const label = RESOLUTION_LABEL[resolution];
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-text-muted">
        <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-border-light)] px-2 py-[3px] font-semibold text-text-secondary">
          ✓ Reviewed{resolvedByName ? ` by ${resolvedByName}` : ""} · {label}
        </span>
        {resolvedAt && <span>{formatResolvedAt(resolvedAt)}</span>}
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="font-medium text-text-secondary underline-offset-2 hover:text-primary hover:underline"
        >
          Change
        </button>
      </div>
    );
  }

  // Collapsed "Mark reviewed" button — expands to the outcome picker.
  if (!picking) {
    return (
      <button
        type="button"
        onClick={() => setPicking(true)}
        className="rounded-[--radius-md] border border-border-light bg-surface px-3 py-1.5 text-xs font-semibold text-text-secondary hover:border-primary/40 hover:text-primary focus:border-primary focus:outline-none"
      >
        Mark reviewed
      </button>
    );
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
        Mark reviewed as
      </p>
      <div className="flex flex-wrap gap-1.5">
        {RESOLUTION_OUTCOMES.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={submitting !== null}
            onClick={() => void resolve(o.value)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
              resolution === o.value
                ? "border-primary/50 bg-primary-bg text-primary"
                : "border-border-light bg-surface text-text-secondary hover:border-primary/40 hover:text-primary",
              submitting !== null && "opacity-60",
            )}
          >
            <span aria-hidden>{o.icon}</span>
            {submitting === o.value ? "Saving…" : o.label}
          </button>
        ))}
        <button
          type="button"
          disabled={submitting !== null}
          onClick={() => {
            setPicking(false);
            setError(false);
          }}
          className="rounded-full px-2 py-1 text-xs font-medium text-text-muted hover:text-text-secondary"
        >
          Cancel
        </button>
      </div>
      {error && (
        <p className="text-[11px] text-error">Couldn&apos;t save. Try again.</p>
      )}
    </div>
  );
}

// ── Per-wrong-problem diagnosis section ──
// One card per wrong problem the live chat did NOT probe. The card
// renders the silent AI-generated misconception note alongside a
// collapsible view of the student's written work. Chat-probed rows
// already get the richer rubric + ai_reasoning treatment up in
// ProblemCard, so they're skipped here.
