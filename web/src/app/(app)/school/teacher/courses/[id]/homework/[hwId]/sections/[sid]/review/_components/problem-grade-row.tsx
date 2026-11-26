import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ReportProblemTrigger,
  type ReportProblemContext,
} from "@/components/school/teacher/report-problem";
import { MathText, mathPlainText } from "@/components/shared/math-text";
import type { AiGradeEntry, GradeBreakdownEntry, TeacherSubmissionDetailProblem } from "@/lib/api";
import { GraphCheckReview } from "@/components/school/teacher/_pieces/graph-check-review";
import { earnedPoints, formatPoints } from "@/lib/points";
import type { GradeStatus, StepAnchor } from "../_lib/types";
import { unitsNotInWorkNote, pageLabelFor } from "../_lib/grading";
import { ConfidenceSignal } from "./confidence-signal";
import { GradeReceipt } from "./grade-receipt";
import { ANCHOR_TONES, StudentStepRow, DrawingsPanel } from "./student-work";

// ────────────────────────────────────────────────────────────────────
// Per-problem grading row: answer compare + Full/Partial/Zero picker.
// Partial opens an inline number input; Enter or blur commits with
// the typed value. Full/Zero clicks commit immediately.
// ────────────────────────────────────────────────────────────────────

// The collapsed row's two answer cells wrap anywhere and clip sideways:
// `clip` (not `hidden`) leaves KaTeX's vertical overhang visible; `hidden`
// is the fallback where clip is unsupported (Safari < 16), since an
// unbreakable student answer painting over the key is the worse failure.
const ANSWER_CELL_CLIP =
  "[overflow-wrap:anywhere] [overflow-x:hidden] supports-[overflow:clip]:[overflow-x:clip]";

