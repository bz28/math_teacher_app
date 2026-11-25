import { MathText } from "@/components/shared/math-text";
import type { GradeDeduction } from "@/lib/api";
import { deductionPoints, earnedPoints, formatPoints } from "@/lib/points";
import type { GradeStatus } from "../_lib/types";
import { CONFIDENCE_LOW } from "../_lib/grading";
import { ANCHOR_TONES, ANCHOR_STYLE } from "./student-work";

// ────────────────────────────────────────────────────────────────────
// Itemized grade receipt — renders the AI's per-problem `deductions`
// ledger as a "why this score" breakdown in the problem's points: credit
// lines (things done right, ✓) and debit lines (−N points with the
// reason and where it came from — a class rule or the AI's judgment),
// summing to SCORE = worth − Σ points off. `points_off` is stored as a
// percent of the problem; lines are converted together (deductionPoints)
// so they always add up to the score shown. Each debit that anchors to a
// student-work step gets a color-matched [N] badge + "↳ step N" link
// that highlights + scrolls to that step in the work list above. Full
// credit (no debits) collapses to "✓ Full credit"; an itemized zero to
// "✗ No credit · <reason>".
// ────────────────────────────────────────────────────────────────────

export function GradeReceipt({
  deductions,
  status,
  percent,
  worth,
  aiConfidence,
  stepCount,
  onAnchorClick,
  ruleText,
}: {
  deductions: GradeDeduction[];
  status: GradeStatus;
  percent: number;
  /** What the problem is worth on this homework. */
  worth: number;
  aiConfidence: number | null;
  stepCount: number;
  onAnchorClick: (stepRef: number) => void;
  ruleText: Record<string, string>;
}) {
  const credits = deductions.filter((d) => d.points_off <= 0);
  const debits = deductions.filter((d) => d.points_off > 0);
  const score = Math.round(percent);
  const earned = earnedPoints(percent, worth);
  const debitPoints = deductionPoints(
    debits.map((d) => d.points_off),
    worth,
    worth - earned,
  );
  const scoreText = `${formatPoints(earned)}/${worth}`;
  const confPct = aiConfidence != null ? Math.round(aiConfidence * 100) : null;
  const confLow = aiConfidence != null && aiConfidence < CONFIDENCE_LOW;

  // Short-forms when there's nothing itemized to subtract.
  if (debits.length === 0) {
    if (status === "full") {
      return (
        <div className="mt-3 inline-flex items-center gap-2 rounded-[--radius-md] border border-[color:var(--color-success-border)] bg-[color:var(--color-success-light)]/60 px-3 py-2 text-xs font-bold text-[color:var(--color-success)]">
          <span aria-hidden>✓</span> Full credit
        </div>
      );
    }
    if (status === "zero") {
      const reason = deductions[0]?.reason ?? null;
      return (
        <div className="mt-3 inline-flex items-center gap-2 rounded-[--radius-md] border border-[color:var(--color-error-border)] bg-[color:var(--color-error-light)]/60 px-3 py-2 text-xs font-bold text-[color:var(--color-error)]">
          <span aria-hidden>✗</span> No credit
          {reason && (
            <span className="font-semibold">
              · <MathText text={reason} />
            </span>
          )}
        </div>
      );
    }
    // Partial with no itemized debits (shouldn't normally occur — the grader
    // synthesizes a reconciling entry) — show the score plainly rather than
    // an empty itemized box.
    return (
      <div className="mt-3 inline-flex items-center gap-2 rounded-[--radius-md] border border-[color:var(--color-warning-dark)]/30 bg-[color:var(--color-warning-bg)]/60 px-3 py-2 text-xs font-bold text-[color:var(--color-warning-dark)]">
        Partial · {scoreText} · {score}%
      </div>
    );
  }

  // Tone per anchored debit — cycles amber/info in document order, the
  // same basis ProblemGradeRow uses to tint the matching step, so the
  // badge colors line up across the receipt and the work list.
  let anchorN = 0;
  const scoreColor =
    status === "zero"
      ? "text-[color:var(--color-error)]"
      : status === "full"
        ? "text-[color:var(--color-success)]"
        : "text-[color:var(--color-warning-dark)]";

  return (
    <div className="mt-3 overflow-hidden rounded-[--radius-md] border border-border-light bg-[color:var(--color-surface-alt)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-dashed border-border px-3 py-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[color:var(--color-text-secondary)]">
          Why {scoreText} — itemized
        </span>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold">
          <span aria-hidden>🤖</span>
          <span className="text-text-muted">AI breakdown</span>
          {confPct != null && (
            <>
              <span
                aria-hidden
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  confLow
                    ? "bg-[color:var(--color-warning)]"
                    : "bg-[color:var(--color-success)]"
                }`}
              />
              <span
                className={
                  confLow
                    ? "text-[color:var(--color-warning-dark)]"
                    : "text-text-muted"
                }
              >
                {confPct}% confidence
              </span>
            </>
          )}
        </span>
      </div>
      <div className="py-1">
        {credits.map((d, i) => (
          <div
            key={`c${i}`}
            className="flex items-center gap-2.5 px-3 py-1.5 text-[12.5px]"
          >
            <span
              aria-hidden
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-[color:var(--color-success-border)] bg-[color:var(--color-success-light)] text-[11px] font-extrabold text-[color:var(--color-success)]"
            >
              ✓
            </span>
            <span className="min-w-0 flex-1 text-text-primary">
              <MathText text={d.reason} />
            </span>
            <span className="shrink-0 font-mono text-[12px] font-semibold text-[color:var(--color-success)]">
              full
            </span>
          </div>
        ))}
        {debits.map((d, i) => {
          // Belt-and-suspenders: the backend nulls out-of-range step_refs,
          // but guard here too so a stale/dead anchor never renders a "↳ step
          // N" link that scrolls to a step that doesn't exist. Source of
          // truth is the backend clamp.
          const anchored =
            d.step_ref != null && d.step_ref >= 1 && d.step_ref <= stepCount;
          const tone = anchored ? ANCHOR_TONES[anchorN++ % ANCHOR_TONES.length] : null;
          const a = tone ? ANCHOR_STYLE[tone] : null;
          return (
            <div
              key={`d${i}`}
              className={`flex items-center gap-2.5 px-3 py-1.5 text-[12.5px] ${
                a
                  ? `mx-1.5 my-px rounded-[--radius-sm] ${
                      tone === "amber"
                        ? "bg-[color:var(--color-warning-bg)]/50"
                        : "bg-[color:var(--color-info-light)]/50"
                    }`
                  : ""
              }`}
            >
              {a ? (
                <span
                  aria-hidden
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-[11px] font-extrabold ${a.badge}`}
                >
                  {d.step_ref}
                </span>
              ) : (
                <span
                  aria-hidden
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-[color:var(--color-error-border)] bg-[color:var(--color-error-light)] text-[11px] font-extrabold text-[color:var(--color-error)]"
                >
                  −
                </span>
              )}
              <span className="min-w-0 flex-1 text-text-primary">
                <MathText text={d.reason} />
                {anchored && (
                  <button
                    type="button"
                    onClick={() => onAnchorClick(d.step_ref as number)}
                    className={`ml-1.5 inline-flex items-center gap-0.5 align-baseline text-[11px] font-bold hover:underline ${
                      tone === "amber"
                        ? "text-[color:var(--color-warning-dark)]"
                        : "text-[color:var(--color-info)]"
                    }`}
                  >
                    ↳ step {d.step_ref} in work
                  </button>
                )}
                {d.rule_id && ruleText[d.rule_id] ? (
                  <span className="mt-1 flex">
                    <span className="rounded-full bg-[color:var(--color-primary-bg)] px-2 py-0.5 text-[11px] font-medium text-primary">
                      Class rule: {ruleText[d.rule_id]}
                    </span>
                  </span>
                ) : d.source === "class_rule" ? (
                  <span className="mt-1 flex">
                    <span className="rounded-full bg-[color:var(--color-primary-bg)] px-2 py-0.5 text-[11px] font-medium text-primary">
                      Class rule
                    </span>
                  </span>
                ) : d.source === "graph_checklist" ? (
                  <span className="mt-1 flex">
                    <span
                      className="rounded-full border border-border-light px-2 py-0.5 text-[11px] font-medium text-text-secondary"
                      title="Not on the drawing — this item's points from the graph checklist."
                    >
                      Graph checklist
                    </span>
                  </span>
                ) : (
                  d.source === "ai_judgment" && (
                    <span className="mt-1 flex">
                      <span
                        className="rounded-full border border-border-light px-2 py-0.5 text-[11px] font-medium text-text-secondary"
                        title="No rule covered this, so the AI sized it (to the nearest half point). Worth a check."
                      >
                        AI judgment
                      </span>
                    </span>
                  )
                )}
              </span>
              <span className="shrink-0 font-mono text-[12px] font-semibold text-[color:var(--color-error)]">
                −{formatPoints(debitPoints[i])}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between border-t border-dashed border-border bg-surface px-3 py-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]">
          Score
        </span>
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-[11px] text-text-muted">
            {worth}{debitPoints.map((p, i) => <span key={i}> − {formatPoints(p)}</span>)}
          </span>
          <span className={`font-mono text-lg font-bold ${scoreColor}`}>
            {scoreText}
          </span>
          <span className="font-mono text-[11px] text-text-muted">{score}%</span>
        </span>
      </div>
    </div>
  );
}
