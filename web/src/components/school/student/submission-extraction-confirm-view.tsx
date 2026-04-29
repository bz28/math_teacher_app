"use client";

import { useMemo, useState } from "react";
import {
  ApiError,
  schoolStudent,
  type IntegrityExtraction,
  type IntegrityExtractionFinalAnswer,
  type IntegrityExtractionStep,
  type SubmissionFile,
} from "@/lib/api";
import { MathText } from "@/components/shared/math-text";
import { FileTextIcon } from "@/components/ui/icons";
import { useDeviceType } from "./use-device-type";

interface Props {
  submissionId: string;
  /** Every file the student submitted, in upload order. Rendered as
   *  a persistent strip so the student can visually match each
   *  problem against its source page (the model handles cross-page
   *  stitching natively when files are sent in order — we don't ask
   *  it to tag a `source_page`, the strip handles that). */
  submittedFiles: SubmissionFile[];
  extraction: IntegrityExtraction;
  /** Student confirmed the reader got it right (with optional edits
   *  applied). Parent transitions to the chat / submitted view. */
  onContinue: () => void;
  /** Student said the reader got something wrong. We fire the flag
   *  endpoint here and hand control back to the parent, which
   *  transitions onward — the flag is a signal for the teacher, not
   *  a gate. */
  onFlagged: () => void;
}

/**
 * Post-extraction confirm screen. Renders the FULL submission's
 * extraction (all steps + per-problem final answers) grouped by
 * problem_position, side-by-side with the submitted photo.
 *
 * The student can fix individual OCR misreads by tapping a step or
 * final answer; their edits are sent with the confirm POST and the
 * server overlays them on top of the stored Vision read before AI
 * grading runs. The original Vision extraction stays on the
 * submission row for the teacher review view to surface as evidence.
 */

// Soft time budget matches the chat header. Mobile typing is ~2x
// slower, so mobile students see a longer expectation.
const BUDGET_COPY: Record<"desktop" | "mobile", string> = {
  desktop: "Takes about 3 minutes.",
  mobile: "Takes about 5 minutes.",
};

type ProblemGroup = {
  /** Null = unattributed scratchwork / cross-problem setup.
   *  Unattributed steps cannot be edited — there's no
   *  problem_position to key the edit by. They render read-only. */
  position: number | null;
  steps: IntegrityExtractionStep[];
  /** Every final answer Vision attributed to this problem. The
   *  schema doesn't enforce uniqueness on problem_position, so two
   *  entries can share a position — we render all of them rather
   *  than silently keeping the last. */
  finalAnswers: IntegrityExtractionFinalAnswer[];
};

/** Bucket extraction steps by problem_position + attach each
 *  problem's final answer(s). Unattributed steps (position=null) land
 *  in their own "Other work" group rendered last. */
function groupByProblem(extraction: IntegrityExtraction): ProblemGroup[] {
  // Use a Map keyed by "number|null" so we can preserve insertion
  // order for same-position steps AND still split out unattributed
  // steps into their own bucket.
  const map = new Map<number | "null", ProblemGroup>();
  for (const step of extraction.steps) {
    const key = step.problem_position ?? "null";
    if (!map.has(key)) {
      map.set(key, {
        position: step.problem_position,
        steps: [],
        finalAnswers: [],
      });
    }
    map.get(key)!.steps.push(step);
  }
  for (const fa of extraction.final_answers) {
    // Coerce null with the same "null" sentinel the steps loop uses,
    // so a final_answer with null position dedupes into the same
    // "Other work" bucket. Previously the steps loop used "null"
    // (string) and this loop used null (the value) — different Map
    // keys, so two ProblemGroup entries with position=null landed in
    // the output. The render then collided on key={g.position ?? "other"}.
    const key = fa.problem_position ?? "null";
    if (!map.has(key)) {
      // Problem had a final answer but no tagged steps — still worth
      // surfacing so the student sees the answer we read for that
      // problem.
      map.set(key, {
        position: fa.problem_position,
        steps: [],
        finalAnswers: [fa],
      });
    } else {
      map.get(key)!.finalAnswers.push(fa);
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    // Unattributed ("Other work") always renders last.
    if (a.position === null) return 1;
    if (b.position === null) return -1;
    return a.position - b.position;
  });
}

