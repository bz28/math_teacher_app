"use client";

import { useEffect, useState } from "react";
import {
  teacher,
  type BankJob,
  type TeacherDocument,
  type TeacherUnit,
} from "@/lib/api";
import { subfoldersOf, topUnitIdOf, topUnits } from "@/lib/units";
import { SelectableChip } from "../_pieces/selectable-chip";
import { cn } from "@/lib/utils";
import { QUANTITY_CHIPS } from "./constants";

export function GenerateQuestionsModal({
  courseId,
  onClose,
  onStarted,
}: {
  courseId: string;
  onClose: () => void;
  onStarted: (job: BankJob) => void;
}) {
  const [units, setUnits] = useState<TeacherUnit[]>([]);
  const [docs, setDocs] = useState<TeacherDocument[]>([]);
  // Save-to state machine.
  //
  //   undefined = no override, fall through to autoUnitId (smart default)
  //   null      = teacher EXPLICITLY picked Uncategorized
  //   string    = teacher EXPLICITLY picked a unit
  //
  // The "no choice yet" state is (overrideUnitId === undefined && autoUnitId === null).
  // We use this to disable Generate so a teacher can't accidentally
  // dump questions into Uncategorized just because they didn't notice
  // the picker.
  const [overrideUnitId, setOverrideUnitId] = useState<string | null | undefined>(undefined);
  const [count, setCount] = useState<number>(10);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [constraint, setConstraint] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([teacher.units(courseId), teacher.documents(courseId)])
      .then(([u, d]) => {
        setUnits(u.units);
        setDocs(d.documents);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load materials"))
      .finally(() => setLoading(false));
  }, [courseId]);

  const toggleDoc = (id: string) => {
    setSelectedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const docsIn = (uid: string | null) => docs.filter((d) => d.unit_id === uid);

  // Smart "Save to" default, derived during render. Bank questions
  // can only live at the top-unit level, so we roll each selected
  // doc's unit_id up to its top before deciding whether they share
  // one. Picking a doc inside "math / algebra" defaults Save-to to
  // "math", not "math / algebra".
  const autoUnitId: string | null = (() => {
    if (selectedDocs.size === 0) return null;
    const selected = docs.filter((d) => selectedDocs.has(d.id));
    const shared = topUnitIdOf(units, selected[0]?.unit_id ?? null);
    return selected.every((d) => topUnitIdOf(units, d.unit_id) === shared)
      ? shared
      : null;
  })();
  const unitId = overrideUnitId === undefined ? autoUnitId : overrideUnitId;
  // True only when the smart default fired AND the teacher hasn't
  // manually picked anything since. Drives the "auto" hint badge.
  const autoApplied = overrideUnitId === undefined && autoUnitId !== null;
  // True iff the teacher has made (or inherited) a real choice — either
  // a unit, an explicit Uncategorized, or an auto-default. Drives the
  // Generate button enable + the placeholder copy.
  const hasChosenSaveTo =
    overrideUnitId !== undefined || autoUnitId !== null;
  // Explicit Uncategorized = teacher actively picked it. We surface a
  // small warning so they know what they signed up for.
  const explicitUncategorized = overrideUnitId === null;

  const readableSelectedCount = Array.from(selectedDocs).filter((id) => {
    const d = docs.find((x) => x.id === id);
    return d && d.file_type !== "application/pdf";
  }).length;
  const onlyPdfsSelected = selectedDocs.size > 0 && readableSelectedCount === 0;

  const submit = async () => {
    if (count < 1 || count > 50) {
      setError("Pick a quantity");
      return;
    }
    if (!hasChosenSaveTo) {
      setError("Pick a unit to save these questions to");
      return;
    }
    if (onlyPdfsSelected) {
      setError(
        "Selected documents are all PDFs (skipped). Pick at least one image, or unselect all to generate from the unit name only.",
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const job = await teacher.generateBank(courseId, {
        count,
        unit_id: unitId,
        document_ids: Array.from(selectedDocs),
        constraint: constraint.trim() || null,
      });
      onStarted(job);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start generation");
      setSubmitting(false);
    }
  };

  // Build all the doc-display groups upfront. Each group is a unit (or
  // "Uncategorized") with its docs. Subfolders are flattened with a
  // breadcrumb in the header.
  const docGroups = (() => {
    const groups: { id: string; label: string; docs: TeacherDocument[] }[] = [];
    const uncategorized = docsIn(null);
    if (uncategorized.length > 0) {
      groups.push({ id: "uncategorized", label: "Uncategorized", docs: uncategorized });
    }
    for (const top of topUnits(units)) {
      const topDocs = docsIn(top.id);
      if (topDocs.length > 0) {
        groups.push({ id: top.id, label: top.name, docs: topDocs });
      }
      for (const sub of subfoldersOf(units, top.id)) {
        const subDocs = docsIn(sub.id);
        if (subDocs.length > 0) {
          groups.push({ id: sub.id, label: `${top.name} / ${sub.name}`, docs: subDocs });
        }
      }
    }
    return groups;
  })();

  const isCustomCount = !(
    QUANTITY_CHIPS as readonly number[]
  ).includes(count);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <form
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-[--radius-xl] bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-light px-6 py-3">
          <h2 className="text-base font-bold text-text-primary">Generate Questions</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-primary disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {/* Body — each zone gets the same bordered card treatment so
            the form reads as distinct blocks, not one long column. */}
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {/* Prompt / constraint */}
          <label className="block">
            <span className="text-sm font-bold text-text-primary">
              What kind of questions do you want?
            </span>
            <textarea
              value={constraint}
              onChange={(e) => setConstraint(e.target.value)}
              rows={4}
              maxLength={500}
              autoFocus
              placeholder='e.g. "Only word problems with friendly numbers, match the textbook style, mostly medium difficulty"'
              className="mt-2 w-full resize-none rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
            />
          </label>

          {/* Source materials */}
          <section className="rounded-[--radius-lg] border border-border-light bg-bg-base/40 p-4">
            <div className="flex items-baseline justify-between gap-2">
              <label className="text-sm font-bold text-text-primary">
                Source materials
              </label>
              <span className="text-[11px] text-text-muted">
                optional but recommended
              </span>
            </div>
            <p className="mt-1 text-[11px] text-text-muted">
              Pick the materials Veradic should read. Without sources, generation falls
              back to the topic name only. PDFs aren&rsquo;t readable yet.
            </p>

            {loading ? (
              <p className="mt-4 text-sm text-text-muted">Loading materials…</p>
            ) : docGroups.length === 0 ? (
              <div className="mt-3 rounded-[--radius-md] border border-dashed border-border-light bg-bg-subtle p-6 text-center text-xs text-text-muted">
                No materials uploaded yet. Add some in the Materials tab, or just leave
                this blank and use instructions only.
              </div>
            ) : (
              <div className="mt-3 space-y-4">
                {docGroups.map((group) => (
                  <div key={group.id}>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-text-primary">
                      {group.label}
                      <span className="ml-1 font-normal text-text-muted">
                        · {group.docs.length}{" "}
                        {group.docs.length === 1 ? "document" : "documents"}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {group.docs.map((d) => (
                        <DocCard
                          key={d.id}
                          doc={d}
                          selected={selectedDocs.has(d.id)}
                          onToggle={() => toggleDoc(d.id)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {onlyPdfsSelected && (
              <p className="mt-3 text-[11px] text-amber-600">
                Heads up: every selected doc is a PDF, which isn&rsquo;t readable yet.
                Pick at least one image or unselect everything.
              </p>
            )}
          </section>

          {/* Quantity */}
          <section className="rounded-[--radius-lg] border border-border-light bg-bg-base/40 p-4">
            <label className="text-sm font-bold text-text-primary">How many?</label>
            <p className="mt-1 text-[11px] text-text-muted">
              Pick a preset or type a custom number (up to 50).
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {QUANTITY_CHIPS.map((n) => (
                <QuantityChip
                  key={n}
                  label={String(n)}
                  selected={count === n}
                  onClick={() => setCount(n)}
                />
              ))}
              {isCustomCount ? (
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={count}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10);
                    if (Number.isFinite(n)) setCount(Math.max(1, Math.min(50, n)));
                  }}
                  aria-label="Custom quantity"
                  className="w-16 rounded-[--radius-pill] border border-primary bg-primary-bg/30 px-2 py-1.5 text-center text-xs font-bold text-primary focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              ) : (
                <QuantityChip
                  label="Custom"
                  selected={false}
                  onClick={() => setCount(3)}
                  dashed
                />
              )}
            </div>
          </section>

          {/* Save to */}
          <section className="rounded-[--radius-lg] border border-border-light bg-bg-base/40 p-4">
            <label className="text-sm font-bold text-text-primary">
              Save to <span className="text-red-500">*</span>
            </label>
            <p className="mt-1 text-[11px] text-text-muted">
              Pick the unit these questions belong to. They&rsquo;ll be organized
              under it in the question bank and available when you build a homework
              for that unit.
            </p>

            {topUnits(units).length === 0 ? (
              <div className="mt-3 rounded-[--radius-md] border border-dashed border-border-light bg-bg-subtle p-3 text-center text-xs italic text-text-muted">
                No units yet. Create one in the Materials tab first, then come back
                to generate questions.
              </div>
            ) : (
              <>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {topUnits(units).map((u) => {
                    const isActive = unitId === u.id;
                    return (
                      <SelectableChip
                        key={u.id}
                        label={u.name}
                        selected={isActive}
                        onToggle={() => setOverrideUnitId(u.id)}
                        hint={autoApplied && isActive ? "auto" : undefined}
                      />
                    );
                  })}
                  <SelectableChip
                    label="Uncategorized"
                    selected={explicitUncategorized}
                    onToggle={() => setOverrideUnitId(null)}
                    variant="dashed"
                  />
                </div>

                {!hasChosenSaveTo && (
                  <p className="mt-2 text-[11px] italic text-text-muted">
                    Pick a unit (or Uncategorized) to enable Generate.
                  </p>
                )}
                {explicitUncategorized && (
                  <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                    Heads up: these questions won&rsquo;t be organized under any unit
                    and won&rsquo;t show up when filtering by unit. You can move them
                    later.
                  </p>
                )}
              </>
            )}
          </section>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        {/* Footer — single primary action */}
        <div className="flex items-center justify-end border-t border-border-light px-6 py-3">
          <button
            type="submit"
            disabled={
              submitting || loading || onlyPdfsSelected || !hasChosenSaveTo
            }
            title={
              !hasChosenSaveTo
                ? "Pick a unit to save these questions to"
                : onlyPdfsSelected
                  ? "Selected docs are all PDFs — pick at least one image"
                  : ""
            }
            className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {submitting ? "Starting…" : "Generate"}
          </button>
        </div>
      </form>
    </div>
  );
}

// Quantity picker uses its own chip rather than SelectableChip because
// it's single-select-with-clear (picking another replaces the current
// pick, no ✓ needed) and "Custom" uses a dashed treatment. Keeping
// this local lets SelectableChip stay the right shape for unit
// pickers where the ✓ matters.
function QuantityChip({
  label,
  selected,
  onClick,
  dashed = false,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  dashed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "rounded-[--radius-pill] px-3 py-1.5 text-xs font-bold transition-colors",
        dashed
          ? "border border-dashed border-text-muted/50 text-text-muted hover:bg-bg-subtle"
          : selected
            ? "border border-primary bg-primary text-white"
            : "border border-border-light bg-surface text-text-secondary hover:border-primary/40 hover:bg-bg-subtle",
      )}
    >
      {label}
    </button>
  );
}

// Readable docs render with the image icon + clickable state; PDFs
// render grayed out with a "SKIP" badge since they aren't OCR-able
// yet. Both keep the same layout — left icon, filename + meta, right
// check circle — so the grid reads evenly.
function DocCard({
  doc,
  selected,
  onToggle,
}: {
  doc: TeacherDocument;
  selected: boolean;
  onToggle: () => void;
}) {
  const isPdf = doc.file_type === "application/pdf";
  const extension = extensionOf(doc.filename, doc.file_type);
  const sizeLabel = formatFileSize(doc.file_size);

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={isPdf}
      title={isPdf ? "PDFs are not yet AI-readable" : doc.filename}
      aria-pressed={!isPdf && selected}
      className={cn(
        "group relative flex items-start gap-3 rounded-[--radius-md] border p-3 text-left transition-colors",
        isPdf
          ? "cursor-not-allowed border-border-light bg-bg-subtle/60"
          : selected
            ? "border-primary bg-primary-bg/40"
            : "border-border-light bg-surface hover:border-primary/40 hover:bg-primary-bg/10",
      )}
    >
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-[--radius-sm]",
          isPdf
            ? "bg-bg-subtle text-text-muted"
            : "bg-primary-bg/60 text-primary",
        )}
        aria-hidden
      >
        {isPdf ? <PdfIcon /> : <ImageIcon />}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-xs font-semibold",
            isPdf ? "text-text-muted" : "text-text-primary",
          )}
        >
          {doc.filename}
        </div>
        <div className="mt-0.5 text-[10px] text-text-muted">
          {extension}
          {sizeLabel && <span> · {sizeLabel}</span>}
        </div>
      </div>
      {isPdf ? (
        <span className="rounded-[--radius-pill] bg-text-muted/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-text-muted">
          skip
        </span>
      ) : (
        <CheckCircle selected={selected} />
      )}
    </button>
  );
}

function CheckCircle({ selected }: { selected: boolean }) {
  return (
    <span
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
        selected
          ? "border-primary bg-primary text-white"
          : "border-border bg-surface text-transparent group-hover:border-primary/60",
      )}
      aria-hidden
    >
      <svg
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-3 w-3"
      >
        <path
          fillRule="evenodd"
          d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.41 0l-3.5-3.5a1 1 0 011.41-1.42l2.795 2.793 6.796-6.793a1 1 0 011.41 0z"
          clipRule="evenodd"
        />
      </svg>
    </span>
  );
}

function ImageIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}

function PdfIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

// --- helpers ---------------------------------------------------------

function extensionOf(filename: string, fileType: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot > 0 && dot < filename.length - 1) {
    return filename.slice(dot + 1).toLowerCase();
  }
  // Fall back to the MIME type's subtype.
  const slash = fileType.indexOf("/");
  return slash >= 0 ? fileType.slice(slash + 1).toLowerCase() : fileType;
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}
