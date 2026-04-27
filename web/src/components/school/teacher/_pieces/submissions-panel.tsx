"use client";

import { useEffect, useMemo, useState } from "react";
import {
  teacher,
  type IntegrityActivityReason,
  type IntegrityActivitySummary,
  type IntegrityDisposition,
  type IntegrityOverview,
  type IntegrityRubric,
  type TeacherIntegrityDetail,
  type TeacherIntegrityProblemRow,
  type TeacherIntegrityTranscriptTurn,
  type TeacherSubmissionDetail,
  type TeacherSubmissionRow,
} from "@/lib/api";
import { ExtractionView } from "@/components/school/shared/extraction-view";
import { cn } from "@/lib/utils";

// ── Disposition badge ──

const DISPOSITION_CONFIG: Record<
  IntegrityDisposition,
  { label: string; icon: string; cls: string }
> = {
  pass: {
    label: "Pass",
    icon: "✓",
    cls: "bg-green-100 text-green-700 dark:bg-green-500/20",
  },
  needs_practice: {
    label: "Needs practice",
    icon: "↻",
    cls: "bg-blue-100 text-blue-700 dark:bg-blue-500/20",
  },
  tutor_pivot: {
    label: "Tutored",
    icon: "?",
    cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/20",
  },
  flag_for_review: {
    label: "Review",
    icon: "⚑",
    cls: "bg-red-100 text-red-700 dark:bg-red-500/20",
  },
};

function DispositionPill({
  disposition,
  subtle,
}: {
  disposition: IntegrityDisposition;
  subtle?: boolean;
}) {
  const cfg = DISPOSITION_CONFIG[disposition];
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-bold",
        subtle ? "bg-gray-100 text-gray-500 dark:bg-gray-500/20" : cfg.cls,
      )}
    >
      {cfg.icon} {cfg.label}
    </span>
  );
}

function OverviewBadge({ overview }: { overview: IntegrityOverview | null }) {
  if (!overview) return null;
  // Unreadable / complete-but-no-disposition (turn-cap fallback) is a
  // teacher-review situation — surface it distinctly rather than as
  // an empty completed state.
  if (overview.overall_status === "complete" && !overview.disposition) {
    return (
      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-600 dark:bg-gray-500/20">
        Needs review
      </span>
    );
  }
  if (overview.overall_status !== "complete" || !overview.disposition) {
    const progress = `${overview.complete_count}/${overview.problem_count}`;
    return (
      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-500 dark:bg-gray-500/20">
        {overview.complete_count === 0 ? "Pending" : `In progress ${progress}`}
      </span>
    );
  }
  return <DispositionPill disposition={overview.disposition} />;
}

// ── Rubric display ──

const RUBRIC_DIM_LABELS: Record<keyof IntegrityRubric, string> = {
  paraphrase_originality: "Own words vs textbook",
  causal_fluency: "Why, not just what",
  transfer: "Flex to a twist",
  prediction: "Predict before computing",
  authority_resistance: "Push back on wrong premise",
  self_correction: "Catches own errors",
};

const RUBRIC_SCORE_STYLES: Record<string, string> = {
  low: "text-red-600 dark:text-red-400",
  mid: "text-amber-600 dark:text-amber-400",
  high: "text-green-600 dark:text-green-400",
  not_probed: "text-text-muted italic",
  not_observed: "text-text-muted italic",
};

