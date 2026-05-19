"use client";

import { useEffect, useState } from "react";
import {
  teacher,
  EntitlementError,
  DEFAULT_GENERATION_PARAMS,
  type BankJob,
  type GenerationParams,
  type TeacherDocument,
  type TeacherUnit,
} from "@/lib/api";
import { topUnits } from "@/lib/units";
import { useDocumentUploads } from "@/hooks/use-document-uploads";
import { useUpgradePrompt } from "@/hooks/use-upgrade-prompt";
import { SelectableChip } from "../_pieces/selectable-chip";
import { SourceMaterialPicker } from "../_pieces/source-material-picker";
import { QUANTITY_CHIPS } from "./constants";

// localStorage key for the Customize-section selections. Per-teacher
// scoping happens implicitly because each teacher logs in on their
// own browser session; cross-teacher leakage on a shared device is
// the same risk every other form has and is out of scope here.
const PARAMS_STORAGE_KEY = "veradic.generationParams";

// Labels + tooltip copy for the Customize dropdowns. Tied to the
// GenerationParams shape; defaults at index 0 of each list translate
// to "no prompt instruction" on the backend.
const PARAM_OPTIONS: {
  key: keyof GenerationParams;
  label: string;
  help: string;
  options: { value: string; label: string }[];
}[] = [
  {
    key: "problem_type",
    label: "Problem type",
    help: "What shape the problems take.",
    options: [
      { value: "mixed", label: "Mixed" },
      { value: "word", label: "Word problems only" },
      { value: "computation", label: "Computation only" },
      { value: "multi_step", label: "Multi-step" },
      { value: "proof", label: "Proofs" },
    ],
  },
  {
    key: "answer_form",
    label: "Answer form",
    help: "How final answers should be expressed.",
    options: [
      { value: "auto", label: "Auto" },
      { value: "radical", label: "Radical form" },
      { value: "rational_exponent", label: "Rational exponent" },
      { value: "exact", label: "Exact (no decimals)" },
      { value: "decimal_2", label: "Decimal · 2 sig figs" },
      { value: "decimal_3", label: "Decimal · 3 sig figs" },
    ],
  },
  {
    key: "difficulty",
    label: "Difficulty",
    help:
      "Difficulty is relative to this course's student level (not absolute math). " +
      "Ramp orders easy → hard across the set.",
    options: [
      { value: "mixed", label: "Mixed" },
      { value: "easy", label: "All easy" },
      { value: "medium", label: "All medium" },
      { value: "hard", label: "All hard" },
      { value: "ramp", label: "Easy → hard ramp" },
    ],
  },
  {
    key: "calculator",
    label: "Calculator",
    help:
      "No-calc problems keep numerics clean (standard angles, integer evals). " +
      "Calculator-allowed lets the AI use messy decimals freely.",
    options: [
      { value: "either", label: "Either" },
      { value: "no_calc", label: "No calculator" },
      { value: "calc_allowed", label: "Calculator allowed" },
    ],
  },
  {
    key: "format",
    label: "Format",
    help:
      "MCQ poses the problem with 4 choices the student picks between. " +
      "FRQ is open-ended.",
    options: [
      { value: "frq", label: "Free response" },
      { value: "mcq", label: "Multiple choice" },
    ],
  },
];

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
  // Customize-section selections. Hydrated from localStorage on mount
  // and saved on submit so AP teachers don't reselect their
  // preferences on every modal open. See PARAMS_STORAGE_KEY.
  const [params, setParams] = useState<GenerationParams>(DEFAULT_GENERATION_PARAMS);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showUpgrade, UpgradeModal } = useUpgradePrompt();

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(PARAMS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<GenerationParams>;
      // Defensive merge: ignore unknown keys / missing fields by
      // overlaying onto the defaults. Stops a stale localStorage entry
      // from breaking the form if we ever change the field set.
      // The set-state-in-effect lint exception mirrors SchoolDetail's
      // pattern for hydrate-on-mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setParams({ ...DEFAULT_GENERATION_PARAMS, ...parsed });
    } catch {
      // Corrupted JSON — ignore and stick with defaults.
    }
  }, []);

  const customizationCount = Object.entries(params).filter(
    ([k, v]) => v !== DEFAULT_GENERATION_PARAMS[k as keyof GenerationParams],
  ).length;

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
    // Persist the teacher's customizations so the next session
    // pre-fills with what they last used. Wrapped because some
    // browsers / private-mode tabs disallow localStorage writes.
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(PARAMS_STORAGE_KEY, JSON.stringify(params));
      }
    } catch {
      // Non-fatal — the modal works without persistence.
    }
    try {
      const job = await teacher.generateBank(courseId, {
        count,
        assignment_id: assignmentId,
        unit_id: savedTo,
        document_ids: Array.from(selectedDocs),
        constraint: constraint.trim() || null,
        // Only send params when the teacher actually customized
        // something — keeps audit logs clean for 1-click flows.
        params: customizationCount > 0 ? params : null,
      });
      onStarted(job);
    } catch (e) {
      if (e instanceof EntitlementError && e.isLimit) {
        showUpgrade(e.entitlement, e.message);
      } else {
        setError(e instanceof Error ? e.message : "Failed to start generation");
      }
      setSubmitting(false);
    }
  };

  const tops = units ? topUnits(units) : [];
  const pickerUnitIds = savedTo !== undefined ? [savedTo] : [];

  return (
    <>
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
              placeholder="e.g. word problems, real-world contexts, no calculators"
              disabled={submitting}
              className="mt-2 w-full resize-none rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
            />
          </div>

          <div className="rounded-[--radius-md] border border-border-light">
            <button
              type="button"
              onClick={() => setCustomizeOpen((v) => !v)}
              disabled={submitting}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-bold text-text-primary hover:bg-bg-subtle disabled:opacity-50"
              aria-expanded={customizeOpen}
            >
              <span className="flex items-center gap-2">
                <span>Customize</span>
                {customizationCount > 0 && (
                  <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-primary">
                    {customizationCount} active
                  </span>
                )}
                <span className="font-normal text-text-muted">· optional</span>
              </span>
              <span aria-hidden className="text-text-muted">
                {customizeOpen ? "▾" : "▸"}
              </span>
            </button>
            {customizeOpen && (
              <div className="border-t border-border-light p-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {PARAM_OPTIONS.map(({ key, label, help, options }) => (
                    <div key={key}>
                      <label
                        htmlFor={`gen-param-${key}`}
                        className="block text-[11px] font-bold uppercase tracking-wide text-text-muted"
                      >
                        {label}
                      </label>
                      <select
                        id={`gen-param-${key}`}
                        value={params[key]}
                        onChange={(e) =>
                          setParams((prev) => ({
                            ...prev,
                            [key]: e.target.value,
                          }) as GenerationParams)
                        }
                        disabled={submitting}
                        title={help}
                        className="mt-1 w-full rounded-[--radius-md] border border-border-light bg-bg-base px-2 py-1.5 text-sm text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
                      >
                        {options.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
                {customizationCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setParams(DEFAULT_GENERATION_PARAMS)}
                    disabled={submitting}
                    className="mt-3 text-[11px] text-text-muted hover:text-text-primary disabled:opacity-50"
                  >
                    Reset to defaults
                  </button>
                )}
              </div>
            )}
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
            <p className="text-[11px] text-[color:var(--color-warning-dark)]">
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
    {UpgradeModal}
    </>
  );
}
