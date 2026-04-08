"use client";

import { useEffect, useState } from "react";
import {
  teacher,
  type BankJob,
  type TeacherDocument,
  type TeacherUnit,
} from "@/lib/api";
import { subfoldersOf, topUnitIdOf, topUnits } from "@/lib/units";
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
  // Manual override of the auto-defaulted unit. Null until the teacher
  // explicitly picks. The actual `unitId` value is derived during render
  // — see `effectiveUnitId` below.
  const [overrideUnitId, setOverrideUnitId] = useState<string | null | undefined>(undefined);
  const [count, setCount] = useState<number>(20);
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Constraint — the hero */}
          <label className="block text-sm font-bold text-text-primary">
            What kind of questions do you want?
          </label>
          <textarea
            value={constraint}
            onChange={(e) => setConstraint(e.target.value)}
            rows={4}
            maxLength={500}
            autoFocus
            placeholder='e.g. "Only word problems with friendly numbers, match the textbook style, mostly medium difficulty"'
            className="mt-2 w-full resize-none rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
          />

          {/* Source materials — visual grid */}
          <div className="mt-6">
            <div className="flex items-baseline justify-between">
              <label className="text-sm font-bold text-text-primary">Source materials</label>
              <span className="text-[11px] text-text-muted">
                optional but recommended
              </span>
            </div>
            <p className="mt-1 text-[11px] text-text-muted">
              Pick the materials Claude should read. Without sources, generation falls back to
              the topic name only. PDFs aren&rsquo;t AI-readable yet.
            </p>

            {loading ? (
              <p className="mt-4 text-sm text-text-muted">Loading materials…</p>
            ) : docGroups.length === 0 ? (
              <div className="mt-3 rounded-[--radius-md] border border-dashed border-border-light bg-bg-subtle p-6 text-center text-xs text-text-muted">
                No materials uploaded yet. Add some in the Materials tab, or just leave this
                blank and use instructions only.
              </div>
            ) : (
              <div className="mt-3 space-y-4">
                {docGroups.map((group) => (
                  <div key={group.id}>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                      📁 {group.label}
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
          </div>

          {/* Quantity + Save-to footer row */}
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border-light pt-4">
            <div className="flex items-center gap-2">
              <label className="text-xs font-bold uppercase tracking-wider text-text-muted">
                How many?
              </label>
              <div className="flex gap-1">
                {QUANTITY_CHIPS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCount(n)}
                    className={`rounded-[--radius-pill] px-3 py-1 text-xs font-bold transition-colors ${
                      count === n
                        ? "bg-primary text-white"
                        : "border border-border-light text-text-secondary hover:bg-bg-subtle"
                    }`}
                  >
                    {n}
                  </button>
                ))}
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
                  className="w-14 rounded-[--radius-pill] border border-border-light bg-bg-base px-2 py-1 text-center text-xs font-bold text-text-primary focus:border-primary focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-bold uppercase tracking-wider text-text-muted">
                Save to
              </label>
              <select
                value={unitId ?? ""}
                onChange={(e) => setOverrideUnitId(e.target.value || null)}
                className="rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-1.5 text-xs text-text-primary focus:border-primary focus:outline-none"
              >
                <option value="">Uncategorized</option>
                {topUnits(units).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
          {onlyPdfsSelected && (
            <p className="mt-3 text-[11px] text-amber-600">
              Heads up: every selected doc is a PDF, which Claude can&rsquo;t read yet. Pick at
              least one image or unselect everything.
            </p>
          )}
        </div>

        {/* Footer — single primary action */}
        <div className="flex items-center justify-end border-t border-border-light px-6 py-3">
          <button
            type="submit"
            disabled={submitting || loading || onlyPdfsSelected}
            className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {submitting ? "Starting…" : "✨ Generate"}
          </button>
        </div>
      </form>
    </div>
  );
}

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
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={isPdf}
      title={isPdf ? "PDFs are not yet AI-readable" : doc.filename}
      className={`relative flex items-center gap-2 rounded-[--radius-md] border p-3 text-left text-xs transition-colors ${
        isPdf
          ? "cursor-not-allowed border-border-light bg-bg-subtle opacity-50"
          : selected
            ? "border-primary bg-primary-bg/40 text-primary"
            : "border-border-light bg-surface hover:border-primary/40 hover:bg-primary-bg/10"
      }`}
    >
      <span className="text-base">📄</span>
      <span className="min-w-0 flex-1 truncate font-semibold text-text-primary">
        {doc.filename}
      </span>
      {selected && !isPdf && (
        <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-white">
          ✓
        </span>
      )}
      {isPdf && (
        <span className="absolute right-1.5 top-1.5 rounded-[--radius-pill] bg-text-muted/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-text-muted">
          skip
        </span>
      )}
    </button>
  );
}
