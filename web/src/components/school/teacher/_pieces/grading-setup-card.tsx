"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { teacher, type RubricSource, type TeacherRubric } from "@/lib/api";
import {
  InlineSavedHint,
  type SaveState,
} from "@/components/school/teacher/_pieces/inline-saved-hint";
import { GradingPreview } from "@/components/school/teacher/_pieces/grading-preview";

// Default rubric text shown pre-filled in the two primary fields.
//
// KEEP IN SYNC with the backend fallbacks in
// api/core/grading_ai.py::_DEFAULT_FULL_CREDIT / _DEFAULT_PARTIAL_CREDIT.
// When the teacher doesn't edit, the stored rubric stays null and the
// backend falls back to this same text — so what the teacher sees here
// is exactly what the AI grader applies.
export const GRADING_SETUP_DEFAULTS = {
  full_credit:
    "Correct final answer (mathematically equivalent forms like 1/2 and 0.5 both count). Enough work shown that the reasoning is followable — students can skip routine or mental steps as long as the path from set-up to answer is unambiguous to the grader, with no non-obvious leaps. A bare final answer with no set-up doesn't qualify.",
  partial_credit:
    "Anchor partial credit on how much of the correct reasoning is intact. Right approach with a small execution error (sign flip, arithmetic slip) — around 95%. Right approach with multiple errors or stopped mid-solution — around 60%. Right setup but substantially incomplete, or a plausible attempt with a wrong method — around 30%. Use judgment between these anchors. Incoherent attempts that show no sign of the right concept are zero, not partial.",
} as const;

const COMMON_MISTAKES_PLACEHOLDER =
  "e.g. Sign errors when distributing; flipping the inequality direction when multiplying by negatives.";
const NOTES_PLACEHOLDER = "Anything else the AI grader should know.";

type RubricFieldName =
  | "full_credit"
  | "partial_credit"
  | "common_mistakes"
  | "notes";

// Null-sentinel buffer per field: null means "show the external value",
// a string means "user is actively typing in this field". Lifted into
// the parent card so the live preview pane can read the same values the
// teacher sees in the textareas.
type DraftMap = Record<RubricFieldName, string | null>;

const INITIAL_DRAFTS: DraftMap = {
  full_credit: null,
  partial_credit: null,
  common_mistakes: null,
  notes: null,
};

