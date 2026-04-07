"use client";

import { useEffect, useState } from "react";
import { MathText } from "@/components/shared/math-text";
import {
  teacher,
  type BankItem,
  type TeacherAssignment,
  type TeacherUnit,
} from "@/lib/api";
import { EmptyState } from "@/components/school/shared/empty-state";
import { useAsyncAction } from "@/components/school/shared/use-async-action";

/**
 * Teacher's homework list for a course. Replaces the Phase 5
 * placeholder. Minimal scope:
 *   - List existing homework (drafts only for now)
 *   - + New Homework button → create modal
 *   - Click a card → detail modal (read-only problem list + edit/delete)
 *
 * Out of scope for this commit: section assignment, due date, late
 * policy, publish/draft state, student-side anything. The teacher just
 * picks bank questions, names the homework, and saves it as a draft
 * that lives in the bank.
 */
export function HomeworkTab({ courseId }: { courseId: string }) {
  const [homeworks, setHomeworks] = useState<TeacherAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await teacher.assignments(courseId);
      // Filter to homework type only — tests get their own tab
      setHomeworks(res.assignments.filter((a) => a.type === "homework"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load homework");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-text-primary">Homework</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {homeworks.length} {homeworks.length === 1 ? "homework" : "homeworks"}
          </p>
        </div>
        <button
          type="button"
          className="rounded-[--radius-md] bg-primary px-3 py-1.5 text-sm font-bold text-white hover:bg-primary-dark"
          onClick={() => setShowNew(true)}
        >
          + New Homework
        </button>
      </div>

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      <div className="mt-4 space-y-3">
        {loading ? (
          <p className="text-sm text-text-muted">Loading…</p>
        ) : homeworks.length === 0 ? (
          <EmptyState text="No homework yet. Click + New Homework to create one from your approved questions." />
        ) : (
          homeworks.map((hw) => (
            <HomeworkCard key={hw.id} hw={hw} onOpen={() => setOpenId(hw.id)} />
          ))
        )}
      </div>

      {showNew && (
        <NewHomeworkModal
          courseId={courseId}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            reload();
          }}
        />
      )}

      {openId && (
        <HomeworkDetailModal
          courseId={courseId}
          assignmentId={openId}
          onClose={() => setOpenId(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
}

function HomeworkCard({
  hw,
  onOpen,
}: {
  hw: TeacherAssignment;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full rounded-[--radius-lg] border border-border-light bg-surface p-4 text-left transition-shadow hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-text-primary">{hw.title}</h3>
          <p className="mt-0.5 text-xs text-text-muted">
            Created {new Date(hw.created_at).toLocaleDateString()}
          </p>
        </div>
        <span className="shrink-0 rounded-[--radius-pill] bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-600 dark:bg-gray-500/10">
          {hw.status}
        </span>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// New Homework — single-step modal: title + bank picker
// ─────────────────────────────────────────────────────────────────────

function NewHomeworkModal({
  courseId,
  onClose,
  onCreated,
}: {
  courseId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const { busy, error, setError, run } = useAsyncAction();

  const submit = () =>
    run(async () => {
      const t = title.trim();
      if (!t) {
        setError("Title is required");
        return;
      }
      if (picked.length === 0) {
        setError("Pick at least one question");
        return;
      }
      await teacher.createAssignment(courseId, {
        title: t,
        type: "homework",
        bank_item_ids: picked,
      });
      onCreated();
    });

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
        <div className="flex items-center justify-between border-b border-border-light px-6 py-3">
          <h2 className="text-base font-bold text-text-primary">New Homework</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-primary disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Title */}
          <label className="block text-sm font-bold text-text-primary">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            maxLength={300}
            placeholder="e.g. Quadratics HW #1"
            className="mt-2 w-full rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
          />

          {/* Bank picker */}
          <div className="mt-6">
            <label className="block text-sm font-bold text-text-primary">
              Pick problems from your bank
            </label>
            <p className="mt-1 text-[11px] text-text-muted">
              Only approved questions show up here. Pending and rejected questions
              are filtered out. Pick from any unit — homework can mix units.
            </p>
            <BankPicker
              courseId={courseId}
              picked={picked}
              onChange={setPicked}
            />
          </div>

          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border-light px-6 py-3">
          <span className="text-xs text-text-muted">
            {picked.length} {picked.length === 1 ? "problem" : "problems"} selected
          </span>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="rounded-[--radius-md] bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save homework"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Bank picker — unit filter + checkable bank items + selected sidebar
// ─────────────────────────────────────────────────────────────────────

function BankPicker({
  courseId,
  picked,
  onChange,
}: {
  courseId: string;
  picked: string[];
  onChange: (next: string[]) => void;
}) {
  const [items, setItems] = useState<BankItem[]>([]);
  const [units, setUnits] = useState<TeacherUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unitFilter, setUnitFilter] = useState<string>("all"); // "all" | "uncategorized" | unitId

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      teacher.bank(courseId, { status: "approved" }),
      teacher.units(courseId),
    ])
      .then(([b, u]) => {
        if (cancelled) return;
        setItems(b.items);
        setUnits(u.units);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load bank");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const togglePick = (id: string) => {
    if (picked.includes(id)) {
      onChange(picked.filter((p) => p !== id));
    } else {
      onChange([...picked, id]);
    }
  };

  const removePick = (id: string) => onChange(picked.filter((p) => p !== id));

  // Group items by unit so the picker is visually scannable. Subfolders
  // get their own group with a breadcrumb header.
  const topUnits = units.filter((u) => u.parent_id === null);
  const subfoldersOf = (parentId: string) => units.filter((u) => u.parent_id === parentId);
  const itemsIn = (uid: string | null) => items.filter((i) => i.unit_id === uid);

  // Build the visible groups based on the unit filter.
  const visibleGroups = (() => {
    const groups: { id: string; label: string; items: BankItem[] }[] = [];
    if (unitFilter === "all" || unitFilter === "uncategorized") {
      const uncat = itemsIn(null);
      if (uncat.length > 0 && (unitFilter === "all" || unitFilter === "uncategorized")) {
        groups.push({ id: "uncategorized", label: "Uncategorized", items: uncat });
      }
    }
    for (const top of topUnits) {
      if (unitFilter !== "all" && unitFilter !== top.id) {
        // If the filter is a specific unit, also include its subfolders
        const isSubfolderOfFilter = subfoldersOf(unitFilter).some((s) => s.id === top.id);
        if (!isSubfolderOfFilter) continue;
      }
      const topItems = itemsIn(top.id);
      if (topItems.length > 0) {
        groups.push({ id: top.id, label: top.name, items: topItems });
      }
      for (const sub of subfoldersOf(top.id)) {
        if (unitFilter !== "all" && unitFilter !== top.id && unitFilter !== sub.id) continue;
        const subItems = itemsIn(sub.id);
        if (subItems.length > 0) {
          groups.push({ id: sub.id, label: `${top.name} / ${sub.name}`, items: subItems });
        }
      }
    }
    return groups;
  })();

  // Map of bank item by id, for the selected sidebar
  const itemById = new Map(items.map((i) => [i.id, i]));

  return (
    <div className="mt-3">
      {/* Filter row */}
      <div className="mb-3 flex items-center gap-2">
        <label className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
          Unit
        </label>
        <select
          value={unitFilter}
          onChange={(e) => setUnitFilter(e.target.value)}
          className="rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-1.5 text-xs text-text-primary focus:border-primary focus:outline-none"
        >
          <option value="all">All units</option>
          <option value="uncategorized">Uncategorized</option>
          {topUnits.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
          {topUnits.flatMap((u) =>
            subfoldersOf(u.id).map((sf) => (
              <option key={sf.id} value={sf.id}>
                {u.name} / {sf.name}
              </option>
            )),
          )}
        </select>
      </div>

      {/* Two-pane: bank list left, selected sidebar right */}
      <div className="grid gap-3 md:grid-cols-[1fr_240px]">
        {/* Left: bank list */}
        <div className="max-h-96 overflow-y-auto rounded-[--radius-md] border border-border-light bg-bg-base p-3">
          {loading ? (
            <p className="text-xs text-text-muted">Loading bank…</p>
          ) : error ? (
            <p className="text-xs text-red-600">{error}</p>
          ) : visibleGroups.length === 0 ? (
            <p className="text-xs italic text-text-muted">
              No approved questions in this filter. Approve some in the Question Bank tab first.
            </p>
          ) : (
            <ul className="space-y-3">
              {visibleGroups.map((group) => (
                <li key={group.id}>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                    📁 {group.label}
                  </div>
                  <ul className="mt-1 space-y-1">
                    {group.items.map((item) => (
                      <BankPickerRow
                        key={item.id}
                        item={item}
                        checked={picked.includes(item.id)}
                        onToggle={() => togglePick(item.id)}
                      />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Right: selected sidebar */}
        <div className="rounded-[--radius-md] border border-border-light bg-bg-subtle/30 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
            Selected ({picked.length})
          </div>
          {picked.length === 0 ? (
            <p className="mt-3 text-xs italic text-text-muted">
              Pick questions from the left to add them here.
            </p>
          ) : (
            <ol className="mt-2 space-y-1.5">
              {picked.map((id, i) => {
                const item = itemById.get(id);
                if (!item) return null;
                return (
                  <li
                    key={id}
                    className="flex items-start gap-1.5 rounded-[--radius-sm] bg-surface p-2 text-[11px]"
                  >
                    <span className="shrink-0 font-bold text-primary">{i + 1}.</span>
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 text-text-primary">
                        <MathText text={item.question} />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removePick(id)}
                      className="shrink-0 rounded p-0.5 text-text-muted hover:bg-bg-subtle hover:text-red-600"
                      title="Remove"
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

function BankPickerRow({
  item,
  checked,
  onToggle,
}: {
  item: BankItem;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <label
        className={`flex cursor-pointer items-start gap-2 rounded-[--radius-sm] p-2 text-xs transition-colors ${
          checked ? "bg-primary-bg/40" : "hover:bg-bg-subtle"
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="mt-0.5 h-3.5 w-3.5 shrink-0"
        />
        <div className="min-w-0 flex-1 text-text-primary">
          <MathText text={item.question} />
        </div>
        <span className="shrink-0 rounded-[--radius-pill] bg-bg-subtle px-1.5 py-0.5 text-[9px] font-bold uppercase text-text-muted">
          {item.difficulty}
        </span>
      </label>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Detail modal — view problems, edit title, edit problems, delete
// ─────────────────────────────────────────────────────────────────────

interface AssignmentProblem {
  bank_item_id: string;
  position: number;
  question: string;
  solution_steps: { title: string; description: string }[] | null;
  final_answer: string | null;
  difficulty: string;
}

function HomeworkDetailModal({
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
              disabled={loading}
              className="flex-1 cursor-text text-left text-base font-bold text-text-primary hover:text-primary disabled:cursor-default disabled:hover:text-text-primary"
              title="Click to edit"
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
                  className="text-xs font-semibold text-primary hover:underline"
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
          <div className="flex items-center justify-end border-t border-border-light px-6 py-3">
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
                className="rounded-[--radius-md] border border-red-300 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50"
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