export function ProblemGradeRow({
  problem,
  entry,
  aiGrade,
  focused,
  collapsed,
  collapsible,
  confirmed,
  confirmKey,
  onConfirm,
  onToggleExpand,
  onRequiresDrawingChange,
  drawingsInventoried,
  rowRef,
  onChange,
  onFeedbackChange,
  onGraphVerdict,
  graphBusyItems,
  onOpenPage,
  reportBase,
  ruleText,
}: {
  problem: TeacherSubmissionDetailProblem;
  entry: GradeBreakdownEntry | null;
  aiGrade: AiGradeEntry | null;
  reportBase: ReportProblemContext;
  /** Class rule id → its wording, from the grade's rubric snapshot, so a
   *  deduction that applied a rule can name it. */
  ruleText: Record<string, string>;
  /** This row is the keyboard-focused problem — draws the left accent
   *  bar + ring and receives real DOM focus via `rowRef`. */
  focused: boolean;
  /** The AI was confident — render the one-line confirm summary instead
   *  of the full grading body. The teacher can expand to inspect. */
  collapsed: boolean;
  /** This row HAS a collapsed form, i.e. it's a confident row the
   *  teacher hasn't overridden. Expanded-and-collapsible is the only
   *  state where offering "collapse" means anything; an uncertain row
   *  has nothing to collapse to. */
  collapsible: boolean;
  /** The teacher has confirmed the AI's grade on this row (local
   *  checklist — the server trust signal is the submission's
   *  reviewed_at, stamped by onConfirm). */
  confirmed: boolean;
  /** The grading key that re-affirms the AI suggestion (shown on the
   *  Confirm chip). Null when there's no AI grade. */
  confirmKey: "1" | "2" | "3" | "4" | "5" | null;
  onConfirm: () => void;
  onToggleExpand: () => void;
  /** Flip the question's "requires a drawing" flag (bank item). */
  onRequiresDrawingChange: (next: boolean) => Promise<void>;
  /** The submission's drawings were inventoried (older ones weren't). */
  drawingsInventoried: boolean;
  /** Registers the row's root element with the parent so keyboard nav
   *  can move actual focus (the model is focus-real, not aria-only). */
  rowRef: (el: HTMLDivElement | null) => void;
  onChange: (status: GradeStatus, partialPercent?: number) => void;
  onFeedbackChange: (text: string) => void;
  /** The teacher's ✓ / ✗ on one of this problem's unclear graph items. */
  onGraphVerdict: (n: number, verdict: "yes" | "no") => void;
  /** This problem's graph item whose call is saving, if any. */
  graphBusyItems: number[];
  /** Opens the work gallery on this problem's first tagged page. */
  onOpenPage: () => void;
}) {
  const pageLabel = pageLabelFor(problem.pages);
  const current = entry?.score_status ?? null;
  // Show "AI" badge when the active grade matches the AI suggestion
  // (i.e. teacher hasn't overridden it yet).
  const isAiMatch =
    aiGrade !== null &&
    current === aiGrade.score_status &&
    (current !== "partial" || Math.round(entry?.percent ?? 0) === Math.round(aiGrade.percent));
  // Local edit buffer for the inline partial input. `null` means
  // "show the current server-side value"; a string means "user is
  // typing". On commit we parse + fire onChange, then null the
  // buffer so the displayed value falls back to the external entry.
  // This avoids a sync-via-effect pattern (which is disallowed by
  // react-hooks/set-state-in-effect).
  const [editBuffer, setEditBuffer] = useState<string | null>(null);
  const externalPartial =
    entry?.score_status === "partial" ? String(Math.round(entry.percent)) : "50";
  const partialDraft = editBuffer ?? externalPartial;

  // Focus + select the partial input on the next mount triggered by
  // a user clicking the Partial button. Using a callback ref (not an
  // effect) keeps this out of the render pipeline and avoids stealing
  // focus on the row's *initial* mount (e.g. when detail loads with a
  // pre-existing partial grade). Stable identity via useCallback so
  // React doesn't re-run it on every render.
  const focusOnMount = useRef(false);
  const setInputRef = useCallback((el: HTMLInputElement | null) => {
    if (el && focusOnMount.current) {
      focusOnMount.current = false;
      el.focus();
      el.select();
    }
  }, []);

  const commitPartial = () => {
    if (editBuffer === null) return; // user didn't actually edit
    const n = parseInt(editBuffer, 10);
    setEditBuffer(null); // always drop back to external after commit
    if (!Number.isFinite(n) || n <= 0 || n >= 100) return; // invalid: snap back
    if (entry?.score_status === "partial" && Math.round(entry.percent) === n) return;
    onChange("partial", n);
  };

  const pickPartial = () => {
    const n = parseInt(partialDraft, 10);
    const safe = Number.isFinite(n) && n > 0 && n < 100 ? n : 50;
    focusOnMount.current = true;
    onChange("partial", safe);
  };

  // Student-facing feedback. When an entry exists we honor its value
  // verbatim — including explicit null, which means "teacher cleared
  // this on purpose". We only fall back to the AI's draft when
  // there's no entry at all (disabled state, below). Same local-buffer
  // pattern as the partial input: `null` means "show the external
  // value", a string means "user is typing". Persisted on blur; the
  // parent's setProblemFeedback dedupes no-op saves.
  //
  // Prefer `aiGrade.student_feedback` (second-person, student-voice)
  // over `aiGrade.reasoning` (teacher-voice grading explanation) for
  // the fallback — the textarea is "shown to student when published"
  // so the draft should already read like teacher-to-student prose.
  // Older AI grades from before student_feedback shipped fall back
  // to reasoning so historical rows still pre-fill.
  const [feedbackBuffer, setFeedbackBuffer] = useState<string | null>(null);
  const externalFeedback =
    entry === null
      ? aiGrade?.student_feedback ?? aiGrade?.reasoning ?? ""
      : entry.feedback ?? "";
  const feedbackDraft = feedbackBuffer ?? externalFeedback;
  const feedbackDisabled = entry === null;

  const commitFeedback = () => {
    // A bare focus→blur (the teacher clicked in and out without typing)
    // leaves `feedbackBuffer` null — committing then would persist the
    // displayed default as a phantom "edit" (and, post-publish, flip the
    // row dirty). So only commit a value the teacher actually typed, and
    // only when it differs from the effective current value shown in the
    // field (the stored feedback, or "" when none is stored).
    // Re-committing the unchanged value is a no-op — no PATCH.
    if (feedbackBuffer === null) return;
    const committed = feedbackBuffer;
    setFeedbackBuffer(null);
    if (committed === externalFeedback) return;
    onFeedbackChange(committed);
  };

  // The teacher has overridden the AI when a grade exists and doesn't
  // match the AI's pick. Surface this as a "⟲ AI had suggested X"
  // breadcrumb with one-click undo — the AI's call is preserved, not
  // thrown away.
  const teacherOverrode =
    aiGrade !== null && current !== null && !isAiMatch;

  // Question truncation. Long prompts (multi-paragraph word problems,
  // big LaTeX matrices) push the actually-useful content (student
  // work + answer key + AI verdict) below the fold and slow the
  // teacher's per-problem scan. Default to a 3-line clamp; surface a
  // "Show full prompt" toggle only when the rendered text actually
  // overflows so short questions stay frictionless.
  const [questionExpanded, setQuestionExpanded] = useState(false);
  const [questionOverflows, setQuestionOverflows] = useState(false);
  const questionRef = useRef<HTMLDivElement>(null);
  // Mirror the expanded flag into a ref so the ResizeObserver
  // callback (which closes over a stable element) can short-circuit
  // measurement while the user has the prompt expanded — otherwise
  // an unclamped element measures scrollHeight === clientHeight and
  // we'd erroneously hide the "Hide full prompt" toggle.
  const questionExpandedRef = useRef(questionExpanded);
  useEffect(() => {
    questionExpandedRef.current = questionExpanded;
  }, [questionExpanded]);
  useEffect(() => {
    const el = questionRef.current;
    if (!el) return;
    const measure = () => {
      if (questionExpandedRef.current) return;
      setQuestionOverflows(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    // ResizeObserver re-fires when MathText's lazy-loaded diagrams
    // (ChemDiagram, MathGraph via React.lazy + Suspense) mount and
    // bump the rendered height past the clamp. A single rAF would
    // miss them. Cross-student state leaks are handled by composing
    // submission_id into the row's React key (see SubmissionDetailPanel).
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [problem.question]);

  // Collapsed-row answer comparison. It wraps to show both answers in
  // full; only a genuinely huge one (a matrix, display math) hits the
  // ~4-line cap, and then the row says so ("Show all") instead of
  // clipping silently. Measured like the question clamp. Observing the
  // inner content too: once the cap is hit the box stops resizing, so
  // late KaTeX/font layout only shows up as the content's size changing.
  const answerBoxRef = useRef<HTMLSpanElement>(null);
  const answerContentRef = useRef<HTMLSpanElement>(null);
  const [answerOverflows, setAnswerOverflows] = useState(false);
  // Layout effect: the first measure lands before paint, so "Show all"
  // doesn't pop in a frame late and shift every row below it.
  useLayoutEffect(() => {
    const box = answerBoxRef.current;
    const content = answerContentRef.current;
    if (!collapsed || !box || !content) return;
    // Vertical: compare layout boxes, not scrollHeight — KaTeX's
    // struts and vlists overhang their line boxes by a few px, so
    // scrollHeight reports "overflow" for a lone \frac that is fully
    // visible. Measured against the box's content area (its height minus
    // the py-0.5 headroom), so a last line cut by even 2px still counts.
    // Horizontal: each value cell clips sideways; compare the right edge
    // of every real layout box against its cell — KaTeX's `.base` runs,
    // and any canvas/svg/img that isn't KaTeX's own. Not scrollWidth:
    // that also counts ink-less KaTeX internals (a \sqrt's `.vlist-s`
    // spacer, its 400em self-clipped svg, the hidden MathML) and flagged
    // a fully visible 2√2.
    const cs = getComputedStyle(box);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const measure = () => {
      const tall = content.getBoundingClientRect().height > box.clientHeight - padY + 1;
      const wide = Array.from(content.querySelectorAll<HTMLElement>("[data-answer-cell]")).some(
        (cell) => {
          const right = cell.getBoundingClientRect().right + 1;
          return Array.from(cell.querySelectorAll(".katex-html > .base, canvas, svg, img")).some(
            (el) =>
              (el.classList.contains("base") || !el.closest(".katex")) &&
              el.getBoundingClientRect().right > right,
          );
        },
      );
      setAnswerOverflows(tall || wide);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    ro.observe(content);
    // The observed boxes' widths are set by the row, not the math, so a
    // KaTeX font swap that only widens a matrix wouldn't re-fire the
    // observer. Re-measure whenever a font load finishes (not only the
    // first `ready`, which may already have resolved before this row's
    // KaTeX fonts were requested).
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) measure();
    });
    document.fonts?.addEventListener("loadingdone", measure);
    return () => {
      live = false;
      ro.disconnect();
      document.fonts?.removeEventListener("loadingdone", measure);
    };
  }, [collapsed, problem.student_answer, problem.final_answer]);

  // Student work step list. Same clamp-and-expand pattern as the
  // question — long extracted work (15+ steps from a verbose student)
  // would otherwise push the AI verdict and grade buttons way down
  // the page. Default to a max-h cap that fits ~4-5 steps; surface a
  // "Show all N steps" toggle when content overflows.
  const stepCount = problem.student_steps.length;
  const [stepsExpanded, setStepsExpanded] = useState(false);
  const [stepsOverflow, setStepsOverflow] = useState(false);
  const stepsRef = useRef<HTMLDivElement>(null);
  const stepsExpandedRef = useRef(stepsExpanded);
  useEffect(() => {
    stepsExpandedRef.current = stepsExpanded;
  }, [stepsExpanded]);
  useEffect(() => {
    const el = stepsRef.current;
    if (!el) return;
    const measure = () => {
      if (stepsExpandedRef.current) return;
      setStepsOverflow(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [stepCount]);
  const aiGradeLabel = aiGrade
    ? aiGrade.score_status === "partial"
      ? `Partial ${formatPoints(earnedPoints(aiGrade.percent, problem.points))}/${problem.points}`
      : aiGrade.score_status === "full"
        ? "Full"
        : "No credit"
    : null;

  // Receipt deductions that anchor to a specific student-work step. Each
  // gets a tone (amber/info, cycling) shared by the ledger line and the
  // tinted step in the work list, so the eye links "−20% sign error" to
  // the exact step it happened on. `anchorBaseId` namespaces the step
  // DOM ids the receipt's "↳ step N" links scroll to.
  const deductions = entry?.deductions ?? null;
  const anchorBaseId = `work-${problem.bank_item_id}`;
  const stepAnchors = new Map<number, StepAnchor>();
  (deductions ?? [])
    .filter(
      (d) =>
        d.points_off > 0 &&
        d.step_ref != null &&
        d.step_ref >= 1 &&
        d.step_ref <= stepCount,
    )
    .forEach((d, i) => {
      if (d.step_ref != null && !stepAnchors.has(d.step_ref)) {
        stepAnchors.set(d.step_ref, {
          tone: ANCHOR_TONES[i % ANCHOR_TONES.length],
        });
      }
    });
  const scrollToStep = (stepRef: number) => {
    if (typeof document === "undefined") return;
    const el = document.getElementById(`${anchorBaseId}-step-${stepRef}`);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  };

  // ── Collapsed confident row ───────────────────────────────────────
  // A one-line summary the teacher confirms with a single key/click.
  // Same rowRef + focus model as the expanded row so keyboard nav, the
  // focus ring, and screen-reader tracking are identical.
  if (collapsed && aiGrade) {
    // Trimmed: a stray newline from the extractor shouldn't add blank
    // lines, and a whitespace-only read is "No answer extracted", not
    // an empty cell the teacher might confirm past.
    const studentAnswer = problem.student_answer?.trim() || null;
    const keyAnswer = problem.final_answer?.trim() || null;
    const verdict =
      aiGrade.score_status === "full"
        // Was a hard-coded #22a06b that sat outside the palette and put
        // white on it at 3.3:1 — under AA for a 10px bold label.
        ? { cls: "bg-[color:var(--color-success)] text-white", label: "Full" }
        : aiGrade.score_status === "zero"
          ? {
              cls: "border border-[color:var(--color-error-border)] bg-[color:var(--color-error-light)] text-[color:var(--color-error)]",
              label: "No credit",
            }
          : {
              // `-dark` for the same reason as the Partial grade button:
              // white on `--color-warning` is 4.43:1, just under AA, and
              // this label is 10px bold — nowhere near large text.
              cls: "bg-[color:var(--color-warning-dark)] text-white",
              label: aiGradeLabel ?? "Partial",
            };
    return (
      <div
        ref={rowRef}
        tabIndex={-1}
        aria-current={focused ? "true" : undefined}
        className={`flex items-center gap-3 rounded-[--radius-md] border px-3.5 py-2.5 outline-none transition-[box-shadow,border-color] ${
          focused
            ? "border-primary/40 shadow-[inset_3px_0_0_0_var(--color-primary)] ring-1 ring-primary/20"
            : confirmed
              ? "border-[color:var(--color-success-border)] bg-[color:var(--color-success)]/[0.06]"
              : "border-border-light bg-surface/40 hover:bg-[color:var(--color-surface-alt-2)]"
        }`}
      >
        <button
          type="button"
          onClick={onToggleExpand}
          // Wraps rather than clips: in the narrow middle column (or on a
          // phone) the verdict drops under the answer instead of
          // squeezing the answer to "⚠ No ⁝".
          className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-[--radius-sm]"
          // Spell the comparison out for screen readers rather than
          // leaving them the bare position. Delimiters stripped: these
          // values are LaTeX source, not plain text — the API wraps the
          // extractor's read as `$…$` precisely so it renders as math.
          aria-label={
            studentAnswer
              ? `Expand problem ${problem.position} to inspect. Student answered ${mathPlainText(studentAnswer)}; answer key is ${keyAnswer ? mathPlainText(keyAnswer) : "not set"}.`
              : `Expand problem ${problem.position} to inspect. No answer extracted. Answer key is ${keyAnswer ? mathPlainText(keyAnswer) : "not set"}.`
          }
          aria-expanded={false}
        >
          <span className="w-5 shrink-0 text-xs font-bold tabular-nums text-text-muted">
            {problem.position}
          </span>
          {/* The comparison the one-second confirm actually rests on.
              This row used to show a truncated copy of the QUESTION —
              which the teacher wrote, and which tells them nothing about
              whether the AI's call is right. What decides it is the
              student's answer against the key, so that is what the row
              carries. The question is one click away on expand. */}
          {/* Both answers are shown IN FULL — the row exists so the
              teacher can check the AI's call at a glance, and a clipped
              fraction or a cut-off solution list ("x = π 7·") is exactly
              what she can't check. So nothing here truncates:
                - Each side wraps (MathText `breakInline` lets a
                  multi-part answer break after its separating commas),
                  and the line boxes grow to fit tall math — there is no
                  one-line height cap any more.
                - Wide container: [student | → key] as a grid. The
                  student column is fit-content(60%), so a short answer
                  stays the same compact one-liner as before and a long
                  one wraps within 60%; the key takes the rest.
                  Narrow container (<28rem): plain flex-wrap, so a long
                  answer takes its own line and "→ key" wraps under it.
                - Display math ($$…$$, or a bare \begin{…} environment —
                  the shape the AI grader returns for a matrix) makes
                  MathText emit a BLOCK div with vertical margins; the
                  `[&_div]` / `.katex-display` overrides keep it in the
                  flow of the row.
                - Each value cell clips sideways (`overflow-x: clip`, which
                  leaves KaTeX's vertical overhang visible; `hidden` where
                  clip is unsupported), so a box with no break points can
                  never paint over the other cell.
                - Answers are trimmed, so a stray leading/trailing newline
                  from the extractor doesn't add blank lines; interior line
                  breaks (a system's `x = 2<br>y = 3`) keep their shape.
                - A generous safety cap (9rem: ~4 lines of fraction-height
                  math, ~6 of plain text) remains for
                  genuinely huge answers. Hitting it is never silent:
                  the row shows "Show all", and clicking (this whole
                  button) expands the row to the full grading body. */}
          {/* min(12rem, 100%): 12rem keeps the answer from being squeezed
              beside the verdict on a wide row, but on a phone the button
              is narrower than 12rem and a hard minimum pushed the answer
              out over the Confirm button. */}
          <span className="flex min-w-[min(12rem,100%)] flex-1 flex-col items-start gap-0.5">
            <span
              ref={answerBoxRef}
              // py-0.5: headroom so the clip never shaves a radical bar
              // or accent overhanging the first/last line box.
              className="block max-h-[9rem] w-full overflow-hidden py-0.5 @container"
            >
              <span
                ref={answerContentRef}
                className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-[13px] leading-[1.75] @md:grid @md:grid-cols-[fit-content(60%)_minmax(0,1fr)] [&_.katex-display]:!my-0 [&_.katex-display]:!inline-block [&_div]:!my-0 [&_div]:!inline"
              >
                {studentAnswer ? (
                  <span
                    data-answer-cell
                    className={`min-w-0 max-w-full font-semibold text-text-primary ${ANSWER_CELL_CLIP}`}
                    title={mathPlainText(studentAnswer)}
                  >
                    <MathText text={studentAnswer} breakInline />
                  </span>
                ) : (
                  <span className="min-w-0 text-xs font-semibold text-[color:var(--color-warning-dark)]">
                    <span aria-hidden>⚠</span> No answer extracted
                  </span>
                )}
                {/* Arrow + key travel together, so a wrap never strands
                    the "→" on a line of its own. */}
                <span className="flex min-w-0 max-w-full items-baseline gap-x-1.5">
                  <span aria-hidden className="shrink-0 text-[11px] text-text-muted">
                    →
                  </span>
                  <span
                    data-answer-cell
                    className={`min-w-0 text-text-secondary ${ANSWER_CELL_CLIP}`}
                    title={keyAnswer ? mathPlainText(keyAnswer) : undefined}
                  >
                    {keyAnswer ? (
                      <MathText text={keyAnswer} breakInline />
                    ) : (
                      <span className="italic text-text-muted">no key</span>
                    )}
                  </span>
                </span>
              </span>
            </span>
            {answerOverflows && (
              // Inside the expand button, so it's a label, not a nested
              // control: the click lands on the button (onToggleExpand),
              // and the button's aria-label already carries both answers
              // in full for screen readers.
              <span aria-hidden className="text-[11px] font-semibold text-primary">
                Show all <span>▾</span>
              </span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-bold tracking-[0.04em] text-text-muted">
            <span aria-hidden>🤖</span>
            <span
              className={`rounded-[--radius-pill] px-1.5 py-0.5 text-[11px] font-extrabold ${verdict.cls}`}
            >
              {verdict.label}
            </span>
            {/* Reuse ConfidenceSignal instead of a bare dot + percent.
                "96%" sitting next to a "Full" badge reads as a score;
                "AI · High 96%" reads as certainty, which is what it is. */}
            <ConfidenceSignal confidence={aiGrade.confidence} />
          </span>
        </button>
        {/* Collapsed rows are the confident ones — exactly where a wrong
            call hides best — so the report trigger lives here too, not
            only in the expanded Suggestion card. */}
        <ReportProblemTrigger
          iconOnly
          label={`Report a problem with the AI's grade on problem ${problem.position}`}
          context={{
            ...reportBase,
            problem_id: problem.bank_item_id,
            problem_position: problem.position,
            ai_grade: {
              score_status: aiGrade.score_status,
              percent: aiGrade.percent,
              confidence: aiGrade.confidence,
              reasoning: aiGrade.reasoning ?? "",
            },
            teacher_grade: { score_status: current ?? null, percent: entry?.percent ?? null },
            labels: [`Problem ${problem.position}`, `AI: ${verdict.label}`],
          }}
        />
        {confirmed ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-[--radius-md] border border-[color:var(--color-success)]/30 bg-[color:var(--color-success)]/10 px-2.5 py-1.5 text-[11px] font-bold text-[color:var(--color-success)]">
            <span aria-hidden>✓</span> Confirmed
          </span>
        ) : (
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-[--radius-md] border border-primary/35 bg-primary-bg px-2.5 py-1.5 text-[11px] font-bold text-primary transition-colors hover:border-primary/60 hover:bg-primary/10"
          >
            Confirm
            {confirmKey && (
              <kbd className="rounded-[--radius-sm] border border-border-light bg-surface px-1 font-sans text-[11px] font-bold text-text-secondary shadow-sm">
                {confirmKey}
              </kbd>
            )}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      ref={rowRef}
      tabIndex={-1}
      // Inert focus target: a tabIndex=-1 div the parent .focus()es so
      // keyboard grading has a real focus anchor. aria-current marks it
      // as the active row for assistive tech.
      aria-current={focused ? "true" : undefined}
      className={`rounded-[--radius-md] border bg-surface/40 p-4 outline-none transition-[box-shadow,border-color] ${
        focused
          ? // Editorial focus affordance: a quiet left accent bar (inset
            // shadow so it hugs the rounded corner) plus a faint ring —
            // present, not loud.
            "border-primary/40 shadow-[inset_3px_0_0_0_var(--color-primary)] ring-1 ring-primary/20"
          : "border-border-light"
      }`}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-bold text-text-muted">{problem.position}.</span>
        <div className="min-w-0 flex-1">
          <div
            ref={questionRef}
            // max-h + overflow-hidden (vs line-clamp-3) because the
            // -webkit-box layout that line-clamp relies on reports
            // scrollHeight unreliably when the prompt contains
            // block-level KaTeX (matrices, display equations) — the
            // visual clamp would happen but our scrollHeight ===
            // clientHeight check would miss the overflow and the
            // "Show full question" toggle wouldn't appear. Standard
            // overflow-hidden uses normal flow so scrollHeight
            // correctly accounts for math blocks.
            className={`text-sm text-text-primary ${
              questionExpanded ? "" : "max-h-[5rem] overflow-hidden"
            }`}
            style={
              questionOverflows && !questionExpanded
                ? {
                    // Soft fade at the bottom so a mid-row clamp on a
                    // matrix or display equation reads as "intentionally
                    // cut off" rather than broken. Gradient mask works
                    // in WebKit and modern Firefox.
                    maskImage:
                      "linear-gradient(to bottom, black 70%, transparent 100%)",
                    WebkitMaskImage:
                      "linear-gradient(to bottom, black 70%, transparent 100%)",
                  }
                : undefined
            }
          >
            <MathText text={problem.question} />
          </div>
          {questionOverflows && (
            <button
              type="button"
              onClick={() => setQuestionExpanded((v) => !v)}
              aria-expanded={questionExpanded}
              className="mt-1 inline-flex items-center rounded-[--radius-sm] text-[11px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {questionExpanded ? (
                <>Hide full question <span aria-hidden>▴</span></>
              ) : (
                <>Show full question <span aria-hidden>▾</span></>
              )}
            </button>
          )}
        </div>
        {/* After the question in the DOM, not before it: tab order and
            screen-reader order follow the DOM, and a teacher shouldn't
            reach "open page 3" before reading the problem it belongs to.
            Visually it still sits at the right end of the header row. */}
        {/* Expanding used to be a one-way door: the only `onToggleExpand`
            call site was inside the collapsed branch, so once a row was
            open the sole way back was switching students, which resets
            the expansion set as a side effect. A control that can be
            turned on and not off isn't a toggle.

            Placed after the question in the DOM for the same reason as
            the page marker below: tab and screen-reader order follow the
            DOM, and neither control should be reached before the problem
            it belongs to. */}
        {collapsible && (
          <button
            type="button"
            onClick={onToggleExpand}
            className="shrink-0 rounded-[--radius-sm] border border-border-light bg-surface px-1.5 py-0.5 text-[11px] font-semibold text-text-muted transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            aria-expanded
            aria-label={`Collapse problem ${problem.position} back to one line`}
          >
            <span aria-hidden>▴</span> Collapse
          </button>
        )}
        {pageLabel && (
          <button
            type="button"
            onClick={onOpenPage}
            className="shrink-0 rounded-[--radius-sm] border border-border-light bg-surface px-1.5 py-0.5 text-[11px] font-semibold text-text-muted transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            // Names the pages the way the button DOES, then says where
            // the click lands. The two differ whenever work spans a
            // break, and announcing only the first page dropped exactly
            // what the list/range label exists to say.
            aria-label={
              problem.pages.length > 1
                ? `Student's work, ${pageLabel!.replace(/^p\. /, "pages ")}. Opens page ${problem.pages[0]}.`
                : `Open page ${problem.pages[0]} of the student's work`
            }
          >
            {pageLabel} <span aria-hidden>↗</span>
          </button>
        )}
      </div>
      {/* Both value boxes must CONTAIN their content. KaTeX only breaks
          inline math after a relation or operator — never at a comma,
          `\quad` or `\text{}` — so a multi-part answer such as
          `$a)\ \text{acute},\ b)\ \text{right},\ …$` rendered as one
          unbreakable run wider than the column and painted straight over
          the answer key beside it. `min-w-0` lets each grid cell shrink
          below its content; `breakInline` adds KaTeX-native break points
          between answer parts (after `,` / `\quad`); `break-words` wraps long
          prose tokens; `overflow-x-auto` scrolls only what is still
          atomic (a wide fraction or matrix). `overflow-y-hidden` because
          x-auto forces y to auto too, and KaTeX's sub-pixel overhang
          would otherwise put a 1px vertical scrollbar on every answer
          wherever scrollbars aren't overlays. */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
            Student answer
          </p>
          <div className="mt-1 overflow-x-auto overflow-y-hidden break-words rounded-[--radius-sm] bg-surface px-2 py-1 text-sm text-text-primary">
            {problem.student_answer ? (
              <MathText text={problem.student_answer} breakInline />
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--color-warning-dark)] ">
                <span aria-hidden>⚠</span>
                No answer extracted — refer to submitted work
              </span>
            )}
          </div>
          {/* `?? []`: the web can deploy before the API that sends it. */}
          {problem.student_answer && (problem.units_not_in_work ?? []).length > 0 && (
            <p className="mt-1 text-xs text-[color:var(--color-warning-dark)]">
              {unitsNotInWorkNote(problem.units_not_in_work)}
            </p>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
            Answer key
          </p>
          <div className="mt-1 overflow-x-auto overflow-y-hidden break-words rounded-[--radius-sm] bg-surface px-2 py-1 text-sm text-text-primary">
            {problem.final_answer ? (
              <MathText text={problem.final_answer} breakInline />
            ) : (
              <span className="italic text-text-muted">—</span>
            )}
          </div>
        </div>
      </div>

      {/* Student's work — full step-by-step extraction for this
          problem. Sits between the answer mini-grid and the AI hero
          so the natural eye flow is: compare final answers, scan the
          process, then check the AI's verdict. Hidden when the
          student left this problem blank or extraction never ran for
          this submission. */}
      {stepCount > 0 && (
        <div className="mt-3 rounded-[--radius-md] border border-border-light bg-surface px-3 py-2.5">
          <p className="flex items-baseline gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
            Student&apos;s work
            <span className="font-normal normal-case tracking-normal text-text-muted/80">
              · {stepCount} {stepCount === 1 ? "step" : "steps"}
            </span>
          </p>
          <div
            ref={stepsRef}
            // Never clamp when a deduction anchors to a step — the
            // highlighted step must be visible (and scroll-targetable) for
            // the receipt's "↳ step N" link to land on it.
            className={`mt-2 space-y-2 text-sm text-text-primary ${
              stepsExpanded || stepAnchors.size > 0 ? "" : "max-h-40 overflow-hidden"
            }`}
            style={
              stepsOverflow && !stepsExpanded && stepAnchors.size === 0
                ? {
                    maskImage:
                      "linear-gradient(to bottom, black 75%, transparent 100%)",
                    WebkitMaskImage:
                      "linear-gradient(to bottom, black 75%, transparent 100%)",
                  }
                : undefined
            }
          >
            {problem.student_steps.map((step, i) => {
              const anchor = stepAnchors.get(i + 1);
              return (
                <StudentStepRow
                  key={i}
                  step={step}
                  index={i}
                  anchor={anchor}
                  anchorId={
                    anchor ? `${anchorBaseId}-step-${i + 1}` : undefined
                  }
                />
              );
            })}
          </div>
          {stepsOverflow && stepAnchors.size === 0 && (
            <button
              type="button"
              onClick={() => setStepsExpanded((v) => !v)}
              aria-expanded={stepsExpanded}
              className="mt-2 inline-flex items-center rounded-[--radius-sm] text-[11px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {stepsExpanded ? (
                <>Hide steps <span aria-hidden>▴</span></>
              ) : (
                <>
                  Show all {stepCount} steps <span aria-hidden>▾</span>
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Drawings — recorded on every problem, USED only where the
          question requires one. There, the full inventory in the words
          the grader was given (a required-but-missing drawing in the
          warning tone). Elsewhere, at most a quiet line, so a teacher
          can spot a question that should have been flagged. */}
      <DrawingsPanel
        problem={problem}
        inventoried={drawingsInventoried}
        onRequiresDrawingChange={onRequiresDrawingChange}
      />

      {/* AI grading hero — the AI's call is visible before the grade
          buttons, with reasoning inline instead of buried below. When
          no AI grade is present (pipeline failed / disabled), this
          block simply doesn't render. Every AI grade now carries an
          always-on confidence band (high/medium/low) so a 0.62 and a
          0.98 no longer read identically — low (<0.6) keeps its amber
          alarm emphasis, while high/medium stay quiet so the eye is
          only pulled to uncertain calls. Historical rows without a
          confidence value stay neutral. */}
      {aiGrade && aiGradeLabel && (
        <div className="mt-3 rounded-[--radius-md] border border-primary/25 bg-primary-bg px-3 py-2">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs font-bold text-text-primary">
            <span className="text-primary" aria-hidden>🤖</span>
            <span className="text-primary">Suggestion:</span>
            <span>{aiGradeLabel}</span>
            <ConfidenceSignal confidence={aiGrade.confidence} />
            {/* "Report a problem" lives on the AI's call itself — the
                natural place to say "you got this one wrong". Snapshots
                the AI grade and the teacher's current grade so the report
                still makes sense after a regrade. */}
            <ReportProblemTrigger
              className="ml-auto"
              label="Report"
              context={{
                ...reportBase,
                problem_id: problem.bank_item_id,
                problem_position: problem.position,
                ai_grade: {
                  score_status: aiGrade.score_status,
                  percent: aiGrade.percent,
                  confidence: aiGrade.confidence,
                  reasoning: aiGrade.reasoning ?? "",
                },
                teacher_grade: {
                  score_status: current ?? null,
                  percent: entry?.percent ?? null,
                },
                labels: [
                  `Problem ${problem.position}`,
                  `AI: ${aiGradeLabel}`,
                  current
                    ? `Your grade: ${current === "full" ? "Full" : current === "zero" ? "No credit" : `Partial ${Math.round(entry?.percent ?? 0)}%`}`
                    : "Your grade: not set",
                ],
              }}
            />
          </p>
          {aiGrade.reasoning && (
            // Grader reasoning regularly references math ($-17$,
            // $\begin{pmatrix}...$, etc.) — rendering through MathText
            // matches how the rest of the review page surfaces problem
            // text and student work.
            <div className="mt-1 text-[11px] leading-relaxed text-text-secondary">
              <MathText text={aiGrade.reasoning} />
            </div>
          )}
        </div>
      )}

      {/* Itemized receipt — the AI's per-problem ledger. Renders only
          when the AI supplied a `deductions` breakdown (additive: rows
          without it keep showing just the reasoning hero above). Anchors
          each deduction to the matching student-work step. */}
      {/* The drawing, item by item: what the graph part of the grade was
          charged against. Items the check couldn't decide wait here for
          her call. */}
      {problem.graph && (
        <GraphCheckReview graph={problem.graph} busyItems={graphBusyItems} onVerdict={onGraphVerdict} />
      )}

      {deductions !== null && (
        <GradeReceipt
          deductions={deductions}
          status={current ?? "partial"}
          percent={entry?.percent ?? 0}
          worth={problem.points}
          aiConfidence={aiGrade?.confidence ?? null}
          stepCount={stepCount}
          onAnchorClick={scrollToStep}
          ruleText={ruleText}
        />
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <GradeBtn
          active={current === "full"}
          tone="green"
          onClick={() => onChange("full")}
          aiPick={aiGrade?.score_status === "full"}
        >
          Full
        </GradeBtn>
        <GradeBtn
          active={current === "partial"}
          tone="amber"
          onClick={pickPartial}
          aiPick={aiGrade?.score_status === "partial"}
        >
          Partial
        </GradeBtn>
        {current === "partial" && (
          <div className="inline-flex items-center gap-1 rounded-[--radius-md] border border-[color:var(--color-warning)]/30 bg-[color:var(--color-warning-bg)] px-2 py-1 text-xs font-semibold text-[color:var(--color-warning-dark)]  dark:bg-[color:var(--color-warning)]/10 ">
            <input
              ref={setInputRef}
              type="number"
              inputMode="numeric"
              min={1}
              max={99}
              value={partialDraft}
              onChange={(e) => setEditBuffer(e.target.value)}
              onBlur={commitPartial}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              aria-label="Partial credit percent (1-99)"
              className="w-12 bg-transparent text-right tabular-nums focus:outline-none"
            />
            <span aria-hidden>%</span>
            {entry && (
              <span className="ml-1 font-normal text-[color:var(--color-warning-dark)]/80">
                · {formatPoints(earnedPoints(entry.percent, problem.points))}/{problem.points} pts
              </span>
            )}
          </div>
        )}
        <GradeBtn
          active={current === "zero"}
          tone="red"
          onClick={() => onChange("zero")}
          aiPick={aiGrade?.score_status === "zero"}
        >
          No credit
        </GradeBtn>
      </div>

      {teacherOverrode && aiGrade && aiGradeLabel && (
        <button
          type="button"
          onClick={() =>
            onChange(
              aiGrade.score_status,
              aiGrade.score_status === "partial"
                ? Math.round(aiGrade.percent)
                : undefined,
            )
          }
          className="mt-2 inline-flex items-center gap-1 rounded-[--radius-pill] border border-primary/30 bg-primary-bg px-2.5 py-1 text-[11px] font-semibold text-primary hover:border-primary/60 hover:bg-primary/10"
          title="Revert to the AI's suggested grade"
        >
          <span aria-hidden>⟲</span>
          AI had suggested {aiGradeLabel} · revert
        </button>
      )}

      {/* Per-problem feedback, shown to the student once the grade is
          published. Pre-filled with the AI's reasoning when present so
          teachers can accept, edit, or clear — no UI fanfare either
          way. The published text is the teacher's voice to the student. */}
      <div className="mt-3">
        <label className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
          Feedback <span className="font-normal normal-case tracking-normal text-text-muted/80">· shown to student when published</span>
        </label>
        <textarea
          // When disabled (no grade yet), render empty so the
          // placeholder "Pick Full/Partial/Zero first..." is visible.
          // Otherwise the textarea would show AI reasoning as an
          // uneditable grey block, which hides the actual instruction.
          value={feedbackDisabled ? "" : feedbackDraft}
          onChange={(e) => setFeedbackBuffer(e.target.value)}
          onBlur={commitFeedback}
          disabled={feedbackDisabled}
          maxLength={2000}
          rows={3}
          placeholder={
            feedbackDisabled
              ? "Pick Full / Partial / No credit first — then you can leave feedback."
              : "Add a sentence the student will see…"
          }
          className="mt-1 w-full resize-y rounded-[--radius-sm] border border-border-light bg-surface px-2.5 py-1.5 text-xs leading-relaxed text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none disabled:cursor-not-allowed disabled:bg-[color:var(--color-surface-alt-2)] disabled:text-text-muted"
        />
      </div>
    </div>
  );
}

function GradeBtn({
  active,
  tone,
  onClick,
  children,
  aiPick = false,
}: {
  active: boolean;
  tone: "green" | "amber" | "red";
  onClick: () => void;
  children: React.ReactNode;
  /** Mark this button as the AI's suggestion. When not the active
   *  choice, a subtle primary-tinted outline signals "the AI
   *  recommended this". Always pairs with an inline "AI" pill. */
  aiPick?: boolean;
}) {
  // Selected fills carry a white label, so each one is picked to clear
  // 4.5:1 under white. None of the three did:
  //   red   → `--color-error-light` (#F0D7D1, a pale pink) at 1.37:1 —
  //           the label all but vanished the moment a teacher picked it
  //   green → Tailwind's green-500, outside the palette, at 2.2:1
  //   amber → `--color-warning` (#A66B15) at 4.43:1, just under
  // Amber is why this list is `-dark` for one tone and not the others:
  // `--color-warning` is the lightest of the three status tokens and
  // misses on its own, so the filled-with-white use takes
  // `--color-warning-dark` (6.08:1). Red and green clear it at full
  // strength (9.00:1 and 6.08:1). Check the ratio before adding a tone.
  //
  // These are LIGHT-theme ratios, which is what ships: nothing in the app
  // sets `data-theme`, and there is no `prefers-color-scheme` block, so
  // the dark token block in globals.css is currently unreachable. Under
  // those tokens white would sit at 4.19 (error), 3.15 (success) and 3.14
  // (warning) — all under AA. Fixing that is not a token swap: it needs a
  // dark-theme foreground decision (dark ink on the lighter fills) taken
  // across the app rather than guessed at here, so it is deliberately not
  // done in this file. Whoever turns dark mode on owns it.
  const activeCls = {
    green: "border-[color:var(--color-success)] bg-[color:var(--color-success)] text-white",
    amber: "border-[color:var(--color-warning-dark)] bg-[color:var(--color-warning-dark)] text-white",
    red: "border-[color:var(--color-error)] bg-[color:var(--color-error)] text-white",
  }[tone];
  const inactiveCls = aiPick
    ? "border-primary/40 bg-primary-bg text-text-primary hover:border-primary/60"
    : "border-border-light bg-surface text-text-secondary hover:border-primary/40 hover:text-text-primary";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-[36px] items-center gap-1 rounded-[--radius-md] border px-3.5 py-2 text-xs font-bold transition-colors ${
        active ? activeCls : inactiveCls
      }`}
    >
      {children}
      {aiPick && (
        <span
          className={`rounded-[--radius-pill] px-1.5 py-0.5 text-[10px] font-bold leading-none ${
            active ? "bg-white/30 text-white" : "bg-primary/15 text-primary"
          }`}
          aria-label="AI suggestion"
        >
          AI
        </span>
      )}
    </button>
  );
}
