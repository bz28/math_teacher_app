"use client";

import { useMemo, useState } from "react";
import { MathText } from "@/components/shared/math-text";
import type {
  SubmissionExtraction,
  ExtractionStep,
  ExtractionFinalAnswer,
} from "@/lib/api";

/**
 * Post-extraction confirm screen. Shown after submit, before grading
 * runs. The student sees Vision's reading of their handwritten work
 * grouped by problem (1, 2, 3…) and can edit any line that was misread
 * before grading is locked in.
 *
 * Editable — unlike the integrity confirm screen, this one comes
 * before any grade exists, so there's no laundering risk. The student
 * is saying "here's what I actually wrote"; grading runs against that.
 *
 * Shape preservation: on save, the edited per-problem text blocks are
 * reassembled into the same `{steps, final_answers}` structure the AI
 * grader consumes. One step per non-empty line. LaTeX is dropped from
 * edited steps — the grader reads `latex || plain_english`, so plain
 * text from the student's keyboard still grades correctly.
 */
export function ExtractionConfirmView({
  extraction,
  imageDataUrl,
  onConfirm,
  saving,
  error,
}: {
  extraction: SubmissionExtraction;
  /** Full data-URL of the submitted photo, rendered alongside so the
   *  student can eyeball "is that really what I wrote?". */
  imageDataUrl: string | null;
  /** Called with the full edited extraction body. Parent handles the
   *  API call + navigation. */
  onConfirm: (edited: SubmissionExtraction) => void;
  saving: boolean;
  error: string | null;
}) {
  const grouped = useMemo(
    () => groupByProblem(extraction),
    [extraction],
  );

  // Per-problem draft buffers. Keys are the problem position as a
  // string; values are { workText, answerText }. Lifted into state so
  // the student can edit freely without the parent re-sorting under
  // them. Initialized from the extraction's existing text.
  const [drafts, setDrafts] = useState<Record<string, { workText: string; answerText: string }>>(
    () => initialDrafts(grouped),
  );

  function handleConfirm() {
    const edited = rebuildExtraction(extraction, grouped, drafts);
    onConfirm(edited);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold text-text-primary">
        Does this match what you wrote?
      </h1>
      <p className="mt-2 text-sm text-text-secondary">
        We read your work — take a quick look below. Fix anything we got
        wrong, then confirm. Your grade will be based on what&rsquo;s here.
      </p>

      <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(260px,340px)]">
        {/* Edit column */}
        <div className="space-y-5">
          {grouped.length === 0 ? (
            <p className="rounded-[--radius-md] border border-dashed border-border-light bg-bg-subtle p-6 text-center text-sm text-text-muted">
              We couldn&rsquo;t pick out any work from your photo. You can
              still confirm — your teacher will see the photo and grade
              directly.
            </p>
          ) : (
            grouped.map((g) => (
              <ProblemBlock
                key={g.key}
                position={g.position}
                workText={drafts[g.key]?.workText ?? ""}
                answerText={drafts[g.key]?.answerText ?? ""}
                onChange={(patch) =>
                  setDrafts((d) => ({
                    ...d,
                    [g.key]: { ...(d[g.key] ?? { workText: "", answerText: "" }), ...patch },
                  }))
                }
              />
            ))
          )}
        </div>
        {/* Photo column — sticky so the student can scroll edits
            against a fixed reference. */}
        <aside className="md:sticky md:top-4 md:self-start">
          <p className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
            Your photo
          </p>
          {imageDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageDataUrl}
              alt="Your submitted work"
              className="mt-2 w-full rounded-[--radius-md] border border-border-light"
            />
          ) : (
            <p className="mt-2 text-xs italic text-text-muted">
              Photo unavailable.
            </p>
          )}
        </aside>
      </div>

      {error && (
        <p className="mt-4 text-sm font-semibold text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={saving}
          className="rounded-[--radius-md] bg-primary px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Submitting…" : "Confirm & submit"}
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────

function ProblemBlock({
  position,
  workText,
  answerText,
  onChange,
}: {
  position: number;
  workText: string;
  answerText: string;
  onChange: (patch: Partial<{ workText: string; answerText: string }>) => void;
}) {
  return (
    <div className="rounded-[--radius-lg] border border-border-light bg-surface p-4 shadow-sm">
      <h2 className="text-sm font-bold text-text-primary">
        Problem {position}
      </h2>

      <div className="mt-3">
        <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
          Your work
        </label>
        <textarea
          value={workText}
          onChange={(e) => onChange({ workText: e.target.value })}
          rows={4}
          className="mt-1 w-full resize-y rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 font-mono text-sm leading-relaxed text-text-primary focus:border-primary focus:outline-none"
          placeholder="One step per line"
        />
        {workText.trim() !== "" && (
          <div className="mt-2 text-[11px] text-text-muted">
            <p className="font-semibold uppercase tracking-wider">Preview</p>
            <div className="mt-1 space-y-0.5 text-text-secondary">
              {workText
                .split("\n")
                .filter((l) => l.trim() !== "")
                .map((l, i) => (
                  <MathText key={i} text={l} />
                ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-3">
        <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
          Final answer
        </label>
        <input
          type="text"
          value={answerText}
          onChange={(e) => onChange({ answerText: e.target.value })}
          className="mt-1 w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
        />
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Grouping + rebuild helpers
// ────────────────────────────────────────────────────────────────────

type ProblemGroup = {
  key: string;
  position: number;
  steps: ExtractionStep[];
  finalAnswer: ExtractionFinalAnswer | null;
};

/** Collect extraction into per-problem buckets. Steps without a
 *  position get bucketed into position 1 so they don't vanish — a
 *  Vision pass that didn't emit per-step positions still surfaces
 *  every step to the student. */
function groupByProblem(ex: SubmissionExtraction): ProblemGroup[] {
  const map = new Map<number, ProblemGroup>();
  const add = (pos: number) => {
    const key = String(pos);
    if (!map.has(pos)) {
      map.set(pos, { key, position: pos, steps: [], finalAnswer: null });
    }
    return map.get(pos)!;
  };

  for (const s of ex.steps ?? []) {
    const pos = s.problem_position ?? 1;
    add(pos).steps.push(s);
  }
  for (const a of ex.final_answers ?? []) {
    add(a.problem_position).finalAnswer = a;
  }
  return Array.from(map.values()).sort((a, b) => a.position - b.position);
}

/** Seed textarea buffers with the current extraction text. Uses
 *  latex > plain_english precedence so fractions/matrices render
 *  cleanly in the preview; fallback to plain keeps "let x = …" style
 *  written steps visible too. */
function initialDrafts(
  groups: ProblemGroup[],
): Record<string, { workText: string; answerText: string }> {
  const out: Record<string, { workText: string; answerText: string }> = {};
  for (const g of groups) {
    const workText = g.steps
      .map((s) => s.latex || s.plain_english || "")
      .filter((x) => x !== "")
      .join("\n");
    const answerText =
      g.finalAnswer?.answer_latex || g.finalAnswer?.answer_plain || "";
    out[g.key] = { workText, answerText };
  }
  return out;
}

/** Rebuild the extraction JSON from the edited textarea buffers.
 *  Preserves every other top-level field on the original extraction
 *  (confidence, unknown Vision fields, etc.) so we don't drop data
 *  the grader might read. Edited steps are flattened to plain_english
 *  — the grader reads `latex || plain_english` so plain-text is still
 *  graded correctly. */
function rebuildExtraction(
  original: SubmissionExtraction,
  groups: ProblemGroup[],
  drafts: Record<string, { workText: string; answerText: string }>,
): SubmissionExtraction {
  const steps: ExtractionStep[] = [];
  const final_answers: ExtractionFinalAnswer[] = [];
  let stepNum = 1;
  for (const g of groups) {
    const draft = drafts[g.key];
    if (!draft) continue;
    for (const line of draft.workText.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      steps.push({
        step_num: stepNum++,
        problem_position: g.position,
        plain_english: trimmed,
      });
    }
    if (draft.answerText.trim() !== "") {
      final_answers.push({
        problem_position: g.position,
        answer_plain: draft.answerText.trim(),
      });
    }
  }
  return { ...original, steps, final_answers };
}