function stepKey(position: number, stepNum: number): string {
  return `${position}:${stepNum}`;
}

function finalKey(position: number): string {
  return `${position}:final`;
}

/** What the student sees for an unedited step: rendered LaTeX block
 *  when present, else the plain-English fallback. Mirrors the read-
 *  only display so an edited row reverts to identical typography
 *  after a "View original" expand. */
function ReadOnlyStepText({ step }: { step: IntegrityExtractionStep }) {
  if (step.latex) {
    return (
      <div className="text-text-primary">
        <MathText text={`$$${step.latex}$$`} />
      </div>
    );
  }
  return (
    <span className="font-medium text-text-primary">{step.plain_english}</span>
  );
}

function ReadOnlyFinalAnswerText({
  fa,
}: {
  fa: IntegrityExtractionFinalAnswer;
}) {
  const latex = fa.answer_latex?.trim() ?? "";
  const plain = fa.answer_plain?.trim() ?? "";
  if (latex) {
    return <MathText text={`$$${latex}$$`} />;
  }
  return <span>{plain}</span>;
}

/** Inline editor shell shared by step + final-answer rows. The
 *  caller chooses what the read-only display looks like; this owns
 *  edit-mode state, the textarea, Save/Cancel buttons, and the
 *  edited / view-original disclosure. */