export function GradingSetupCard({
  rubric,
  saveState,
  saveError,
  onChange,
  copyFromAssignmentId,
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
}) {
  const [drafts, setDrafts] = useState<DraftMap>(INITIAL_DRAFTS);
  // Title of the source the teacher most recently copied from. Drives
  // the transient "Copied from {title}" confirmation. Cleared on the
  // next field edit so it doesn't linger as stale praise.
  const [copiedFrom, setCopiedFrom] = useState<string | null>(null);
  // The rubric save state is a single flag for the whole card. Tracking
  // which field most recently triggered a save lets us render the
  // "Saving…" / "✓ Saved" hint next to THAT field's label — closer to
  // the teacher's eye line than a panel-top hint.
  const [lastEdited, setLastEdited] = useState<RubricFieldName | null>(null);

  const externalFor = (field: RubricFieldName): string => {
    if (field === "full_credit")
      return rubric?.full_credit ?? GRADING_SETUP_DEFAULTS.full_credit;
    if (field === "partial_credit")
      return rubric?.partial_credit ?? GRADING_SETUP_DEFAULTS.partial_credit;
    if (field === "common_mistakes") return rubric?.common_mistakes ?? "";
    return rubric?.notes ?? "";
  };

  const displayed = (field: RubricFieldName): string =>
    drafts[field] ?? externalFor(field);

  const handleDraftChange = (field: RubricFieldName, text: string) => {
    setDrafts((d) => ({ ...d, [field]: text }));
    // The teacher is editing now — retire the "Copied from" note so it
    // doesn't claim authorship of text they've since changed.
    if (copiedFrom) setCopiedFrom(null);
  };

  // Copy another assignment's rubric wholesale into this one. We pass an
  // explicit patch for ALL four fields (undefined where the source has
  // none) so the parent REPLACES rather than merges — copying should
  // mirror the source, not layer it over leftover text. Resetting the
  // local drafts first makes the freshly-committed external values show
  // in the textareas immediately.
  const handleCopy = (source: RubricSource) => {
    setDrafts(INITIAL_DRAFTS);
    onChange({
      full_credit: source.rubric.full_credit,
      partial_credit: source.rubric.partial_credit,
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
    const external = externalFor(field);
    if (committed === external) return;
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

  // "Using default" surfaces on a primary field whenever the displayed
  // text equals the hardcoded default AND the teacher isn't actively
  // typing — i.e., the backend will fall back to the default because
  // the teacher either never edited or explicitly cleared their
  // custom text. Tells them "your delete worked — you're now on the
  // default" instead of leaving them wondering why the default text
  // reappeared after they cleared it.
  const isUsingDefault = (field: "full_credit" | "partial_credit"): boolean => {
    if (drafts[field] !== null) return false; // teacher is typing
    return (rubric?.[field] ?? null) === null;
  };

  return (
    <section className="mt-6 rounded-[--radius-xl] border border-border-light bg-surface p-6 shadow-sm">
      <header className="border-b border-border-light pb-3">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)]">
            Grading setup
          </h2>
          {copyFromAssignmentId && (
            <CopyFromMenu
              currentAssignmentId={copyFromAssignmentId}
              onCopy={handleCopy}
            />
          )}
        </div>
        <p className="mt-1 text-xs text-text-secondary">
          Tell the AI how to grade. We&apos;ve filled in sensible defaults
          — edit to match how you grade.
        </p>
        <CopiedConfirmation title={copiedFrom} />
      </header>

      <div className="mt-4 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(260px,340px)]">
        <div className="space-y-4">
          <PrimaryField
            id="rubric-full-credit"
            label="Full credit"
            usingDefault={isUsingDefault("full_credit")}
            value={displayed("full_credit")}
            onDraftChange={(v) => handleDraftChange("full_credit", v)}
            onBlur={() => commitField("full_credit")}
            rightSlot={hintFor("full_credit")}
          />
          <PrimaryField
            id="rubric-partial-credit"
            label="Partial credit"
            usingDefault={isUsingDefault("partial_credit")}
            value={displayed("partial_credit")}
            onDraftChange={(v) => handleDraftChange("partial_credit", v)}
            onBlur={() => commitField("partial_credit")}
            rightSlot={hintFor("partial_credit")}
          />
          <OptionalDetails
            // Open by default when either optional field already has a
            // stored value — otherwise the teacher would have to dig
            // to find their own text after reloading.
            hasContent={
              Boolean(rubric?.common_mistakes) || Boolean(rubric?.notes)
            }
          >
            <OptionalField
              id="rubric-common-mistakes"
              label="Common mistakes"
              placeholder={COMMON_MISTAKES_PLACEHOLDER}
              value={displayed("common_mistakes")}
              onDraftChange={(v) => handleDraftChange("common_mistakes", v)}
              onBlur={() => commitField("common_mistakes")}
              rightSlot={hintFor("common_mistakes")}
            />
            <OptionalField
              id="rubric-notes"
              label="Notes"
              placeholder={NOTES_PLACEHOLDER}
              value={displayed("notes")}
              onDraftChange={(v) => handleDraftChange("notes", v)}
              onBlur={() => commitField("notes")}
              rightSlot={hintFor("notes")}
            />
          </OptionalDetails>
        </div>
        <GradingPreview
          fullCredit={displayed("full_credit")}
          partialCredit={displayed("partial_credit")}
          commonMistakes={displayed("common_mistakes")}
          notes={displayed("notes")}
        />
      </div>
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
  const text =
    r.full_credit || r.partial_credit || r.common_mistakes || r.notes || "";
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
// Primary field — Full credit / Partial credit. Pre-filled with a
// default the teacher can accept verbatim or edit. Larger textarea +
// stronger label weight than OptionalField. Controlled — parent owns
// the buffer.
// ────────────────────────────────────────────────────────────────────

function PrimaryField({
  id,
  label,
  value,
  usingDefault,
  onDraftChange,
  onBlur,
  rightSlot,
}: {
  id: string;
  label: string;
  value: string;
  usingDefault: boolean;
  onDraftChange: (text: string) => void;
  onBlur: () => void;
  rightSlot?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label
          htmlFor={id}
          className="flex items-baseline gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-primary"
        >
          <span>{label}</span>
          {usingDefault && (
            <span className="font-normal normal-case tracking-normal text-text-muted">
              · using default
            </span>
          )}
        </label>
        {rightSlot}
      </div>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onDraftChange(e.target.value)}
        onBlur={onBlur}
        rows={3}
        className="mt-1.5 w-full resize-y rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm leading-relaxed text-text-primary focus:border-primary focus:outline-none"
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Collapsible wrapper for Common mistakes + Notes. Collapsed by default
// to keep the rubric card scannable — most teachers won't need these,
// and when they do, one click away is fine. Auto-opens when either
// field already has saved content so the teacher's own text isn't
// hidden behind a chevron after reload.
// ────────────────────────────────────────────────────────────────────

function OptionalDetails({
  hasContent,
  children,
}: {
  hasContent: boolean;
  children: React.ReactNode;
}) {
  // Auto-open when either optional field already has saved content, so
  // a teacher's own text isn't hidden behind a chevron on reload. The
  // chevron reflects open state so the glyph stays honest.
  const [open, setOpen] = useState(hasContent);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="rounded-[--radius-md] border border-border-light bg-bg-subtle/40"
    >
      <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-text-secondary)] hover:text-text-primary">
        <span aria-hidden className="text-xs">{open ? "▾" : "▸"}</span>
        Optional details
        <span className="font-normal normal-case tracking-normal text-text-muted/80">
          · Common mistakes, Notes
        </span>
      </summary>
      <div className="space-y-4 border-t border-border-light p-3">
        {children}
      </div>
    </details>
  );
}

// ────────────────────────────────────────────────────────────────────
// Optional field — Common mistakes / Notes. Blank by default with a
// guiding placeholder. Smaller + muted label vs PrimaryField.
// ────────────────────────────────────────────────────────────────────

function OptionalField({
  id,
  label,
  placeholder,
  value,
  onDraftChange,
  onBlur,
  rightSlot,
}: {
  id: string;
  label: string;
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
