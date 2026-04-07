"use client";

import { useEffect, useState } from "react";
import { MathText } from "@/components/shared/math-text";
import { teacher, type TeacherAssignment } from "@/lib/api";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import { BankPicker } from "./bank-picker";

interface AssignmentProblem {
  bank_item_id: string;
  position: number;
  question: string;
  solution_steps: { title: string; description: string }[] | null;
  final_answer: string | null;
  difficulty: string;
}

/**
 * Detail modal for an existing homework. Shows the problem list (live
 * from the bank), inline title editing, edit-problems mode, publish /
 * unpublish, and delete. Re-used from question-bank-tab so the
 * Used-in pills can open homework directly without navigation.
 */
export function HomeworkDetailModal({
  courseId,
  assignmentId,
  onClose,
  onChanged,
}: {
  courseId: string;
  assignmentId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [hw, setHw] = useState<(TeacherAssignment & { content: unknown }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [editingProblems, setEditingProblems] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { busy, error, setError, run } = useAsyncAction();

  const reload = async () => {
    setLoading(true);
    try {
      const a = await teacher.assignment(assignmentId);
      setHw(a);
      setTitleDraft(a.title);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load homework");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

  const problems: AssignmentProblem[] =
    hw?.content && typeof hw.content === "object" && "problems" in hw.content
      ? ((hw.content as { problems: AssignmentProblem[] }).problems ?? [])
      : [];

  const saveTitle = () =>
    run(async () => {
      const t = titleDraft.trim();
      if (!t) {
        setError("Title cannot be empty");
        return;
      }
      if (t === hw?.title) {
        setEditingTitle(false);
        return;
      }
      await teacher.updateAssignment(assignmentId, { title: t });
      setEditingTitle(false);
      await reload();
      onChanged();
    });

  const saveProblems = (newPicked: string[]) =>
    run(async () => {
      if (newPicked.length === 0) {
        setError("Pick at least one question");
        return;
      }
      await teacher.updateAssignment(assignmentId, { bank_item_ids: newPicked });
      setEditingProblems(false);
      await reload();
      onChanged();
    });

  const remove = () =>
    run(async () => {
      await teacher.deleteAssignment(assignmentId);
      onClose();
      onChanged();
    });

  const publish = () =>
    run(async () => {
      await teacher.publishAssignment(assignmentId);
      await reload();
      onChanged();
    });

  const unpublish = () =>
    run(async () => {
      await teacher.unpublishAssignment(assignmentId);
      await reload();
      onChanged();
    });

  const isPublished = hw?.status === "published";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[--radius-xl] bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-border-light px-6 py-3">
          {hw && (
            <span
              className={`shrink-0 rounded-[--radius-pill] px-2 py-0.5 text-[10px] font-bold uppercase ${
                isPublished
                  ? "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-500/10"
              }`}
            >
              {hw.status}
            </span>
          )}
          {editingTitle ? (
            <form
              className="flex flex-1 items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                saveTitle();
              }}
            >
              <input
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                autoFocus
                maxLength={300}
                className="flex-1 rounded-[--radius-md] border border-primary bg-bg-base px-3 py-1.5 text-sm font-bold text-text-primary focus:outline-none"
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-[--radius-sm] bg-primary px-2.5 py-1 text-xs font-bold text-white hover:bg-primary-dark disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingTitle(false);
                  setTitleDraft(hw?.title ?? "");
                }}
                className="rounded-[--radius-sm] border border-border-light px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-bg-subtle"
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setEditingTitle(true)}
              disabled={loading || isPublished}
              title={isPublished ? "Unpublish to edit" : "Click to edit"}
              className="flex-1 cursor-text text-left text-base font-bold text-text-primary hover:text-primary disabled:cursor-default disabled:hover:text-text-primary"
            >
              {hw?.title ?? "Loading…"}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-primary"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <p className="text-sm text-text-muted">Loading…</p>
          ) : isPublished ? (
            <>
              <div className="rounded-[--radius-md] border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                🔒 This homework is published. Students can see it and the
                questions inside are locked. Unpublish it to edit.
              </div>
              <ol className="mt-4 space-y-3">
                {problems.map((p) => (
                  <li
                    key={`${p.bank_item_id}-${p.position}`}
                    className="rounded-[--radius-lg] border border-border-light bg-surface p-4"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-dark text-xs font-bold text-white">
                        {p.position}
                      </div>
                      <div className="min-w-0 flex-1 text-sm text-text-primary">
                        <MathText text={p.question} />
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          ) : editingProblems ? (
            <EditProblemsView
              courseId={courseId}
              currentBankIds={problems.map((p) => p.bank_item_id)}
              onCancel={() => setEditingProblems(false)}
              onSave={saveProblems}
              busy={busy}
            />
          ) : (
            <>
              <div className="flex items-baseline justify-between">
                <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                  {problems.length} {problems.length === 1 ? "problem" : "problems"}
                </div>
                <button
                  type="button"
                  onClick={() => setEditingProblems(true)}
                  disabled={isPublished}
                  title={isPublished ? "Unpublish to edit" : ""}
                  className="text-xs font-semibold text-primary hover:underline disabled:opacity-50 disabled:hover:no-underline"
                >
                  ✏ Edit problems
                </button>
              </div>

              {problems.length === 0 ? (
                <p className="mt-4 text-xs italic text-text-muted">
                  No problems on this homework. Click Edit problems to add some.
                </p>
              ) : (
                <ol className="mt-4 space-y-3">
                  {problems.map((p) => (
                    <li
                      key={`${p.bank_item_id}-${p.position}`}
                      className="rounded-[--radius-lg] border border-border-light bg-surface p-4"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-dark text-xs font-bold text-white">
                          {p.position}
                        </div>
                        <div className="min-w-0 flex-1 text-sm text-text-primary">
                          <MathText text={p.question} />
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}

          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        </div>

        {/* Footer */}
        {!editingProblems && (
          <div className="flex items-center justify-between gap-2 border-t border-border-light px-6 py-3">
            <div>
              {isPublished ? (
                <button
                  type="button"
                  onClick={unpublish}
                  disabled={busy}
                  className="rounded-[--radius-md] border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
                >
                  Unpublish
                </button>
              ) : (
                <button
                  type="button"
                  onClick={publish}
                  disabled={busy || problems.length === 0}
                  title={problems.length === 0 ? "Add at least one problem first" : "Publish — locks the questions in the bank"}
                  className="rounded-[--radius-md] bg-green-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-50"
                >
                  Publish
                </button>
              )}
            </div>
            {confirmingDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-red-700">
                  Delete this homework?
                </span>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  className="rounded-[--radius-md] border border-border-light px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-bg-subtle"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={remove}
                  disabled={busy}
                  className="rounded-[--radius-md] bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Yes, delete
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                disabled={isPublished}
                title={isPublished ? "Unpublish before deleting" : ""}
                className="rounded-[--radius-md] border border-red-300 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                🗑 Delete homework
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EditProblemsView({
  courseId,
  currentBankIds,
  onCancel,
  onSave,
  busy,
}: {
  courseId: string;
  currentBankIds: string[];
  onCancel: () => void;
  onSave: (next: string[]) => void;
  busy: boolean;
}) {
  const [picked, setPicked] = useState<string[]>(currentBankIds);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
          Edit problems
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-[--radius-sm] border border-border-light px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(picked)}
            disabled={busy}
            className="rounded-[--radius-sm] bg-primary px-2.5 py-1 text-xs font-bold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      <BankPicker courseId={courseId} picked={picked} onChange={setPicked} />
    </div>
  );
}
