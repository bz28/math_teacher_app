"use client";

import { useEffect, useState } from "react";
import { teacher, type TeacherDocument, type TeacherUnit } from "@/lib/api";
import { topUnits } from "@/lib/units";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import { useDocumentUploads } from "@/hooks/use-document-uploads";
import { SelectableChip } from "./selectable-chip";
import { SourceMaterialPicker } from "./source-material-picker";

/**
 * Single-screen creation modal for a draft homework.
 *
 * The modal collects only what the AI generator actually consumes —
 * title, unit, problem count, focus hint, and reference files. Due
 * date, late policy, and section assignment are intentionally absent;
 * they aren't read by generation and are editable on the HW detail
 * page where the teacher lands next, so asking them here is double
 * work. Defaults handle them silently (late_policy="none"; due_at
 * null; sections fan out to "all" at publish time).
 *
 * Two CTAs:
 *   - Generate problems  → kicks off a bank gen job for the selected
 *     unit, routes to the review queue (its skeleton handles the wait).
 *   - Create empty draft → creates the HW with no problems and routes
 *     straight to the detail page.
 */

const QUANTITY_CHIPS = [5, 10, 15, 20] as const;

export function NewHomeworkModal({
  courseId,
  defaultUnitIds = [],
  onClose,
  onCreated,
}: {
  courseId: string;
  /** Pre-select this unit (e.g. the unit currently filtered in the
   *  HW list). Single-select — only the first id is honored. */
  defaultUnitIds?: string[];
  onClose: () => void;
  /** Fired with the newly-created HW id after a successful create.
   *  `startedGeneration` lets the parent route a generating HW
   *  straight to the review queue and an empty draft to detail. */
  onCreated: (
    newAssignmentId: string,
    opts: { startedGeneration: boolean },
  ) => void;
}) {
  const { busy, error, run } = useAsyncAction();

  const [title, setTitle] = useState("");
  const [unitId, setUnitId] = useState<string | null>(
    defaultUnitIds[0] ?? null,
  );
  const [count, setCount] = useState<number>(10);
  const [countDraft, setCountDraft] = useState("10");
  const [topicHint, setTopicHint] = useState("");

  const [units, setUnits] = useState<TeacherUnit[] | null>(null);
  const [docs, setDocs] = useState<TeacherDocument[]>([]);
  const [docsLoaded, setDocsLoaded] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());

  // Inline document uploads. Owned at the modal so the pending rows
  // survive the picker remounting when the unit switches. Uploads
  // land in the currently-picked unit; the picker only renders
  // after a unit is picked, so unitId is non-null whenever Upload
  // is reachable. Upload-during-unit-switch race is closed by
  // disabling the unit chips while `hasInflightUploads` is true.
  const uploads = useDocumentUploads({
    courseId,
    getUnitId: () => unitId ?? "",
    setDocs,
    setSelectedDocs,
  });

  // Load units + docs eagerly on mount. Both are tiny lists scoped to
  // the course; pre-loading avoids a flash of empty UI when the
  // teacher picks a unit and expects materials to appear instantly.
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
        if (cancelled) return;
        setDocs(r.documents);
      })
      .catch(() => {
        // Non-fatal — docs are optional context for generation.
      })
      .finally(() => {
        if (!cancelled) setDocsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const onPickUnit = (id: string) => {
    if (id === unitId) return;
    setUnitId(id);
    // Switching unit invalidates any selected reference files —
    // forwarding files from another unit to the AI generator would
    // ignore the unit the teacher just picked. Cheaper than a confirm
    // dialog and matches the picker's filter-mode default view.
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

  const createDraft = async (): Promise<string> => {
    // Both submit buttons are `disabled` until title + unitId are
    // present (see button props below), so unitId is non-null here.
    if (!unitId) throw new Error("Pick a unit");
    const created = await teacher.createAssignment(courseId, {
      title: title.trim(),
      type: "homework",
      unit_ids: [unitId],
      late_policy: "none",
    });
    return created.id;
  };

  const onCreateEmpty = () =>
    run(async () => {
      const id = await createDraft();
      onCreated(id, { startedGeneration: false });
    });

  const onGenerate = () =>
    run(async () => {
      const id = await createDraft();
      // Fire-and-forget: the job runs server-side regardless of the
      // client. The teacher routes straight to the review queue —
      // its skeleton state covers the wait, items appear as they land.
      let startedGeneration = true;
      try {
        const job = await teacher.generateBank(courseId, {
          count,
          assignment_id: id,
          unit_id: unitId!,
          document_ids: Array.from(selectedDocs),
          constraint: topicHint.trim() || null,
        });
        sessionStorage.setItem(`hw-gen-${id}`, job.id);
      } catch {
        startedGeneration = false;
      }
      onCreated(id, { startedGeneration });
    });

  const tops = units ? topUnits(units) : [];
  const canSubmit = !busy && title.trim().length > 0 && unitId !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => {
        // Block backdrop close while a create or upload is in flight —
        // unmounting mid-request orphans whatever the server already
        // persisted (failed-upload rows are inert so don't block).
        if (!busy && !uploads.hasInflightUploads) onClose();
      }}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[--radius-xl] bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-light px-6 py-3">
          <h2 className="text-base font-bold text-text-primary">
            New Homework
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy || uploads.hasInflightUploads}
            aria-label="Close"
            className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-primary disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div>
            <label
              htmlFor="hw-title"
              className="block text-sm font-bold text-text-primary"
            >
              Title
            </label>
            <input
              id="hw-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              maxLength={300}
              placeholder="e.g. Quadratics HW #1"
              disabled={busy}
              className="mt-2 w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-text-primary">
              Unit
            </label>
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
                    selected={unitId === u.id}
                    // Block unit switches while uploads are in flight.
                    // Otherwise an in-flight upload's auto-select can land
                    // AFTER our switch's selectedDocs clear, leaving a
                    // freshly-uploaded doc id selected under a different
                    // unit and silently forwarded on submit.
                    disabled={busy || uploads.hasInflightUploads}
                    onToggle={() => onPickUnit(u.id)}
                  />
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-bold text-text-primary">
              How many problems?
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
                  disabled={busy}
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
                aria-label="Custom problem count"
                onChange={(e) => handleCountChange(e.target.value)}
                onBlur={handleCountBlur}
                disabled={busy}
                className="w-20 rounded-[--radius-md] border border-border-light bg-bg-base px-2 py-1 text-sm text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="hw-focus"
              className="block text-sm font-bold text-text-primary"
            >
              Focus{" "}
              <span className="font-normal text-text-muted">· optional</span>
            </label>
            <p className="mt-1 text-[11px] text-text-muted">
              Tell the AI what to emphasize.
            </p>
            <input
              id="hw-focus"
              type="text"
              value={topicHint}
              onChange={(e) => setTopicHint(e.target.value)}
              placeholder="e.g. word problems, real-world contexts, no calculators"
              disabled={busy}
              className="mt-2 w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none disabled:opacity-50"
            />
          </div>

          {unitId && (
            <SourceMaterialPicker
              courseId={courseId}
              docs={docs}
              docsLoaded={docsLoaded}
              selectedDocs={selectedDocs}
              unitIds={[unitId]}
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
              disabled={busy}
              filterToSelectedUnits
            />
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border-light px-6 py-3">
          <button
            type="button"
            onClick={onCreateEmpty}
            disabled={busy || !title.trim() || !unitId}
            className="-mx-2 inline-flex min-h-[44px] items-center px-2 text-xs font-semibold text-text-muted hover:text-text-primary disabled:opacity-50"
          >
            Create empty draft
          </button>
          <button
            type="button"
            onClick={onGenerate}
            disabled={!canSubmit}
            className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {busy ? "Creating…" : "Generate problems →"}
          </button>
        </div>
      </div>
    </div>
  );
}
