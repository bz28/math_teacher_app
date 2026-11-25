import { useState } from "react";
import { MathText } from "@/components/shared/math-text";
import type {
  TeacherSubmissionDetailProblem,
  TeacherSubmissionDrawing,
  TeacherSubmissionStep,
} from "@/lib/api";
import type { StepAnchor } from "../_lib/types";
import { recordedLabel } from "../_lib/grading";

export const ANCHOR_TONES = ["amber", "info"] as const;

export const ANCHOR_STYLE: Record<
  "amber" | "info",
  { wrap: string; badge: string; idRef: (id: string) => string }
> = {
  amber: {
    wrap: "border-[color:var(--color-warning)]/45 bg-[color:var(--color-warning-bg)]/60",
    // White on `--color-warning` is 4.43:1; the -dark token is 6.08:1.
    badge: "bg-[color:var(--color-warning-dark)] text-white",
    idRef: (id) => `${id}-amber`,
  },
  info: {
    wrap: "border-[color:var(--color-info)]/45 bg-[color:var(--color-info-light)]/60",
    badge: "bg-[color:var(--color-info)] text-white",
    idRef: (id) => `${id}-info`,
  },
};

export function StudentStepRow({
  step,
  index,
  anchor,
  anchorId,
}: {
  step: TeacherSubmissionStep;
  index: number;
  /** Set when a receipt deduction anchors to this step (1-based
   *  step_ref === index + 1). Tints the row + shows the badge. */
  anchor?: StepAnchor;
  /** DOM id for the receipt's "↳ step N" link to scroll to. */
  anchorId?: string;
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const originalLatex = step.original_latex ?? "";
  const originalPlain = step.original_plain_english ?? "";
  const hasOriginal =
    !!step.edited && (originalLatex.length > 0 || originalPlain.length > 0);
  const a = anchor ? ANCHOR_STYLE[anchor.tone] : null;
  return (
    <div
      id={anchorId}
      className={`flex gap-2 scroll-mt-4 ${
        a ? `-mx-1.5 rounded-[--radius-sm] border px-1.5 py-1 ${a.wrap}` : ""
      }`}
    >
      {a ? (
        <span
          aria-hidden
          className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] text-[11px] font-extrabold tabular-nums ${a.badge}`}
        >
          {index + 1}
        </span>
      ) : (
        <span
          aria-hidden
          className="shrink-0 pt-0.5 text-xs font-semibold text-text-muted tabular-nums"
        >
          {index + 1}.
        </span>
      )}
      <div className="min-w-0 flex-1">
        {step.latex ? (
          <MathText text={`$$${step.latex}$$`} />
        ) : (
          <span className="text-text-secondary">{step.plain_english}</span>
        )}
        {step.edited && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1 rounded-full bg-primary-bg px-1.5 py-0.5 font-semibold text-primary">
              <span aria-hidden>✎</span> edited by student
            </span>
            {hasOriginal && (
              <button
                type="button"
                onClick={() => setShowOriginal((v) => !v)}
                aria-expanded={showOriginal}
                className="text-text-muted underline-offset-2 hover:text-text-secondary hover:underline"
              >
                {showOriginal ? "Hide original" : "View what was originally read"}
              </button>
            )}
          </div>
        )}
        {step.edited && hasOriginal && showOriginal && (
          <div className="mt-1 rounded-[--radius-sm] border border-border-light bg-[color:var(--color-surface-alt-2)]/40 px-2 py-1.5 text-xs">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
              Originally read
            </div>
            <div className="mt-0.5 text-text-secondary">
              {originalLatex ? (
                <MathText text={`$$${originalLatex}$$`} />
              ) : (
                <span>{originalPlain}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// The body of a drawing the extractor reported but a zoomed second look
// couldn't find (often a bad location, sometimes nothing drawn). The
// explanation is visible text, not a hover title, so it reaches touch
// screens too; the first pass's description is framed as a claim, not
// fact, and omitted when there is none (rows repaired by cp1000085).
function UnconfirmedDrawingNote({ drawing }: { drawing: TeacherSubmissionDrawing }) {
  const description = drawing.description;
  const pointsDisagree = drawing.unconfirmed_reason === "labeled_points_disagree";
  return (
    <>
      <span className="block text-text-muted">
        {pointsDisagree ? (
          <>
            Up close, the labeled points read as{" "}
            {drawing.zoomed_labeled_points.join(", ") || "none"}, so the AI
            didn&rsquo;t count them for or against the student &mdash; check the
            photo and adjust if needed.
          </>
        ) : (
          <>
            A zoomed-in look couldn&rsquo;t find it, so the AI didn&rsquo;t count
            it for or against the student &mdash; check the photo and adjust if
            needed.
          </>
        )}
      </span>
      {description && (
        <span className="block italic text-text-muted">
          AI first reported: {description}
        </span>
      )}
    </>
  );
}

/**
 * A problem's drawings, gated by the question's "requires a drawing" flag.
 *
 * Flagged: the full inventory, with a quiet "Not required" to unflag.
 * Unflagged with something drawn: one muted line and "Require it" — the
 * drawing was recorded anyway, so a missed flag is one click (and a
 * regrade) away from being fixed. Never a ✓ or "couldn't confirm" there:
 * nothing was checked, and nothing is used.
 */
export function DrawingsPanel({
  problem,
  inventoried,
  onRequiresDrawingChange,
}: {
  problem: TeacherSubmissionDetailProblem;
  /** The submission's drawings were inventoried at all (older ones weren't). */
  inventoried: boolean;
  onRequiresDrawingChange: (next: boolean) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drawn = problem.drawings.filter((d) => d.present);
  if (!problem.requires_drawing && drawn.length === 0 && !changed) return null;

  const flip = async () => {
    setSaving(true);
    setError(null);
    try {
      await onRequiresDrawingChange(!problem.requires_drawing);
      setChanged(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn\u2019t save");
    } finally {
      setSaving(false);
    }
  };
  const flipButton = (label: string) => (
    <button
      type="button"
      onClick={() => void flip()}
      disabled={saving}
      className="font-semibold text-primary underline-offset-2 hover:underline disabled:opacity-50"
    >
      {saving ? "Saving\u2026" : label}
    </button>
  );
  const afterNote = (changed || error) && (
    <p className="mt-1.5 text-[11px] leading-snug text-text-muted" role="status">
      {error ?? "Saved for this question. It applies to grading from now on \u2014 regrade to apply it to this student."}
    </p>
  );

  if (!problem.requires_drawing) {
    return (
      <div className="mt-3 text-xs leading-relaxed text-text-muted">
        {drawn.length > 0 && (
          <span>
            <span aria-hidden>✏️ </span>
            {recordedLabel(drawn)} on page — not required for this question ·{" "}
          </span>
        )}
        {flipButton("Require it")}
        {afterNote}
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-[--radius-md] border border-border-light bg-surface px-3 py-2.5">
      <p className="flex flex-wrap items-baseline gap-x-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
        Drawings
        <span className="font-normal normal-case tracking-normal text-text-muted">
          · this question requires one ·
        </span>
        <span className="text-[11px] font-normal normal-case tracking-normal">
          {flipButton("Not required")}
        </span>
      </p>
      {problem.drawings.length === 0 && (
        <p className="mt-1.5 flex gap-2 text-xs font-semibold text-[color:var(--color-warning-dark)]">
          <span aria-hidden className="shrink-0">⚠️</span>
          {inventoried
            ? "No drawing recorded — this question requires one."
            : "Drawings weren’t read for this submission — check the photo."}
        </p>
      )}
      <ul className="mt-1.5 space-y-1.5 text-xs leading-relaxed">
        {problem.drawings.map((d, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden className="shrink-0">{d.present ? "✏️" : "⚠️"}</span>
            {d.present ? (
              <span className="text-text-primary">
                <span className="font-semibold capitalize">{d.kind.replace("_", " ")}</span>
                <span className="text-text-secondary">
                  <DrawingStatus drawing={d} />
                </span>
                {/* A drawing the zoomed look couldn't find keeps its first-read
                    inventory in the data, but it isn't shown as fact — only
                    as "AI first reported" in the note below. */}
                {!(d.unconfirmed && d.unconfirmed_reason !== "labeled_points_disagree") && (
                  <>
                    {d.labeled_points.length > 0 && (
                      <span className="text-text-secondary">
                        {" "}· labeled: <MathText text={d.labeled_points.join(", ")} />
                      </span>
                    )}
                    {d.answer_on_drawing && (
                      <span className="text-text-secondary">
                        {" "}· answer on drawing: <MathText text={d.answer_on_drawing} />
                      </span>
                    )}
                    {d.plotted_elements.length > 0 && (
                      <span className="block text-text-secondary">{d.plotted_elements.join("; ")}</span>
                    )}
                  </>
                )}
                {d.unconfirmed ? (
                  <UnconfirmedDrawingNote drawing={d} />
                ) : (
                  d.description && (
                    <span className="block text-text-secondary">{d.description}</span>
                  )
                )}
              </span>
            ) : (
              <span className="font-semibold text-[color:var(--color-warning-dark)]">
                No {d.kind.replace("_", " ")} drawn — the problem asked for one.
              </span>
            )}
          </li>
        ))}
      </ul>
      {afterNote}
    </div>
  );
}

/**
 * The status after a drawing's kind. A table is text in a grid — nothing
 * is "plotted" and the zoomed check can't read it — so it gets no status
 * at all rather than "0 plotted" or a doubt it never earned.
 */
function DrawingStatus({ drawing: d }: { drawing: TeacherSubmissionDrawing }) {
  if (d.unconfirmed) {
    return (
      <span className="text-[color:var(--color-warning-dark)]"> · couldn&rsquo;t confirm</span>
    );
  }
  if (d.kind === "table") return null;
  return (
    <>
      {" "}· {d.plotted_elements.length} plotted
      {d.verified && (
        <span title="A zoomed-in second look confirmed how many lines are drawn and the labeled points — not what each line is.">
          {" "}· count checked ✓
        </span>
      )}
    </>
  );
}

/**
 * Work the extractor couldn't tie to any problem on this assignment.
 *
 * This exists because the grader already sees it. `_build_user_message`
 * hands the model these exact lines under "Other work" and tells it to
 * use them as context, so without this block a teacher could read a
 * verdict shaped by evidence that wasn't on their screen. It is also how
 * a stale `problem_position` becomes visible instead of silent: after an
 * unpublish -> edit problems -> republish cycle shifts positions, real
 * work slides in here rather than vanishing.
 *
 * Collapsed by default: a clean submission has none of this, and the
 * ones that do shouldn't push the grade controls down the page.
 */
export function OtherWorkDisclosure({
  steps,
  drawings,
  anyRequired,
}: {
  steps: TeacherSubmissionStep[];
  drawings: TeacherSubmissionDrawing[];
  /** Some question on this homework requires a drawing. Only then is an
   *  unattributed drawing used (it may be that one) — otherwise it's
   *  shown as recorded, with no verdict on it. */
  anyRequired: boolean;
}) {
  const [open, setOpen] = useState(false);
  const count = steps.length + drawings.length;
  return (
    <div className="mt-3 rounded-[--radius-md] border border-dashed border-border bg-[color:var(--color-surface-alt-2)]/50 px-3 py-2.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span>
        Other work
        <span className="font-normal normal-case tracking-normal text-text-muted">
          · {count} {count === 1 ? "item" : "items"}
        </span>
      </button>
      {open && (
        <>
          <p className="mt-1.5 text-[11px] leading-relaxed text-text-muted">
            Couldn&rsquo;t be tied to one problem — scratch work, setup, or
            work that spans problems. The AI saw these as context when it
            graded; they don&rsquo;t carry a grade of their own.
          </p>
          <div className="mt-2 space-y-2 text-sm text-text-primary">
            {steps.map((step, i) => (
              <StudentStepRow key={i} step={step} index={i} />
            ))}
            {drawings.map((d, i) => (
              <p key={`d-${i}`} className="flex gap-2 text-xs leading-relaxed">
                <span aria-hidden className="shrink-0">✏️</span>
                <span className="text-text-secondary">
                  <span className="font-semibold capitalize text-text-primary">
                    {d.kind.replace("_", " ")}
                  </span>
                  {anyRequired ? (
                    <DrawingStatus drawing={d} />
                  ) : (
                    <span className="text-text-muted"> · not used for grading</span>
                  )}
                  {anyRequired && d.unconfirmed ? (
                    <UnconfirmedDrawingNote drawing={d} />
                  ) : (
                    d.description && <span className="block">{d.description}</span>
                  )}
                </span>
              </p>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