function EditableRow({
  editKey,
  originalText,
  editedText,
  readOnlyDisplay,
  originalDisplay,
  onSaveEdit,
  onClearEdit,
  ariaLabel,
}: {
  editKey: string;
  /** Plain-text fallback used to seed the textarea. Vision returns
   *  empty plain_english for steps that arrived as pure LaTeX —
   *  fall back to the latex source so the student can edit it as
   *  text instead of starting from a blank field. */
  originalText: string;
  /** Saved edit, if any. When set, the row is "edited"; the
   *  read-only display shows this text and the original is hidden
   *  behind a disclosure. */
  editedText: string | null;
  /** What the row shows when not in edit mode. Caller passes the
   *  rendered LaTeX block / plain-text span so this component
   *  doesn't have to know about the underlying schema. */
  readOnlyDisplay: React.ReactNode;
  /** What the "View what we originally read" disclosure expands to —
   *  caller passes the *original* rendered display so the student
   *  sees what was on the page before they corrected it. Only
   *  consumed when edited. */
  originalDisplay: React.ReactNode;
  onSaveEdit: (key: string, text: string) => void;
  onClearEdit: (key: string) => void;
  ariaLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [draft, setDraft] = useState("");

  const isEdited = editedText !== null;

  function startEdit() {
    setDraft(editedText ?? originalText);
    setEditing(true);
  }
  function cancelEdit() {
    setEditing(false);
    setDraft("");
  }
  function commit() {
    const trimmed = draft.trim();
    setEditing(false);
    setDraft("");
    if (!trimmed) {
      // Empty save: on an already-edited row this is the student's
      // "wipe my edit" gesture — drop it so the original Vision read
      // stands again. On a never-edited row it's a no-op (we don't
      // surface deletion of original Vision rows here; that's what
      // the "Reader got something wrong" flag is for).
      if (isEdited) onClearEdit(editKey);
      return;
    }
    if (trimmed === originalText.trim()) {
      // Edited back to the original — clear the edit so we don't
      // ship a no-op overlay.
      onClearEdit(editKey);
      return;
    }
    onSaveEdit(editKey, trimmed);
  }

  if (editing) {
    return (
      <div className="space-y-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={`Edit ${ariaLabel}`}
          maxLength={2000}
          className="block w-full min-h-[44px] rounded-[--radius-sm] border border-border bg-surface px-2 py-1.5 text-sm text-text-primary focus:border-primary focus:outline-none"
          rows={2}
          autoFocus
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={commit}
            className="min-h-[44px] rounded-[--radius-sm] bg-primary px-3 text-xs font-bold text-white hover:bg-primary/90 sm:min-h-[32px]"
          >
            Save
          </button>
          <button
            type="button"
            onClick={cancelEdit}
            className="min-h-[44px] rounded-[--radius-sm] border border-border px-3 text-xs font-medium text-text-secondary hover:border-text-muted sm:min-h-[32px]"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">{readOnlyDisplay}</div>
        <button
          type="button"
          onClick={startEdit}
          aria-label={`Edit ${ariaLabel}`}
          title="Looks wrong? Tap to fix."
          className="shrink-0 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[--radius-sm] border border-border-light text-xs text-text-muted hover:border-primary hover:text-primary sm:min-h-[32px] sm:min-w-[32px]"
        >
          <span aria-hidden>✎</span>
        </button>
      </div>
      {isEdited && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-primary-bg px-2 py-0.5 font-semibold text-primary">
            <span aria-hidden>✎</span> edited
          </span>
          <button
            type="button"
            onClick={() => setShowOriginal((v) => !v)}
            aria-expanded={showOriginal}
            className="text-text-muted underline-offset-2 hover:text-text-secondary hover:underline"
          >
            {showOriginal ? "Hide original" : "View what we originally read"}
          </button>
          <button
            type="button"
            onClick={() => onClearEdit(editKey)}
            className="text-text-muted underline-offset-2 hover:text-text-secondary hover:underline"
          >
            Undo edit
          </button>
        </div>
      )}
      {isEdited && showOriginal && (
        <div className="mt-1.5 rounded-[--radius-sm] border border-border-light bg-bg-subtle/40 px-2 py-1.5 text-xs text-text-secondary">
          <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
            We originally read
          </div>
          <div className="mt-0.5">{originalDisplay}</div>
        </div>
      )}
    </div>
  );
}

export function SubmissionExtractionConfirmView({
  submissionId,
  submittedFiles,
  extraction,
  onContinue,
  onFlagged,
}: Props) {
  // Two mutually-exclusive terminal actions on the confirm screen:
  //   Continue → server stamps extraction_confirmed_at, applies any
  //              `edits` overlay, spawns integrity + AI grading.
  //   Flag     → server stamps extraction_flagged_at, submission goes
  //              to the teacher for manual grading. No AI calls run
  //              and any in-progress edits are discarded — flagging
  //              is the stronger signal.
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sparse map of student corrections keyed by step / final-answer
  // identity. POSTed alongside the confirm call.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const editCount = Object.keys(edits).length;
  const device = useDeviceType();
  const groups = useMemo(() => groupByProblem(extraction), [extraction]);
  // Free navigation between problems — every group the student has
  // landed on gets a ✓. Forced walk-through felt condescending in
  // testing; the pagination still nudges them through naturally.
  const [activeIndex, setActiveIndex] = useState(0);
  const [visited, setVisited] = useState<Set<number>>(() => new Set([0]));
  const [zoomedFile, setZoomedFile] = useState<SubmissionFile | null>(null);
  const totalProblems = groups.length;
  const isLast = activeIndex >= totalProblems - 1;
  const goTo = (i: number) => {
    if (i < 0 || i >= totalProblems) return;
    setActiveIndex(i);
    setVisited((prev) =>
      prev.has(i) ? prev : new Set(prev).add(i),
    );
  };
  // Empty-page banner: extraction returned fewer attributable problems
  // than files uploaded. Doesn't block confirm — just informs.
  const attributedProblems = groups.filter((g) => g.position !== null).length;
  const blankPageCount = Math.max(0, submittedFiles.length - Math.max(attributedProblems, 1));

  function saveEdit(key: string, text: string) {
    setEdits((prev) => ({ ...prev, [key]: text }));
  }

  function clearEdit(key: string) {
    setEdits((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function handleContinue() {
    setSubmitting(true);
    setError(null);
    try {
      await schoolStudent.confirmExtraction(submissionId, edits);
      onContinue();
    } catch (e) {
      // 409 means server state moved (someone else flagged in another
      // tab, or the window raced past our local view) — the student's
      // edits will NOT have been persisted by this request.
      //
      // When the student had no edits, silently routing forward is
      // the right recovery: nothing was lost. When edits were in
      // flight, surface a clear message so the student knows their
      // corrections didn't apply, then keep them on the screen so
      // they can re-confirm (the second call hits already_confirmed
      // and routes them naturally).
      if (e instanceof ApiError && e.status === 409) {
        if (Object.keys(edits).length === 0) {
          onContinue();
          return;
        }
        setError(
          "This submission already moved on, so your edits weren't applied — your teacher will see what we originally read. Tap Confirm to continue.",
        );
        setSubmitting(false);
        return;
      }
      setError("Couldn't confirm. Try again.");
      setSubmitting(false);
    }
  }

  async function handleFlag() {
    setSubmitting(true);
    setError(null);
    try {
      await schoolStudent.flagExtractionSubmission(submissionId);
      onFlagged();
    } catch (e) {
      // 409 = server already past the confirm/flag decision (student
      // confirmed in another tab, or the submission was already
      // flagged). Exit to the terminal and let the parent re-route
      // rather than looping on "Try again".
      if (e instanceof ApiError && e.status === 409) {
        onFlagged();
        return;
      }
      setError("Couldn't save your flag. Try again.");
      setSubmitting(false);
    }
  }

  const activeGroup = groups[activeIndex];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-bold text-text-primary">
        Does this match what you wrote?
      </h1>
      <p className="mt-2 text-sm text-text-secondary">
        Walk through each problem. Tap <span aria-hidden>✎</span> on any
        step to fix mistakes — your teacher will grade what you confirm
        here. All your pages stay visible on the side so you can match
        each problem against the right page of your work.
      </p>

      {blankPageCount > 0 && (
        <div className="mt-4 rounded-[--radius-sm] border border-amber-500 bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-500/10">
          We couldn&apos;t read problems on{" "}
          {blankPageCount === 1 ? "1 of your pages" : `${blankPageCount} of your pages`}
          . Make sure each photo is clear and your work is visible.
        </div>
      )}

      {totalProblems === 0 ? (
        <p className="mt-6 italic text-sm text-text-muted">
          No legible work was extracted from your photos. Flag so your
          teacher knows, or continue if this looks right.
        </p>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-[180px_1fr]">
          {/* Persistent file strip — vertical on desktop, horizontal
              scroll on mobile. Every page stays visible so the student
              can match the active problem to its source page. */}
          <FileStrip
            files={submittedFiles}
            onZoom={setZoomedFile}
          />

          <div>
            <ProblemPagination
              total={totalProblems}
              active={activeIndex}
              visited={visited}
              onSelect={goTo}
            />

            {activeGroup && (
              <section
                key={activeGroup.position ?? "other"}
                className="mt-3 rounded-[--radius-md] border border-border-light bg-background p-3"
              >
                <h2 className="text-sm font-bold text-text-primary">
                  {activeGroup.position !== null
                    ? `Problem ${activeGroup.position}`
                    : "Other work"}
                </h2>
                <ProblemBlock
                  group={activeGroup}
                  edits={edits}
                  onSaveEdit={saveEdit}
                  onClearEdit={clearEdit}
                />
              </section>
            )}

            <div className="mt-4 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => goTo(activeIndex - 1)}
                disabled={activeIndex === 0 || submitting}
                className="inline-flex min-h-[44px] items-center rounded-[--radius-sm] border border-border px-3 text-sm text-text-secondary hover:border-primary disabled:opacity-30"
              >
                ← Previous
              </button>
              <span className="text-xs text-text-muted">
                Problem {activeIndex + 1} of {totalProblems}
              </span>
              <button
                type="button"
                onClick={() => goTo(activeIndex + 1)}
                disabled={isLast || submitting}
                className="inline-flex min-h-[44px] items-center rounded-[--radius-sm] border border-border px-3 text-sm text-text-secondary hover:border-primary disabled:opacity-30"
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      )}

      {zoomedFile && (
        <FileZoomModal
          file={zoomedFile}
          onClose={() => setZoomedFile(null)}
        />
      )}

      {/* "What's next" panel sits right above the buttons so the
          student reads it the moment before they choose. */}
      <div className="mt-8 rounded-[--radius-md] border border-primary/30 bg-primary-bg/40 px-4 py-3.5">
        <p className="text-sm font-semibold text-text-primary">
          Next: a quick chat about your work
        </p>
        <p className="mt-1 text-sm text-text-secondary">
          {BUDGET_COPY[device]} Stay in this window and answer in your
          own words — you don&rsquo;t need to look anything up.
        </p>
      </div>

      {editCount > 0 && (
        <p className="mt-4 text-xs text-text-secondary">
          You edited {editCount} {editCount === 1 ? "row" : "rows"}.
          Your teacher will grade your edited work and can still see
          what we originally read.
        </p>
      )}
      {error && <p className="mt-4 text-sm text-error">{error}</p>}

      <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={handleFlag}
          disabled={submitting}
          className="min-h-[44px] w-full rounded-[--radius-sm] border border-border px-4 py-3 text-sm font-medium text-text-secondary hover:border-amber-500 hover:text-amber-600 disabled:opacity-50 sm:w-auto sm:py-2"
        >
          {submitting ? "Saving…" : "This reading is completely wrong"}
        </button>
        {/* "Looks good →" advances on non-final problems, terminates
            on the last. Always enabled — the pagination already nudges
            students through; forcing every problem to be visited
            before Confirm felt condescending in review. */}
        {!isLast && totalProblems > 0 ? (
          <button
            type="button"
            onClick={() => goTo(activeIndex + 1)}
            disabled={submitting}
            className="min-h-[44px] w-full rounded-[--radius-sm] bg-primary px-5 py-3 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-50 sm:w-auto sm:py-2"
          >
            Looks good →
          </button>
        ) : (
          <button
            type="button"
            onClick={handleContinue}
            disabled={submitting}
            className="min-h-[44px] w-full rounded-[--radius-sm] bg-primary px-5 py-3 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-50 sm:w-auto sm:py-2"
          >
            {submitting ? "Saving…" : "Confirm — this is my work"}
          </button>
        )}
      </div>
    </div>
  );
}

/** Persistent file panel — sticky vertical strip on desktop, horizontal
 *  scroll on mobile. Each thumbnail opens a zoom modal so the student
 *  can pinch / read fine print without leaving the confirm screen. */
function FileStrip({
  files,
  onZoom,
}: {
  files: SubmissionFile[];
  onZoom: (f: SubmissionFile) => void;
}) {
  return (
    <div className="md:sticky md:top-4 md:max-h-[calc(100vh-2rem)] md:overflow-y-auto">
      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-text-muted">
        Your pages
      </div>
      <div className="flex gap-2 overflow-x-auto md:flex-col md:overflow-x-visible">
        {files.map((f, i) => (
          <FileThumbnail
            key={i}
            file={f}
            index={i}
            onClick={() => onZoom(f)}
          />
        ))}
      </div>
    </div>
  );
}

function FileThumbnail({
  file,
  index,
  onClick,
}: {
  file: SubmissionFile;
  index: number;
  onClick: () => void;
}) {
  const isPdf = file.media_type === "application/pdf";
  const dataUrl = `data:${file.media_type};base64,${file.data}`;
  const label = file.filename ?? `Page ${index + 1}`;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`View ${label}`}
      className="shrink-0 w-[120px] overflow-hidden rounded-[--radius-sm] border border-border-light hover:border-primary focus:border-primary focus:outline-none md:w-full"
    >
      {isPdf ? (
        <div className="flex flex-col items-center gap-1 bg-bg-subtle p-3 text-text-secondary">
          <FileTextIcon className="h-8 w-8" />
          <span className="max-w-full truncate text-[10px]">{label}</span>
          <span className="text-[10px] text-text-muted">PDF</span>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={dataUrl}
          alt={label}
          className="h-[120px] w-full bg-surface object-cover"
        />
      )}
      <div className="bg-bg-subtle px-2 py-0.5 text-center text-[10px] text-text-muted">
        Page {index + 1}
      </div>
    </button>
  );
}

/** Free-navigation problem nav. Dots for ≤7 problems, a thin progress
 *  bar broken into segments for 8+. Visited problems get a ✓; the
 *  active one is highlighted regardless. Tablist semantics so screen
 *  readers can announce "tab 3 of 14, selected". */
function ProblemPagination({
  total,
  active,
  visited,
  onSelect,
}: {
  total: number;
  active: number;
  visited: Set<number>;
  onSelect: (i: number) => void;
}) {
  if (total <= 1) return null;
  const useDots = total <= 7;
  if (useDots) {
    return (
      <div
        role="tablist"
        aria-label="Problems"
        className="flex flex-wrap items-center gap-2"
      >
        {Array.from({ length: total }, (_, i) => {
          const isActive = i === active;
          const wasVisited = visited.has(i);
          return (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={`Problem ${i + 1}${wasVisited ? ", visited" : ""}`}
              onClick={() => onSelect(i)}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors hover:ring-2 hover:ring-primary/40 ${
                isActive
                  ? "bg-primary text-white"
                  : wasVisited
                    ? "bg-primary-bg text-primary"
                    : "bg-bg-subtle text-text-muted"
              }`}
            >
              {wasVisited && !isActive ? "✓" : i + 1}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <div role="tablist" aria-label="Problems" className="flex items-center gap-1">
      {Array.from({ length: total }, (_, i) => {
        const isActive = i === active;
        const wasVisited = visited.has(i);
        return (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-label={`Problem ${i + 1}${wasVisited ? ", visited" : ""}`}
            onClick={() => onSelect(i)}
            className={`h-2 flex-1 rounded-full transition-colors hover:ring-2 hover:ring-primary/40 ${
              isActive
                ? "bg-primary"
                : wasVisited
                  ? "bg-primary/50"
                  : "bg-bg-subtle"
            }`}
          />
        );
      })}
    </div>
  );
}

/** One problem's body — extracted from the previous monolithic
 *  per-problem rendering loop, unchanged in semantics. The pagination
 *  passes a single group through; the editing flow per step / final
 *  answer is identical to the all-problems-at-once layout this
 *  component replaced. */
function ProblemBlock({
  group,
  edits,
  onSaveEdit,
  onClearEdit,
}: {
  group: ProblemGroup;
  edits: Record<string, string>;
  onSaveEdit: (key: string, text: string) => void;
  onClearEdit: (key: string) => void;
}) {
  return (
    <>
      {group.steps.length === 0 ? (
        <p className="mt-1 text-xs italic text-text-muted">
          No steps extracted for this problem.
        </p>
      ) : (
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-text-secondary">
          {group.steps.map((s, i) => {
            // "Other work" steps (position=null) can't be edited —
            // there's no problem_position to key the overlay by.
            if (group.position === null) {
              return (
                <li key={`${s.step_num}-${i}`}>
                  <ReadOnlyStepText step={s} />
                </li>
              );
            }
            const key = stepKey(group.position, s.step_num);
            const edited = edits[key] ?? null;
            // Edit the LaTeX source when present (what the student
            // actually wrote on the page), not plain_english (Vision's
            // narration *about* the step).
            const sourceIsLatex = !!(s.latex && s.latex.trim());
            return (
              <li key={`${s.step_num}-${i}`}>
                <EditableRow
                  editKey={key}
                  originalText={sourceIsLatex ? s.latex : s.plain_english}
                  editedText={edited}
                  ariaLabel={`step ${s.step_num} of problem ${group.position}`}
                  onSaveEdit={onSaveEdit}
                  onClearEdit={onClearEdit}
                  readOnlyDisplay={
                    edited !== null ? (
                      sourceIsLatex ? (
                        <MathText text={`$$${edited}$$`} />
                      ) : (
                        <span className="font-medium text-text-primary">
                          {edited}
                        </span>
                      )
                    ) : (
                      <ReadOnlyStepText step={s} />
                    )
                  }
                  originalDisplay={<ReadOnlyStepText step={s} />}
                />
              </li>
            );
          })}
        </ol>
      )}
      {group.finalAnswers.map((fa, i) => {
        if (group.position === null) {
          const latex = fa.answer_latex?.trim() ?? "";
          const plain = fa.answer_plain?.trim() ?? "";
          if (!latex && !plain) return null;
          return (
            <div
              key={`fa-${i}`}
              className="mt-2 rounded-[--radius-sm] border border-border-light bg-bg-subtle/50 px-3 py-2"
            >
              <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                Final answer
              </div>
              <div className="mt-1 text-sm text-text-primary">
                <ReadOnlyFinalAnswerText fa={fa} />
              </div>
            </div>
          );
        }
        const key = finalKey(group.position);
        const edited = edits[key] ?? null;
        const latex = fa.answer_latex?.trim() ?? "";
        const plain = fa.answer_plain?.trim() ?? "";
        if (!latex && !plain && edited === null) return null;
        const sourceIsLatex = !!latex;
        return (
          <div
            key={`fa-${i}`}
            className="mt-2 rounded-[--radius-sm] border border-border-light bg-bg-subtle/50 px-3 py-2"
          >
            <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
              Final answer
            </div>
            <div className="mt-1 text-sm text-text-primary">
              <EditableRow
                editKey={key}
                originalText={sourceIsLatex ? latex : plain}
                editedText={edited}
                ariaLabel={`final answer for problem ${group.position}`}
                onSaveEdit={onSaveEdit}
                onClearEdit={onClearEdit}
                readOnlyDisplay={
                  edited !== null ? (
                    sourceIsLatex ? (
                      <MathText text={`$$${edited}$$`} />
                    ) : (
                      <span>{edited}</span>
                    )
                  ) : (
                    <ReadOnlyFinalAnswerText fa={fa} />
                  )
                }
                originalDisplay={<ReadOnlyFinalAnswerText fa={fa} />}
              />
            </div>
          </div>
        );
      })}
    </>
  );
}

/** Click-to-zoom modal. Image: object-contain so aspect ratio holds.
 *  PDF: native browser embed at near-fullscreen so the student can
 *  scroll through pages. Backdrop click and × button both close. */
function FileZoomModal({
  file,
  onClose,
}: {
  file: SubmissionFile;
  onClose: () => void;
}) {
  const isPdf = file.media_type === "application/pdf";
  const dataUrl = `data:${file.media_type};base64,${file.data}`;
  const label = file.filename ?? "Submitted page";
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${label}`}
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close preview"
        className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-lg text-text-primary hover:bg-bg-subtle"
      >
        ×
      </button>
      <div
        className="max-h-[90vh] max-w-[90vw] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {isPdf ? (
          <embed
            src={dataUrl}
            type="application/pdf"
            className="h-[80vh] w-[80vw] rounded-[--radius-md] bg-white"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={dataUrl}
            alt={label}
            className="max-h-[90vh] max-w-[90vw] rounded-[--radius-md] object-contain"
          />
        )}
      </div>
    </div>
  );
}