function RubricDisplay({ rubric }: { rubric: IntegrityRubric }) {
  const rows: { key: keyof IntegrityRubric; score: string }[] = (
    Object.keys(RUBRIC_DIM_LABELS) as (keyof IntegrityRubric)[]
  ).map((key) => ({ key, score: rubric[key] }));
  return (
    <dl className="mt-1 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-xs">
      {rows.map(({ key, score }) => (
        <div key={key} className="contents">
          <dt className="text-text-muted">{RUBRIC_DIM_LABELS[key]}</dt>
          <dd
            className={cn(
              "font-medium",
              RUBRIC_SCORE_STYLES[score] ?? "text-text-muted",
            )}
          >
            {score.replace(/_/g, " ")}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ── Activity surface (level pill + session digest + per-turn markers) ──

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
// flag-for-review banner, neutral submission detail. Color thresholds
// match the activity_level rules: 0 = clean (muted gray), 1 = notable
// (amber), ≥2 = heavy (orange). Pill text drops the level abstraction
// and shows the count directly so teachers don't have to learn what
// "heavy" means.
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
      style: "bg-amber-600 text-white dark:bg-amber-500",
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

// Loud, filled disposition pill for the queue row. Only renders for
// states that demand teacher action — flag-for-review (red),
// tutor_pivot (amber), and inconclusive complete-with-no-disposition
// (gray). pass / needs_practice render nothing so quiet rows stay
// quiet. Color weights match ActivityPill so they sit visually as
// siblings on the row. Red is reserved for this disposition channel
// alone — Activity heavy stays orange so the eye doesn't conflate
// "behavior" with "AI verdict".
const ROW_DISPOSITION_COPY: Partial<
  Record<IntegrityDisposition, { text: string; style: string }>
> = {
  flag_for_review: {
    text: "Review needed",
    style: "bg-red-600 text-white dark:bg-red-500",
  },
  tutor_pivot: {
    text: "Tutored",
    style: "bg-amber-600 text-white dark:bg-amber-500",
  },
};

const ROW_INCONCLUSIVE_STYLE =
  "bg-gray-500 text-white dark:bg-gray-600";

/** Queue-row disposition pill. Shows only on actionable verdicts
 *  (flag / tutored / inconclusive). Pass / needs_practice / in-
 *  progress render null, keeping clean rows visually quiet. */
export function RowDispositionPill({
  overview,
  className,
}: {
  overview: IntegrityOverview | null;
  className?: string;
}) {
  if (!overview) return null;
  if (overview.overall_status !== "complete") return null;
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
 * already carries the verdict color; the digest is supporting
 * evidence and shouldn't shout. The Activity pill is the only colored
 * element here, which is what makes the level scannable.
 */
export function ActivityDigest({
  summary,
}: {
  summary: IntegrityActivitySummary | null;
}) {
  if (!summary) return null;

  const t = summary.totals;
  const notableCount = summary.notable_turns.length;

  // Subtitle below the header that translates the level into something
  // a teacher can act on without thinking about thresholds. Phrased as
  // "X moments" because the marker is per-turn but the unit a teacher
  // cares about is the event itself.
  const subtitle =
    notableCount === 0
      ? "Nothing notable observed."
      : notableCount === 1
        ? "1 notable moment in this conversation."
        : `${notableCount} notable moments in this conversation.`;

  // The digest stays neutral regardless of disposition. The banner
  // above already carries the verdict color (red/amber/green); making
  // the digest match would stack two big colored panels and wash out
  // both. Neutral here = "supporting evidence", not a second alarm.
  // The Activity pill is the only color in this panel — that's what
  // makes the level scannable.
  return (
    <div className="rounded-[--radius-md] border border-border-light bg-surface px-3.5 py-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-text-primary">
            Activity during this conversation
          </p>
          <p className="mt-0.5 text-[11px] text-text-secondary">
            {subtitle}
          </p>
        </div>
        <ActivityPill
          count={summary.notable_turns.length}
          alwaysShow
          className="shrink-0"
        />
      </div>
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
        Reflects behavior during this conversation only — not the
        original homework session.
      </p>
    </div>
  );
}

// ── Integrity detail section (expandable inside submission detail) ──

function IntegritySection({ submissionId }: { submissionId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<TeacherIntegrityDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const [dismissConfirm, setDismissConfirm] = useState<string | null>(null);

  // Index notable turns by ordinal so the transcript can render an
  // inline marker on the matching student bubble in O(1) per turn.
  const notableByOrdinal = useMemo(() => {
    const out = new Map<number, IntegrityActivityNotableTurnLite>();
    for (const nt of data?.activity_summary?.notable_turns ?? []) {
      out.set(nt.ordinal, nt);
    }
    return out;
  }, [data?.activity_summary?.notable_turns]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const d = await teacher.integrityDetail(submissionId);
      setData(d);
    } catch {
      setError("Couldn't load integrity details.");
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    // Always refetch on open so teachers don't see stale data after
    // the student keeps chatting or another teacher dismisses a
    // problem. The existing `loading` guard prevents parallel fetches
    // if they spam the toggle.
    if (next && !loading) load();
  }

  async function dismiss(problemId: string) {
    setDismissingId(problemId);
    try {
      await teacher.dismissIntegrityProblem(submissionId, problemId, dismissReason);
      await load();
      setDismissConfirm(null);
      setDismissReason("");
    } catch {
      setError("Couldn't dismiss. Try again.");
    } finally {
      setDismissingId(null);
    }
  }

  return (
    <div className="space-y-3">
      <button
        onClick={toggle}
        className="flex w-full items-center gap-2 text-sm font-semibold text-text-primary hover:text-primary"
      >
        <span className="text-xs">{open ? "▼" : "▶"}</span>
        Understanding Check
        {data && data.disposition && (
          <OverallHeaderBadge disposition={data.disposition} />
        )}
        {data &&
          !data.disposition &&
          data.overall_status === "complete" && (
            <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-600 dark:bg-gray-500/20">
              Needs review
            </span>
          )}
        {/* Activity pill sits next to whichever right-aligned status
           * badge is showing (disposition or "Needs review"). Both
           * carry ml-auto, so this pill chains rightward without
           * needing its own. activity_summary is only populated when
           * status=complete, which is the same gate as those badges. */}
        {data?.activity_summary && (
          <ActivityPill count={data.activity_summary.notable_turns.length} />
        )}
      </button>

      {open && loading && <p className="text-xs text-text-muted">Loading…</p>}
      {open && error && <p className="text-xs text-error">{error}</p>}

      {open && data && (
        <>
          {data.overall_status === "no_check" && (
            <p className="text-xs text-text-muted">
              No integrity check for this submission.
            </p>
          )}

          {data.problems.length === 0 && data.overall_status !== "no_check" && (
            <p className="text-xs text-text-muted">
              {data.overall_status === "extracting"
                ? "Preparing the check…"
                : "Waiting for student to complete the check."}
            </p>
          )}

          {data.overall_summary && (
            <p className="text-sm italic text-text-secondary">
              {data.overall_summary}
            </p>
          )}

          {data.inline_variant_used && data.inline_variant_result && (
            <p className="text-xs text-text-muted">
              Variant probe:{" "}
              <span className="font-medium text-text-secondary">
                {data.inline_variant_result.replace(/_/g, " ")}
              </span>
            </p>
          )}

          <ActivityDigest summary={data.activity_summary} />

          {data.problems.map((p) => (
            <ProblemCard
              key={p.problem_id}
              problem={p}
              dismissConfirm={dismissConfirm}
              dismissReason={dismissReason}
              dismissingId={dismissingId}
              onStartDismiss={(id) => {
                setDismissConfirm(id);
                setDismissReason("");
              }}
              onCancelDismiss={() => setDismissConfirm(null)}
              onDismiss={dismiss}
              onDismissReasonChange={setDismissReason}
            />
          ))}

          {data.transcript.length > 0 && (
            <div>
              <button
                onClick={() => setTranscriptOpen((v) => !v)}
                className="flex w-full items-center gap-2 text-xs font-semibold text-text-secondary hover:text-primary"
              >
                <span>{transcriptOpen ? "▼" : "▶"}</span>
                Full conversation ({data.transcript.length} turns)
              </button>
              {transcriptOpen && (
                <TranscriptView
                  transcript={data.transcript}
                  notableByOrdinal={notableByOrdinal}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function OverallHeaderBadge({
  disposition,
}: {
  disposition: IntegrityDisposition;
}) {
  const cfg = DISPOSITION_CONFIG[disposition];
  return (
    <span
      className={cn(
        "ml-auto rounded-full px-2 py-0.5 text-xs font-bold",
        cfg.cls,
      )}
    >
      {cfg.icon} {cfg.label}
    </span>
  );
}

function ProblemCard({
  problem: p,
  dismissConfirm,
  dismissReason,
  dismissingId,
  onStartDismiss,
  onCancelDismiss,
  onDismiss,
  onDismissReasonChange,
}: {
  problem: TeacherIntegrityProblemRow;
  dismissConfirm: string | null;
  dismissReason: string;
  dismissingId: string | null;
  onStartDismiss: (id: string) => void;
  onCancelDismiss: () => void;
  onDismiss: (id: string) => void;
  onDismissReasonChange: (v: string) => void;
}) {
  const isDismissed = p.teacher_dismissed;
  const [sawOpen, setSawOpen] = useState(false);
  const [rubricOpen, setRubricOpen] = useState(false);

  return (
    <div
      className={cn(
        "space-y-2 rounded-[--radius-sm] border p-3",
        isDismissed ? "border-border-light bg-background opacity-60" : "border-border bg-surface",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-text-secondary">
          Problem {p.sample_position + 1}
        </span>
        <div className="flex items-center gap-2">
          {isDismissed && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-500 dark:bg-gray-500/20">
              Dismissed
            </span>
          )}
          {p.status === "skipped_unreadable" && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-600 dark:bg-gray-500/20">
              Unreadable
            </span>
          )}
        </div>
      </div>

      {p.ai_reasoning && !isDismissed && (
        <p className="text-xs italic text-text-muted">{p.ai_reasoning}</p>
      )}

      {isDismissed && p.teacher_dismissal_reason && (
        <p className="text-xs text-text-muted">
          Reason: {p.teacher_dismissal_reason}
        </p>
      )}

      {/* Rubric — collapsible, collapsed by default */}
      {p.rubric && !isDismissed && (
        <div>
          <button
            onClick={() => setRubricOpen((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-text-muted hover:text-primary"
          >
            <span className="text-[10px]">{rubricOpen ? "▼" : "▶"}</span>
            Rubric
          </button>
          {rubricOpen && <RubricDisplay rubric={p.rubric} />}
        </div>
      )}

      {/* What the agent saw — collapsible, collapsed by default */}
      {p.student_work_extraction && !isDismissed && (
        <div>
          <button
            onClick={() => setSawOpen((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-text-muted hover:text-primary"
          >
            <span className="text-[10px]">{sawOpen ? "▼" : "▶"}</span>
            What the agent saw
          </button>
          {sawOpen && <ExtractionView extraction={p.student_work_extraction} />}
        </div>
      )}

      {!isDismissed && (
        <>
          {dismissConfirm === p.problem_id ? (
            <div className="space-y-1.5">
              <textarea
                value={dismissReason}
                onChange={(e) => onDismissReasonChange(e.target.value)}
                placeholder="Reason (optional)"
                rows={2}
                className="w-full rounded-[--radius-sm] border border-border bg-background px-2 py-1 text-xs text-text-primary placeholder:text-text-muted"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => onDismiss(p.problem_id)}
                  disabled={dismissingId === p.problem_id}
                  className="rounded-[--radius-sm] bg-red-500 px-2 py-1 text-xs font-bold text-white hover:bg-red-600 disabled:opacity-50"
                >
                  {dismissingId === p.problem_id ? "Dismissing…" : "Confirm dismiss"}
                </button>
                <button
                  onClick={onCancelDismiss}
                  className="rounded-[--radius-sm] border border-border px-2 py-1 text-xs font-medium text-text-secondary hover:text-primary"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => onStartDismiss(p.problem_id)}
              className="text-xs font-medium text-text-muted hover:text-red-500"
            >
              Dismiss this check
            </button>
          )}
        </>
      )}
    </div>
  );
}

function TranscriptView({
  transcript,
  notableByOrdinal,
}: {
  transcript: TeacherIntegrityTranscriptTurn[];
  notableByOrdinal: Map<number, IntegrityActivityNotableTurnLite>;
}) {
  return (
    <div className="mt-2 space-y-2 rounded-[--radius-sm] border border-border-light bg-background p-3">
      {transcript.map((t) => (
        <TranscriptTurn
          key={`${t.ordinal}-${t.role}`}
          turn={t}
          notable={notableByOrdinal.get(t.ordinal)}
        />
      ))}
    </div>
  );
}

function TranscriptTurn({
  turn,
  notable,
}: {
  turn: TeacherIntegrityTranscriptTurn;
  notable: IntegrityActivityNotableTurnLite | undefined;
}) {
  const ts = new Date(turn.created_at);
  const stamp = ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (turn.role === "tool_call") {
    return (
      <div className="text-[11px] text-text-muted">
        <span className="font-semibold">Agent tool:</span>{" "}
        <span className="font-mono">{turn.tool_name ?? "(tool)"}</span>
        <span className="ml-2 font-mono text-text-muted">{turn.content}</span>
      </div>
    );
  }
  if (turn.role === "tool_result") {
    return (
      <div className="text-[11px] italic text-text-muted">
        <span className="font-semibold">Tool result:</span> {turn.content}
      </div>
    );
  }

  const isStudent = turn.role === "student";
  return (
    <div className={cn("flex flex-col gap-0.5", isStudent ? "items-end" : "items-start")}>
      <div className={cn("flex gap-2", isStudent ? "justify-end" : "justify-start")}>
        <div
          className={cn(
            "max-w-[85%] rounded-[--radius-sm] px-2 py-1 text-xs",
            isStudent
              ? "bg-primary/10 text-text-primary"
              : "bg-surface text-text-primary",
          )}
        >
          <div className="font-semibold">
            {isStudent ? "Student" : "Agent"}
            <span className="ml-2 font-normal text-text-muted">{stamp}</span>
            {turn.seconds_on_turn != null && isStudent && (
              <span className="ml-2 font-normal text-text-muted">
                · {turn.seconds_on_turn}s
              </span>
            )}
          </div>
          <div className="mt-0.5 whitespace-pre-wrap">{turn.content}</div>
        </div>
      </div>
      {isStudent && <ActivityTurnMarker turn={turn} notable={notable} />}
    </div>
  );
}

// ── Main panel ──

interface Props {
  assignmentId: string;
  onClose: () => void;
}

/**
 * Modal that lists all submissions for a homework, with a click-to-
 * expand per-submission detail subview. Wired up from the
 * `⚙ Submissions` button in homework-detail-modal.tsx.
 */
export function SubmissionsPanel({ assignmentId, onClose }: Props) {
  const [rows, setRows] = useState<TeacherSubmissionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TeacherSubmissionDetail | null>(null);
  const detailLoading = openId !== null && detail === null && error === null;

  useEffect(() => {
    teacher
      .submissions(assignmentId)
      .then((d) => setRows(d.submissions))
      .catch(() => setError("Couldn't load submissions."));
  }, [assignmentId]);

  useEffect(() => {
    if (!openId) return;
    let cancelled = false;
    teacher
      .submissionDetail(openId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load submission detail.");
      });
    return () => {
      cancelled = true;
    };
  }, [openId]);

  function closeDetail() {
    setOpenId(null);
    setDetail(null);
    setError(null);
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-[--radius-lg] bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-light px-6 py-4">
          <h2 className="text-lg font-bold text-text-primary">
            {openId && detail
              ? `${detail.student_name} — ${detail.assignment_title}`
              : "Submissions"}
          </h2>
          <button
            onClick={openId ? closeDetail : onClose}
            className="rounded-[--radius-sm] border border-border-light px-3 py-1 text-xs font-bold text-text-secondary hover:bg-bg-subtle"
          >
            {openId ? "← Back to list" : "Close"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && <p className="text-sm text-error">{error}</p>}

          {!openId && rows === null && !error && (
            <p className="text-sm text-text-muted">Loading…</p>
          )}

          {!openId && rows && rows.length === 0 && (
            <p className="text-sm text-text-muted">No submissions yet.</p>
          )}

          {!openId && rows && rows.length > 0 && (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li
                  key={r.id}
                  onClick={() => setOpenId(r.id)}
                  className="flex cursor-pointer items-center justify-between rounded-[--radius-sm] border border-border bg-surface p-4 hover:border-primary"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-semibold text-text-primary">
                        {r.student_name || r.student_email}
                      </div>
                      {r.is_preview && (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700 dark:bg-blue-500/20">
                          Preview
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-text-muted">{r.student_email}</div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    {r.is_late && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-700 dark:bg-amber-500/20">
                        LATE
                      </span>
                    )}
                    <OverviewBadge overview={r.integrity_overview} />
                    {r.submitted_at && (
                      <span>{new Date(r.submitted_at).toLocaleDateString()}</span>
                    )}
                    <span>→</span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {openId && detailLoading && (
            <p className="text-sm text-text-muted">Loading…</p>
          )}

          {openId && detail && (
            <div className="space-y-6">
              <div className="text-xs text-text-muted">
                Submitted {new Date(detail.submitted_at).toLocaleString()}
                {detail.is_late && (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-700 dark:bg-amber-500/20">
                    LATE
                  </span>
                )}
              </div>

              <div>
                <div className="text-sm font-semibold text-text-primary">
                  Submitted work
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={detail.image_data ?? ""}
                  alt={`${detail.student_name}'s submitted homework`}
                  className="mt-2 max-h-[600px] w-full rounded-[--radius-sm] border border-border object-contain"
                />
              </div>

              <IntegritySection submissionId={openId} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
