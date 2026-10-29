"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import {
  teacher,
  type ClassRubric,
  type RubricSource,
  type TeacherRubric,
} from "@/lib/api";
import { CREDIT_DEFAULTS } from "@/lib/rubric";
import {
  InlineSavedHint,
  type SaveState,
} from "@/components/school/teacher/_pieces/inline-saved-hint";
import { GradingPreview } from "@/components/school/teacher/_pieces/grading-preview";

const COMMON_MISTAKES_PLACEHOLDER =
  "e.g. Sign errors when distributing; flipping the inequality direction when multiplying by negatives.";
const NOTES_PLACEHOLDER =
  "e.g. Problems 2–5: the graph must show two full periods. Take off 10 if it shows one.";

type RubricFieldName = "common_mistakes" | "notes";

// Null-sentinel buffer per field: null means "show the external value",
// a string means "user is actively typing in this field". Lifted into
// the parent card so the live preview pane can read the same values the
// teacher sees in the textareas.
type DraftMap = Record<RubricFieldName, string | null>;

const INITIAL_DRAFTS: DraftMap = {
  common_mistakes: null,
  notes: null,
};

export function GradingSetupCard({
  rubric,
  saveState,
  saveError,
  onChange,
  copyFromAssignmentId,
  courseId,
  linkToClassRubric = true,
  embedded = false,
}: {
  rubric: TeacherRubric | null;
  saveState: SaveState;
  saveError: string | null;
  onChange: (patch: Partial<TeacherRubric>) => void;
  /** When set, enables the "Copy from…" affordance that lets the teacher
   *  pull a rubric from another of their assignments. The id is the
   *  current assignment — excluded from the picker so a teacher can't
   *  "copy" a setup onto itself. Omit (the default) to render the card
   *  without the affordance, keeping non-opted-in call sites unchanged. */
  copyFromAssignmentId?: string;
  /** The homework's course. When set, the card lists the class's grading
   *  rules (which this homework inherits) with a per-homework skip, and
   *  the class's full/partial credit guidance in the preview. */
  courseId?: string;
  /** Link out to class settings (off where navigating away loses work). */
  linkToClassRubric?: boolean;
  /** Render as a block inside another card (the homework page's
   *  "Problems & grading") rather than as a card of its own. */
  embedded?: boolean;
}) {
  const [drafts, setDrafts] = useState<DraftMap>(INITIAL_DRAFTS);
  const classRubric = useClassRubric(courseId);
  const classRules =
    classRubric && classRubric !== "failed" ? classRubric.rules : classRubric;
  const credit = classRubric && classRubric !== "failed" ? classRubric : null;
  const skipped = rubric?.skipped_rule_ids ?? [];
  // Title of the source the teacher most recently copied from. Drives
  // the transient "Copied from {title}" confirmation. Cleared on the
  // next field edit so it doesn't linger as stale praise.
  const [copiedFrom, setCopiedFrom] = useState<string | null>(null);
  // The rubric save state is a single flag for the whole card. Tracking
  // which field most recently triggered a save lets us render the
  // "Saving…" / "✓ Saved" hint next to THAT field's label — closer to
  // the teacher's eye line than a panel-top hint.
  const [lastEdited, setLastEdited] = useState<RubricFieldName | "skipped" | null>(null);

  const externalFor = (field: RubricFieldName): string => rubric?.[field] ?? "";

  const displayed = (field: RubricFieldName): string =>
    drafts[field] ?? externalFor(field);

  const handleDraftChange = (field: RubricFieldName, text: string) => {
    setDrafts((d) => ({ ...d, [field]: text }));
    // The teacher is editing now — retire the "Copied from" note so it
    // doesn't claim authorship of text they've since changed.
    if (copiedFrom) setCopiedFrom(null);
  };

  // Copy another assignment's rubric text into this one. Both fields go
  // in the patch (undefined where the source has none) so the parent
  // REPLACES rather than merges — copying should mirror the source, not
  // layer it over leftover text. Resetting the local drafts first makes
  // the freshly-committed external values show immediately.
  const handleCopy = (source: RubricSource) => {
    setDrafts(INITIAL_DRAFTS);
    onChange({
      common_mistakes: source.rubric.common_mistakes,
      notes: source.rubric.notes,
    });
    setCopiedFrom(source.title);
  };

  const commitField = (field: RubricFieldName) => {
    const draft = drafts[field];
    if (draft === null) return; // user didn't touch this field
    const committed = draft;
    setDrafts((d) => ({ ...d, [field]: null }));
    if (committed === externalFor(field)) return;
    setLastEdited(field);
    // Whitespace-only → undefined so normalizeRubric in the parent drops
    // the field (unset rather than a padded string stored). Trimming
    // here avoids a useless round-trip for an input like "   ".
    onChange({
      [field]: committed.trim().length > 0 ? committed : undefined,
    } as Partial<TeacherRubric>);
  };

  const hintFor = (field: RubricFieldName) =>
    lastEdited === field ? (
      <InlineSavedHint state={saveState} errorMessage={saveError} />
    ) : null;

  const settingsHref = courseId ? `/school/teacher/courses/${courseId}?tab=settings` : null;
  const creditIsCustom = Boolean(credit?.full_credit || credit?.partial_credit);

  const heading = embedded ? (
    <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
      Rules for every problem
    </h3>
  ) : (
    <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
      Grading setup
    </h2>
  );

  const body = (
    <>
      <header className={embedded ? "" : "border-b border-border-light pb-3"}>
        <div className="flex items-start justify-between gap-3">
          {heading}
          {copyFromAssignmentId && (
            <CopyFromMenu
              currentAssignmentId={copyFromAssignmentId}
              onCopy={handleCopy}
            />
          )}
        </div>
        <p className="mt-1 text-xs text-text-secondary">
          The AI grades every problem with these, on top of its answer key.
        </p>
        <CopiedConfirmation title={copiedFrom} />
      </header>

      <div className="mt-4 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(240px,320px)]">
        <div className="space-y-4">
          {courseId && (
            <ClassRulesList
              state={classRules}
              skipped={skipped}
              onSkippedChange={(ids) => {
                setLastEdited("skipped");
                onChange({ skipped_rule_ids: ids });
              }}
              saveHint={
                lastEdited === "skipped" ? (
                  <InlineSavedHint state={saveState} errorMessage={saveError} />
                ) : null
              }
              settingsHref={linkToClassRubric ? settingsHref : null}
            />
          )}
          <OptionalField
            id="rubric-notes"
            label="Extra rules for this homework"
            help={courseId ? "If one disagrees with a class rule, this one wins." : undefined}
            placeholder={NOTES_PLACEHOLDER}
            value={displayed("notes")}
            onDraftChange={(v) => handleDraftChange("notes", v)}
            onBlur={() => commitField("notes")}
            rightSlot={hintFor("notes")}
          />
          <OptionalField
            id="rubric-common-mistakes"
            label="Common mistakes to watch for"
            placeholder={COMMON_MISTAKES_PLACEHOLDER}
            value={displayed("common_mistakes")}
            onDraftChange={(v) => handleDraftChange("common_mistakes", v)}
            onBlur={() => commitField("common_mistakes")}
            rightSlot={hintFor("common_mistakes")}
          />
          {courseId && (
            <p className="text-xs text-text-muted">
              Full and partial credit:{" "}
              {creditIsCustom ? "using your class settings" : "using the standard guidance"}
              {settingsHref && linkToClassRubric ? (
                <>
                  {" · "}
                  <Link
                    href={settingsHref}
                    className="font-semibold text-primary hover:underline"
                  >
                    Change
                  </Link>
                </>
              ) : (
                " · change it in class settings"
              )}
            </p>
          )}
        </div>
        <GradingPreview
          fullCredit={credit?.full_credit ?? CREDIT_DEFAULTS.full_credit}
          partialCredit={credit?.partial_credit ?? CREDIT_DEFAULTS.partial_credit}
          commonMistakes={displayed("common_mistakes")}
          notes={displayed("notes")}
          classRules={
            Array.isArray(classRules)
              ? classRules
                  .filter((r) => !skipped.includes(r.id))
                  .map((r) => `${r.text}${r.points === null ? "" : ` (−${r.points})`}`)
              : []
          }
        />
      </div>
    </>
  );

  if (embedded) {
    return <div className="mt-6 border-t border-border-light pt-5">{body}</div>;
  }
  return (
    <section className="mt-6 rounded-[--radius-xl] border border-border-light bg-surface p-6 shadow-sm">
      {body}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// Copy from… — a restrained affordance in the card header. Lets the
// teacher pull a previously-authored rubric off another of their
// assignments and drop it into this one, then tweak. Reuses existing
// Assignment.rubric data (via teacher.rubricSources) — no saved
// templates, no new storage. Lazily loads the source list on first open
// so the card costs nothing until the teacher reaches for it.
// ────────────────────────────────────────────────────────────────────

/** First non-empty rubric field, trimmed to a one-line hint so each
 *  picker row previews what it'll copy without unfurling the whole
 *  rubric. */
function rubricHint(r: TeacherRubric): string {
  const text = r.notes || r.common_mistakes || "";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 90 ? `${flat.slice(0, 90)}…` : flat;
}

function CopyFromMenu({
  currentAssignmentId,
  onCopy,
}: {
  currentAssignmentId: string;
  onCopy: (source: RubricSource) => void;
}) {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  // null = not yet loaded; [] = loaded, none available.
  const [sources, setSources] = useState<RubricSource[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Lazy-load the source list the first time the teacher opens the menu,
  // then keep it cached. Filter out the current assignment so a teacher
  // can't copy a setup onto itself. Fired from the toggle handler (not an
  // effect) so the fetch is a direct response to the click.
  const loadSources = () => {
    if (sources !== null || loading) return;
    setLoading(true);
    setError(false);
    teacher
      .rubricSources()
      .then((res) =>
        setSources(res.sources.filter((s) => s.id !== currentAssignmentId)),
      )
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) loadSources();
  };

  // Close on outside-click / Escape — standard popover dismissal.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted transition-colors hover:text-primary focus:text-primary focus:outline-none"
      >
        <span aria-hidden>⧉</span>
        Copy from…
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="absolute right-0 z-20 mt-2 w-[320px] origin-top-right overflow-hidden rounded-[--radius-lg] border border-border-light bg-surface shadow-lg"
          >
            <div className="border-b border-border-light px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                Reuse a grading setup
              </p>
            </div>
            <div className="max-h-[280px] overflow-y-auto py-1">
              {loading && (
                <p className="px-3 py-3 text-xs text-text-muted">Loading…</p>
              )}
              {error && (
                <p className="px-3 py-3 text-xs text-text-secondary">
                  Couldn&apos;t load your other setups. Try again.
                </p>
              )}
              {!loading && !error && sources?.length === 0 && (
                <p className="px-3 py-3 text-xs text-text-muted">
                  No saved setups yet — once you author a rubric on another
                  assignment, it&apos;ll show up here.
                </p>
              )}
              {!loading &&
                !error &&
                sources?.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onCopy(s);
                      setOpen(false);
                    }}
                    className="block w-full px-3 py-2.5 text-left transition-colors hover:bg-[color:var(--color-surface-alt-2)] focus:bg-[color:var(--color-surface-alt-2)] focus:outline-none"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] font-medium text-text-primary">
                        {s.title}
                      </span>
                      <span className="shrink-0 truncate text-[10px] uppercase tracking-wider text-text-muted">
                        {s.course_name}
                      </span>
                    </div>
                    {rubricHint(s.rubric) && (
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-text-secondary">
                        {rubricHint(s.rubric)}
                      </p>
                    )}
                  </button>
                ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Transient "Copied from {title}" line under the header copy. Animates
 *  in on copy and out when the teacher next edits a field (which clears
 *  the title in the parent). */
function CopiedConfirmation({ title }: { title: string | null }) {
  const reduceMotion = useReducedMotion();
  return (
    <AnimatePresence>
      {title && (
        <motion.p
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
          transition={{ duration: 0.18 }}
          className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-primary"
        >
          <span aria-hidden>✓</span>
          Copied from {title} — edit below to fit this assignment.
        </motion.p>
      )}
    </AnimatePresence>
  );
}

// ────────────────────────────────────────────────────────────────────
// Text field — Extra rules / Common mistakes. Blank by default with a
// guiding placeholder.
// ────────────────────────────────────────────────────────────────────

function OptionalField({
  id,
  label,
  help,
  placeholder,
  value,
  onDraftChange,
  onBlur,
  rightSlot,
}: {
  id: string;
  label: string;
  help?: string;
  placeholder: string;
  value: string;
  onDraftChange: (text: string) => void;
  onBlur: () => void;
  rightSlot?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label
          htmlFor={id}
          className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]"
        >
          {label}
        </label>
        {rightSlot}
      </div>
      {help && <p className="mt-0.5 text-xs text-text-muted">{help}</p>}
      <textarea
        id={id}
        value={value}
        onChange={(e) => onDraftChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        rows={2}
        className="mt-1.5 w-full resize-y rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none"
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// The class's grading rules, inherited by this homework. Each can be
// skipped for this homework only; skips save immediately with the rest
// of the rubric. Rules themselves are edited in class settings, so this
// list is read-only apart from the skip.
// ────────────────────────────────────────────────────────────────────

/** The course's rubric: null while loading, "failed", or the rubric.
 *  Idle (null forever) when there's no course to ask about. */
type ClassRubricState = ClassRubric | null | "failed";
type ClassRulesState = ClassRubric["rules"] | null | "failed";

function useClassRubric(courseId: string | undefined): ClassRubricState {
  // Keyed by course so a different course never shows the last one's
  // rubric while its own loads.
  const [loaded, setLoaded] = useState<{ courseId: string; value: ClassRubricState } | null>(null);
  useEffect(() => {
    if (!courseId) return;
    let cancelled = false;
    teacher
      .courseRubric(courseId)
      .then((res) => !cancelled && setLoaded({ courseId, value: res }))
      .catch(() => !cancelled && setLoaded({ courseId, value: "failed" }));
    return () => {
      cancelled = true;
    };
  }, [courseId]);
  return loaded && loaded.courseId === courseId ? loaded.value : null;
}

function ClassRulesList({
  state,
  skipped,
  onSkippedChange,
  saveHint,
  settingsHref,
}: {
  state: ClassRulesState;
  skipped: string[];
  onSkippedChange: (ids: string[]) => void;
  saveHint: React.ReactNode;
  /** Where "Edit class rules" goes; null hides it. */
  settingsHref: string | null;
}) {
  const failed = state === "failed";
  const rules = failed ? null : state;

  const skippedSet = new Set(skipped);
  const toggle = (id: string, skip: boolean) => {
    const next = new Set(skippedSet);
    if (skip) next.add(id);
    else next.delete(id);
    onSkippedChange([...next].sort());
  };

  return (
    <div className="rounded-[--radius-md] border border-border-light bg-bg-subtle/40 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="flex items-baseline gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
          Class rules
          <span className="normal-case tracking-normal">{saveHint}</span>
        </h4>
        {settingsHref && (
          <Link
            href={settingsHref}
            className="inline-flex min-h-10 items-center text-xs font-semibold text-primary hover:underline"
          >
            Edit class rules
          </Link>
        )}
      </div>
      {failed && (
        <p className="mt-2 text-xs text-text-secondary">
          Couldn&apos;t load your class rules. Refresh to try again.
        </p>
      )}
      {!failed && rules === null && <p className="mt-2 text-xs text-text-muted">Loading…</p>}
      {rules !== null && rules.length === 0 && (
        <p className="mt-2 text-xs text-text-secondary">
          No class rules yet. Rules you add in class settings — like units on final answers —
          apply to every homework.
        </p>
      )}
      {rules !== null && rules.length > 0 && (
        <ul className="mt-1 divide-y divide-border-light">
          {rules.map((r) => {
            const isSkipped = skippedSet.has(r.id);
            const boxId = `skip-rule-${r.id}`;
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span
                  className={`min-w-[12rem] flex-1 text-sm leading-snug ${
                    isSkipped ? "text-text-muted line-through" : "text-text-primary"
                  }`}
                >
                  {r.text}
                </span>
                <span
                  className="shrink-0 font-mono text-xs font-semibold text-text-secondary"
                  title={r.points === null ? "The AI decides how much to take off" : `${r.points} of the problem's points`}
                >
                  {r.points === null ? "AI sizes" : `−${r.points} pt${r.points === 1 ? "" : "s"}`}
                </span>
                <label
                  htmlFor={boxId}
                  className="flex min-h-10 shrink-0 cursor-pointer items-center gap-1.5 text-xs text-text-secondary"
                >
                  <input
                    id={boxId}
                    type="checkbox"
                    checked={isSkipped}
                    onChange={(e) => toggle(r.id, e.target.checked)}
                    aria-label={`Skip “${r.text}” for this homework`}
                    className="h-4 w-4 accent-[color:var(--color-primary)]"
                  />
                  Skip for this homework
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
