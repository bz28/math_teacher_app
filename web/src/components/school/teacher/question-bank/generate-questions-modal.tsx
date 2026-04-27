"use client";

import { useEffect, useState } from "react";
import {
  teacher,
  type BankJob,
  type TeacherDocument,
  type TeacherUnit,
} from "@/lib/api";
import { topUnits } from "@/lib/units";
import { useDocumentUploads } from "@/hooks/use-document-uploads";
import { SelectableChip } from "../_pieces/selectable-chip";
import { SourceMaterialPicker } from "../_pieces/source-material-picker";
import { QUANTITY_CHIPS } from "./constants";

/**
 * "Generate more" modal opened from the HW detail page.
 *
 * Aligns with the slim New Homework modal's shape: explicit unit
 * (here: "Save to") first, then count, then a focus hint, then a
 * unit-filtered SourceMaterialPicker. Generated questions are
 * stamped with `originating_assignment_id = assignmentId` and saved
 * under the picked unit's bank. Save-to is required — the
 * Uncategorized bucket was removed, so every generated item lives
 * under a real unit.
 */
export function GenerateQuestionsModal({
  courseId,
  assignmentId,
  onClose,
  onStarted,
}: {
  courseId: string;
  /** The HW the teacher is on — generation is always per-HW; this
   *  stamps each produced item with its originating homework. */
  assignmentId: string;
  onClose: () => void;
  onStarted: (job: BankJob) => void;
}) {
  const [units, setUnits] = useState<TeacherUnit[] | null>(null);
  const [docs, setDocs] = useState<TeacherDocument[]>([]);
  const [docsLoaded, setDocsLoaded] = useState(false);
  // Save-to state. undefined = no choice yet (Generate disabled);
  // string = a real unit id.
  const [savedTo, setSavedTo] = useState<string | undefined>(undefined);
  const [count, setCount] = useState<number>(10);
  const [countDraft, setCountDraft] = useState("10");
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [constraint, setConstraint] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploads = useDocumentUploads({
    courseId,
    // Uploads land in the picked Save-to. The picker (and its upload
    // affordance) only render when savedTo is set, so this is reached
    // with a real id; "" is a defensive fallback the backend rejects.
    getUnitId: () => savedTo ?? "",
    setDocs,
    setSelectedDocs,
  });

  useEffect(() => {
    let cancelled = false;
    teacher
      .units(courseId)
      .then((r) => {
        if (!cancelled) setUnits(r.units);
      })
      .catch(() => {
        if (!cancelled) setUnits([]);
      });
    teacher
      .documents(courseId)
      .then((r) => {
        if (!cancelled) setDocs(r.documents);
      })
      .catch(() => {
        // Non-fatal — picker degrades to empty state.
      })
      .finally(() => {
        if (!cancelled) setDocsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const onPickSavedTo = (next: string) => {
    if (next === savedTo) return;
    setSavedTo(next);
    // Switching the Save-to unit invalidates any selected docs from
    // the previous unit. The filtered picker would hide them anyway,
    // and forwarding cross-unit selections to the AI silently is the
    // surprise we want to avoid (matches slim HW modal's behavior).
    setSelectedDocs(new Set());
  };

  const clamp = (v: number) => Math.min(50, Math.max(1, Math.round(v)));

  const handleCountChange = (raw: string) => {
    setCountDraft(raw);
    const v = parseInt(raw, 10);
    if (!Number.isNaN(v)) setCount(clamp(v));
  };

  const handleCountBlur = () => {
    const v = parseInt(countDraft, 10);
    if (Number.isNaN(v)) setCountDraft(String(count));
    else setCountDraft(String(clamp(v)));
  };

  const readableSelectedCount = Array.from(selectedDocs).filter((id) => {
    const d = docs.find((x) => x.id === id);
    return d && d.file_type !== "application/pdf";
  }).length;
  const onlyPdfsSelected = selectedDocs.size > 0 && readableSelectedCount === 0;

  const hasChosenSavedTo = savedTo !== undefined;
  const canSubmit = !submitting && hasChosenSavedTo && !onlyPdfsSelected;

  const submit = async () => {
    if (savedTo === undefined) {
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
        assignment_id: assignmentId,
        unit_id: savedTo,
        document_ids: Array.from(selectedDocs),
        constraint: constraint.trim() || null,
      });
      onStarted(job);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start generation");
      setSubmitting(false);
    }
  };

  const tops = units ? topUnits(units) : [];
  const pickerUnitIds = savedTo !== undefined ? [savedTo] : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => {
        if (!submitting && !uploads.hasInflightUploads) onClose();
      }}
    >
      <form
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[--radius-xl] bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-center justify-between border-b border-border-light px-6 py-3">
          <h2 className="text-base font-bold text-text-primary">
            Generate more questions
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting || uploads.hasInflightUploads}
            aria-label="Close"
            className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-primary disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div>
            <label className="block text-sm font-bold text-text-primary">
              Save to <span className="text-red-500">*</span>
            </label>
            <p className="mt-1 text-[11px] text-text-muted">
              Pick the unit these questions belong to. They&apos;ll be
              organized under it in the question bank.
            </p>
            {units === null ? (
              <p className="mt-2 text-xs text-text-muted">Loading units…</p>
            ) : tops.length === 0 ? (
              <p className="mt-2 text-xs italic text-text-muted">
                No units yet. Create one in the Materials tab first.
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tops.map((u) => (
                  <SelectableChip
                    key={u.id}
                    label={u.name}
                    selected={savedTo === u.id}
                    // Block Save-to switches while uploads are in flight.
                    // Otherwise an in-flight upload's auto-select can land
                    // AFTER our switch's selectedDocs clear, leaving a
                    // freshly-uploaded doc id selected under a different
                    // unit and silently forwarded on submit.
                    disabled={submitting || uploads.hasInflightUploads}
                    onToggle={() => onPickSavedTo(u.id)}
                  />
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-bold text-text-primary">
              How many?
            </label>
            <div className="mt-2 flex items-center gap-2">
              {QUANTITY_CHIPS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    setCount(n);
                    setCountDraft(String(n));
                  }}
                  disabled={submitting}
                  aria-pressed={count === n}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    count === n
                      ? "bg-primary text-white"
                      : "bg-bg-subtle text-text-primary hover:bg-bg-base"
                  } disabled:opacity-50`}
                >
                  {n}
                </button>
              ))}
              <span className="text-[11px] text-text-muted">or</span>
              <input
                type="number"
                value={countDraft}
                min={1}
                max={50}
                aria-label="Custom quantity"
                onChange={(e) => handleCountChange(e.target.value)}
                onBlur={handleCountBlur}
                disabled={submitting}
                className="w-20 rounded-[--radius-md] border border-border-light bg-bg-base px-2 py-1 text-sm text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="generate-focus"
              className="block text-sm font-bold text-text-primary"
            >
              Focus{" "}
              <span className="font-normal text-text-muted">· optional</span>
            </label>
            <p className="mt-1 text-[11px] text-text-muted">
              Tell the AI what to emphasize.
            </p>
            <textarea
              id="generate-focus"
              value={constraint}
              onChange={(e) => setConstraint(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder='e.g. "word problems with friendly numbers, mostly medium difficulty"'
              disabled={submitting}
              className="mt-2 w-full resize-none rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
            />
          </div>

          {hasChosenSavedTo && (
            <SourceMaterialPicker
              courseId={courseId}
              docs={docs}
              docsLoaded={docsLoaded}
              selectedDocs={selectedDocs}
              unitIds={pickerUnitIds}
              units={units}
              onToggleDoc={(id) =>
                setSelectedDocs((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              pending={uploads.pending}
              onFilesSelected={uploads.handleFiles}
              onRetryPending={uploads.retryPending}
              onDismissPending={uploads.dismissPending}
              disabled={submitting}
              filterToSelectedUnits
            />
          )}

          {onlyPdfsSelected && (
            <p className="text-[11px] text-amber-600">
              Heads up: every selected doc is a PDF, which isn&apos;t
              readable yet. Pick at least one image or unselect everything.
            </p>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="flex items-center justify-end border-t border-border-light px-6 py-3">
          <button
            type="submit"
            disabled={!canSubmit}
            title={
              !hasChosenSavedTo
                ? "Pick a unit to save these questions to"
                : onlyPdfsSelected
                  ? "Selected docs are all PDFs — pick at least one image"
                  : ""
            }
            className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {submitting ? "Starting…" : "Generate ▸"}
          </button>
        </div>
      </form>
    </div>
  );
}
