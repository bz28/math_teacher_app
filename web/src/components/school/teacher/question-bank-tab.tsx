"use client";

import { useEffect, useRef, useState } from "react";
import { MathText } from "@/components/shared/math-text";
import {
  teacher,
  type BankCounts,
  type BankItem,
  type BankJob,
  type TeacherDocument,
  type TeacherUnit,
} from "@/lib/api";

// Build a "Unit 5: Quadratics / Practice" label for any unit_id, or
// "Uncategorized" when null.
function buildUnitLabel(units: TeacherUnit[], unitId: string | null): string {
  if (!unitId) return "Uncategorized";
  const u = units.find((x) => x.id === unitId);
  if (!u) return "Unknown";
  if (!u.parent_id) return u.name;
  const parent = units.find((x) => x.id === u.parent_id);
  return parent ? `${parent.name} / ${u.name}` : u.name;
}
import { EmptyState } from "@/components/school/shared/empty-state";
import { useAsyncAction } from "@/components/school/shared/use-async-action";
import { WorkshopModal } from "./workshop-modal";
import { HomeworkDetailModal } from "./homework-tab";
import { STATUS_FILTERS } from "./bank-styles";

// Tree node = a root question + any practice variations under it.
// Variations are bank items whose parent_question_id points at the root.
// Today nothing has a parent (Generate Similar isn't shipped yet), so
// every approved item is a root with zero children — but the rendering
// is in place so when variations land they slot in automatically.
type TreeNode = { item: BankItem; children: BankItem[] };

function buildTree(items: BankItem[]): TreeNode[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const childrenByParent = new Map<string, BankItem[]>();
  for (const item of items) {
    const pid = item.parent_question_id;
    if (pid && byId.has(pid)) {
      const arr = childrenByParent.get(pid) ?? [];
      arr.push(item);
      childrenByParent.set(pid, arr);
    }
  }
  // Roots = items without a parent in this view (orphans get promoted).
  return items
    .filter((item) => !item.parent_question_id || !byId.has(item.parent_question_id))
    .map((item) => ({ item, children: childrenByParent.get(item.id) ?? [] }));
}

const POLL_LIMIT_MS = 5 * 60 * 1000;

export function QuestionBankTab({ courseId }: { courseId: string }) {
  const [items, setItems] = useState<BankItem[]>([]);
  const [units, setUnits] = useState<TeacherUnit[]>([]);
  const [counts, setCounts] = useState<BankCounts>({
    pending: 0,
    approved: 0,
    rejected: 0,
    archived: 0,
  });
  // Default to Pending — that's the actionable view a teacher lands on
  // most often after generating. If pending is empty on first load we
  // flip to Approved automatically (see effect below) so the teacher
  // doesn't land on an empty page.
  const [statusFilter, setStatusFilter] = useState<"pending" | "approved" | "rejected">("pending");
  const [defaultedToApproved, setDefaultedToApproved] = useState(false);
  // Unit filter — "all" | "uncategorized" | unit id. Decoupled from
  // status filter so the teacher can narrow on both axes.
  const [unitFilter, setUnitFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [activeJob, setActiveJob] = useState<BankJob | null>(null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [openHomeworkId, setOpenHomeworkId] = useState<string | null>(null);
  const [reviewQueue, setReviewQueue] = useState<BankItem[] | null>(null);

  // Open review mode with all currently-pending items in the bank as the
  // frozen queue. Hits a fresh fetch so we don't accidentally review stale
  // items if the current filter is hiding pending ones.
  const startReview = async () => {
    try {
      const res = await teacher.bank(courseId, { status: "pending" });
      setReviewQueue(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load pending");
    }
  };

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const filters: { status?: string; unit_id?: string } = { status: statusFilter };
      // Note: backend doesn't support uncategorized filter yet, so we
      // filter in memory below for that case.
      if (unitFilter !== "all" && unitFilter !== "uncategorized") {
        filters.unit_id = unitFilter;
      }
      const [bankRes, unitsRes] = await Promise.all([
        teacher.bank(courseId, filters),
        teacher.units(courseId),
      ]);
      let filteredItems = bankRes.items;
      if (unitFilter === "uncategorized") {
        filteredItems = bankRes.items.filter((i) => i.unit_id === null);
      }
      setItems(filteredItems);
      setUnits(unitsRes.units);
      setCounts(bankRes.counts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load bank");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, statusFilter, unitFilter]);

  // First-load default flip: if we landed on Pending but there's nothing
  // to review, jump to Approved so the teacher sees their library
  // instead of an empty page. Only fires once per courseId so a teacher
  // who explicitly clicks Pending later won't get yanked away.
  useEffect(() => {
    if (defaultedToApproved) return;
    if (loading) return;
    if (statusFilter === "pending" && counts.pending === 0 && counts.approved > 0) {
      setStatusFilter("approved");
      setDefaultedToApproved(true);
    }
  }, [loading, counts.pending, counts.approved, statusFilter, defaultedToApproved]);

  // Poll active job until done/failed, then refresh the bank.
  // Hard cap at POLL_LIMIT_MS — if the backend process died after the row was
  // created but before the asyncio task ran, the job stays "queued" forever.
  useEffect(() => {
    if (!activeJob || activeJob.status === "done" || activeJob.status === "failed") return;
    const startedAt = Date.now();
    const jobId = activeJob.id;
    const interval = setInterval(async () => {
      if (Date.now() - startedAt > POLL_LIMIT_MS) {
        setActiveJob((prev) =>
          prev && prev.id === jobId
            ? { ...prev, status: "failed", error_message: "Generation timed out — try again or refresh the page." }
            : prev,
        );
        return;
      }
      try {
        const updated = await teacher.bankJob(courseId, jobId);
        setActiveJob((prev) => (prev && prev.id === jobId ? updated : prev));
        if (updated.status === "done") {
          reload();
        }
      } catch {
        // keep polling, transient errors are fine
      }
    }, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob?.id, activeJob?.status, courseId]);

  // Auto-clear a finished job banner after a few seconds
  useEffect(() => {
    if (activeJob?.status === "done") {
      const t = setTimeout(() => setActiveJob(null), 4000);
      return () => clearTimeout(t);
    }
  }, [activeJob?.status]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-text-primary">Question Bank</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {counts.approved} approved · {counts.pending} pending · {counts.rejected} rejected
          </p>
        </div>
        <div className="flex items-center gap-2">
          {counts.pending > 0 && statusFilter !== "pending" && (
            <button
              type="button"
              className="rounded-[--radius-md] border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-bold text-amber-800 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
              onClick={startReview}
            >
              Review pending ({counts.pending}) →
            </button>
          )}
          <button
            type="button"
            className="rounded-[--radius-md] bg-primary px-3 py-1.5 text-sm font-bold text-white hover:bg-primary-dark"
            onClick={() => setShowGenerate(true)}
          >
            + Generate Questions
          </button>
        </div>
      </div>

      {/* Active job banner */}
      {activeJob && (
        <div
          className={`mt-4 rounded-[--radius-lg] border p-3 text-sm ${
            activeJob.status === "failed"
              ? "border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10"
              : activeJob.status === "done"
                ? "border-green-200 bg-green-50 text-green-800 dark:border-green-500/30 dark:bg-green-500/10"
                : "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10"
          }`}
        >
          {activeJob.status === "queued" && "🟡 Generation queued…"}
          {activeJob.status === "running" &&
            (activeJob.produced_count > 0
              ? `🔄 Generating questions… ${activeJob.produced_count}/${activeJob.requested_count}`
              : `🔄 Generating ${activeJob.requested_count} questions…`)}
          {activeJob.status === "done" && (
            <div className="flex items-center justify-between gap-3">
              <span>
                ✅ Generated {activeJob.produced_count}/{activeJob.requested_count} questions
              </span>
              <button
                type="button"
                onClick={startReview}
                className="rounded-[--radius-sm] bg-green-700 px-2.5 py-1 text-xs font-bold text-white hover:bg-green-800"
              >
                Review now →
              </button>
            </div>
          )}
          {activeJob.status === "failed" &&
            `❌ Generation failed: ${activeJob.error_message ?? "unknown error"}`}
        </div>
      )}

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      {/* Filter row: status chips + unit dropdown */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => {
                setStatusFilter(f.key);
                // Dismiss any open workshop modal so switching tabs
                // feels like a navigation, not a sticky overlay.
                setOpenItemId(null);
              }}
              className={`rounded-[--radius-pill] px-3 py-1 text-xs font-semibold transition-colors ${
                statusFilter === f.key
                  ? "bg-primary text-white"
                  : "border border-border-light text-text-secondary hover:bg-bg-subtle"
              }`}
            >
              {f.label}
              <span className="ml-1 opacity-70">({counts[f.key] ?? 0})</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
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
            {units
              .filter((u) => u.parent_id === null)
              .flatMap((top) => [
                <option key={top.id} value={top.id}>
                  {top.name}
                </option>,
                ...units
                  .filter((sub) => sub.parent_id === top.id)
                  .map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      &nbsp;&nbsp;{top.name} / {sub.name}
                    </option>
                  )),
              ])}
          </select>
        </div>
      </div>

      {/* List — Approved gets unit grouping + per-unit tabs.
          Pending and Rejected get a flat dense list. All shows the
          same grouping as Approved for consistency. */}
      <div className="mt-4 space-y-5">
        {loading ? (
          <p className="text-sm text-text-muted">Loading…</p>
        ) : items.length === 0 ? (
          <EmptyState
            text={
              counts.pending + counts.approved + counts.rejected === 0
                ? "No questions yet. Hit \u201cGenerate Questions\u201d to create some."
                : statusFilter === "pending"
                  ? "No pending review. New generations land here."
                  : statusFilter === "rejected"
                    ? "No rejected questions."
                    : "No questions match this filter."
            }
          />
        ) : statusFilter === "pending" || statusFilter === "rejected" ? (
          <SimpleUnitList
            items={items}
            units={units}
            onOpenItem={setOpenItemId}
            onOpenHomework={setOpenHomeworkId}
            onChanged={reload}
          />
        ) : (
          buildUnitGroups(items, units).map((group) => (
            <ApprovedUnitGroup
              key={group.id}
              label={group.label}
              items={group.items}
              units={units}
              onOpenItem={setOpenItemId}
              onOpenHomework={setOpenHomeworkId}
              onChanged={reload}
            />
          ))
        )}
      </div>

      {showGenerate && (
        <GenerateQuestionsModal
          courseId={courseId}
          onClose={() => setShowGenerate(false)}
          onStarted={(job) => {
            setShowGenerate(false);
            setActiveJob(job);
          }}
        />
      )}

      {openItemId && (() => {
        const openItem = items.find((i) => i.id === openItemId);
        if (!openItem) return null;
        return (
          <WorkshopModal
            item={openItem}
            onClose={() => setOpenItemId(null)}
            onChanged={reload}
          />
        );
      })()}

      {reviewQueue && (
        <WorkshopModal
          queue={reviewQueue}
          onClose={() => {
            setReviewQueue(null);
            reload();
          }}
          onChanged={reload}
        />
      )}

      {openHomeworkId && (
        <HomeworkDetailModal
          courseId={courseId}
          assignmentId={openHomeworkId}
          onClose={() => setOpenHomeworkId(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
}

// Group items by unit for visual scanning. Top units come first in
// position order, with their subfolders nested via breadcrumb labels.
// "Uncategorized" goes last.
function buildUnitGroups(
  items: BankItem[],
  units: TeacherUnit[],
): { id: string; label: string; items: BankItem[] }[] {
  const groups: { id: string; label: string; items: BankItem[] }[] = [];
  const itemsIn = (uid: string | null) => items.filter((i) => i.unit_id === uid);
  const topUnits = units.filter((u) => u.parent_id === null);
  for (const top of topUnits) {
    const own = itemsIn(top.id);
    if (own.length > 0) groups.push({ id: top.id, label: top.name, items: own });
    for (const sub of units.filter((u) => u.parent_id === top.id)) {
      const subItems = itemsIn(sub.id);
      if (subItems.length > 0) {
        groups.push({ id: sub.id, label: `${top.name} / ${sub.name}`, items: subItems });
      }
    }
  }
  const uncat = itemsIn(null);
  if (uncat.length > 0) groups.push({ id: "uncategorized", label: "Uncategorized", items: uncat });
  return groups;
}

// Approved view: collapsible unit split into two sections — "Available"
// (root questions not yet in any homework or test, default expanded)
// and "In a homework or test" (used roots, default collapsed). Practice
// variations nest under their parent in either section.
function ApprovedUnitGroup({
  label,
  items,
  units,
  onOpenItem,
  onOpenHomework,
  onChanged,
}: {
  label: string;
  items: BankItem[];
  units: TeacherUnit[];
  onOpenItem: (id: string) => void;
  onOpenHomework: (id: string) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [storageOpen, setStorageOpen] = useState(false);

  const tree = buildTree(items);
  const available = tree.filter((node) => node.item.used_in.length === 0);
  const inUse = tree.filter((node) => node.item.used_in.length > 0);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 border-b border-border-light pb-1 text-left text-xs font-bold uppercase tracking-wider text-text-muted hover:text-text-primary"
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>📁 {label}</span>
        <span className="font-normal normal-case text-text-muted/80">
          · {tree.length} {tree.length === 1 ? "question" : "questions"}
          {available.length > 0 && ` · ${available.length} available`}
          {inUse.length > 0 && ` · ${inUse.length} in use`}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {/* Available section — default expanded */}
          <BankSection
            title="Available"
            count={available.length}
            nodes={available}
            units={units}
            defaultOpen
            emptyText="All approved questions in this unit are in a homework or test 🎉"
            onOpenItem={onOpenItem}
            onOpenHomework={onOpenHomework}
            onChanged={onChanged}
          />

          {/* In-use section — default collapsed, hidden when empty */}
          {inUse.length > 0 && (
            <BankSection
              title="In a homework or test"
              count={inUse.length}
              nodes={inUse}
              units={units}
              defaultOpen={storageOpen}
              onToggle={setStorageOpen}
              onOpenItem={onOpenItem}
              onOpenHomework={onOpenHomework}
              onChanged={onChanged}
            />
          )}
        </div>
      )}
    </div>
  );
}

// One labeled section inside an Approved unit (Available or In-use).
// Renders a small header with count + caret, then the rows when open.
function BankSection({
  title,
  count,
  nodes,
  units,
  defaultOpen,
  onToggle,
  emptyText,
  onOpenItem,
  onOpenHomework,
  onChanged,
}: {
  title: string;
  count: number;
  nodes: TreeNode[];
  units: TeacherUnit[];
  defaultOpen: boolean;
  onToggle?: (open: boolean) => void;
  emptyText?: string;
  onOpenItem: (id: string) => void;
  onOpenHomework: (id: string) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    onToggle?.(next);
  };
  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 text-left text-[11px] font-bold uppercase tracking-wider text-text-muted hover:text-text-primary"
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>{title}</span>
        <span className="font-normal normal-case text-text-muted/80">· {count}</span>
      </button>
      {open && (
        <div className="mt-1 divide-y divide-border-light/60 rounded-[--radius-md] border border-border-light bg-surface">
          {nodes.length === 0 && emptyText ? (
            <div className="px-3 py-6 text-center text-xs italic text-text-muted">
              {emptyText}
            </div>
          ) : (
            nodes.map((node) => (
              <BankRowWithChildren
                key={node.item.id}
                node={node}
                units={units}
                onOpenItem={onOpenItem}
                onOpenHomework={onOpenHomework}
                onChanged={onChanged}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// A root row with optional inline-expandable practice variations.
function BankRowWithChildren({
  node,
  units,
  onOpenItem,
  onOpenHomework,
  onChanged,
}: {
  node: TreeNode;
  units: TeacherUnit[];
  onOpenItem: (id: string) => void;
  onOpenHomework: (id: string) => void;
  onChanged: () => void;
}) {
  const [variationsOpen, setVariationsOpen] = useState(false);
  const childrenCount = node.children.length;
  const pendingChildren = node.children.filter((c) => c.status === "pending").length;

  return (
    <div>
      <BankRow
        item={node.item}
        unitLabel={buildUnitLabel(units, node.item.unit_id)}
        showUnit={false}
        onOpen={() => onOpenItem(node.item.id)}
        onOpenHomework={onOpenHomework}
        onChanged={onChanged}
      />
      {childrenCount > 0 && (
        <>
          <button
            type="button"
            onClick={() => setVariationsOpen((v) => !v)}
            className="ml-7 mb-1 flex items-center gap-1 text-[10px] font-semibold text-text-muted hover:text-primary"
          >
            <span>{variationsOpen ? "▾" : "▸"}</span>
            <span>
              {childrenCount} variation{childrenCount === 1 ? "" : "s"}
              {pendingChildren > 0 && ` · ${pendingChildren} pending`}
            </span>
          </button>
          {variationsOpen && (
            <div className="ml-6 border-l border-border-light">
              {node.children.map((child) => (
                <BankRow
                  key={child.id}
                  item={child}
                  unitLabel={buildUnitLabel(units, child.unit_id)}
                  showUnit={false}
                  variation
                  onOpen={() => onOpenItem(child.id)}
                  onOpenHomework={onOpenHomework}
                  onChanged={onChanged}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Pending and Rejected views: same unit grouping as Approved, but no
// sub-sections. Just a flat dense list of rows per unit. Lets the
// teacher review/triage one topic at a time.
function SimpleUnitList({
  items,
  units,
  onOpenItem,
  onOpenHomework,
  onChanged,
}: {
  items: BankItem[];
  units: TeacherUnit[];
  onOpenItem: (id: string) => void;
  onOpenHomework: (id: string) => void;
  onChanged: () => void;
}) {
  const groups = buildUnitGroups(items, units);
  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <SimpleUnitGroup
          key={group.id}
          label={group.label}
          items={group.items}
          units={units}
          onOpenItem={onOpenItem}
          onOpenHomework={onOpenHomework}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}

function SimpleUnitGroup({
  label,
  items,
  units,
  onOpenItem,
  onOpenHomework,
  onChanged,
}: {
  label: string;
  items: BankItem[];
  units: TeacherUnit[];
  onOpenItem: (id: string) => void;
  onOpenHomework: (id: string) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 border-b border-border-light pb-1 text-left text-xs font-bold uppercase tracking-wider text-text-muted hover:text-text-primary"
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>📁 {label}</span>
        <span className="font-normal normal-case text-text-muted/80">
          · {items.length} {items.length === 1 ? "question" : "questions"}
        </span>
      </button>
      {open && (
        <div className="mt-2 divide-y divide-border-light/60 rounded-[--radius-md] border border-border-light bg-surface">
          {items.map((item) => (
            <BankRow
              key={item.id}
              item={item}
              unitLabel={buildUnitLabel(units, item.unit_id)}
              showUnit={false}
              onOpen={() => onOpenItem(item.id)}
              onOpenHomework={onOpenHomework}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Dense one-line row. Status dot, truncated question, Used-in pills,
// optional unit label, lock badge, kebab menu. Click the question text
// to open the workshop modal. The `variation` flag styles it slightly
// smaller + no border so it nests visually under its parent.
function BankRow({
  item,
  unitLabel,
  showUnit,
  variation = false,
  onOpen,
  onOpenHomework,
  onChanged,
}: {
  item: BankItem;
  unitLabel: string;
  showUnit: boolean;
  variation?: boolean;
  onOpen: () => void;
  onOpenHomework: (id: string) => void;
  onChanged: () => void;
}) {
  const { busy, error, run } = useAsyncAction();

  const dotClass =
    item.status === "approved"
      ? "bg-green-500"
      : item.status === "pending"
        ? "bg-amber-400"
        : "bg-text-muted/40";

  const approve = () =>
    run(async () => {
      await teacher.approveBankItem(item.id);
      onChanged();
    });
  const reject = () =>
    run(async () => {
      await teacher.rejectBankItem(item.id);
      onChanged();
    });
  const remove = () =>
    run(async () => {
      await teacher.deleteBankItem(item.id);
      onChanged();
    });

  return (
    <div
      className={`flex items-start gap-3 px-3 transition-colors hover:bg-bg-subtle ${
        variation ? "py-1.5 text-xs" : "py-2 text-sm"
      } ${item.status === "rejected" ? "opacity-60" : ""}`}
    >
      <span
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotClass}`}
        title={item.status}
        aria-label={item.status}
      />

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onOpen}
          className="block w-full text-left text-text-primary hover:text-primary"
          title="Open question"
        >
          <div className="truncate">
            <MathText text={item.question} />
          </div>
        </button>
        {/* Mobile: pills + unit label wrap below the question text on
            narrow screens. Desktop renders them on the right. Lives
            outside the question button so the nested-button is valid. */}
        {(showUnit || item.used_in.length > 0) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-semibold text-text-muted sm:hidden">
            {showUnit && <span>📁 {unitLabel}</span>}
            {item.used_in.map((u) => (
              <UsedInPill
                key={u.id}
                entry={u}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenHomework(u.id);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Desktop: pills sit to the right of the question text */}
      {item.used_in.length > 0 && (
        <div className="hidden shrink-0 flex-wrap items-center gap-1 pt-0.5 sm:flex">
          {item.used_in.map((u) => (
            <UsedInPill
              key={u.id}
              entry={u}
              onClick={(e) => {
                e.stopPropagation();
                onOpenHomework(u.id);
              }}
            />
          ))}
        </div>
      )}

      {item.locked && (
        <span
          className="shrink-0 pt-0.5 text-amber-600 dark:text-amber-400"
          title="Locked — in published homework"
        >
          🔒
        </span>
      )}

      <KebabMenu
        item={item}
        busy={busy}
        onApprove={approve}
        onReject={reject}
        onRemove={remove}
      />

      {error && (
        <span className="shrink-0 pt-0.5 text-[10px] text-red-600" title={error}>
          ⚠
        </span>
      )}
    </div>
  );
}

// Pill rendering for "used in" entries. Visually distinguishes
// homework vs test, and draft vs published, so a teacher building a
// new homework can tell at a glance which references are live.
function UsedInPill({
  entry,
  onClick,
}: {
  entry: { id: string; title: string; type: string; status: string };
  onClick: (e: React.MouseEvent) => void;
}) {
  const isTest = entry.type === "test" || entry.type === "quiz";
  const isDraft = entry.status !== "published";
  const colorClass = isDraft
    ? "border border-dashed border-text-muted/40 bg-transparent text-text-muted hover:bg-bg-subtle"
    : isTest
      ? "bg-purple-100 text-purple-800 hover:bg-purple-200 dark:bg-purple-500/20 dark:text-purple-300"
      : "bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-500/20 dark:text-blue-300";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[--radius-pill] px-1.5 py-0.5 text-[10px] font-bold transition-colors ${colorClass}`}
      title={`Open ${entry.title}${isDraft ? " (draft)" : ""}`}
    >
      {entry.title}
      {isDraft && <span className="ml-1 opacity-70">draft</span>}
    </button>
  );
}

// Action menu — three dots that opens a small dropdown. Replaces the
// always-visible Approve/Reject/Delete row of buttons. Uses a window
// click listener for outside-click dismiss.
function KebabMenu({
  item,
  busy,
  onApprove,
  onReject,
  onRemove,
}: {
  item: BankItem;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirmDelete(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const lockedTitle = item.locked ? "Locked by published homework" : undefined;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="rounded p-1 text-text-muted hover:bg-bg-subtle hover:text-text-primary"
        aria-label="Actions"
      >
        ⋯
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-20 mt-1 w-40 rounded-[--radius-md] border border-border-light bg-surface py-1 text-xs shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {item.status === "pending" && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onApprove();
              }}
              disabled={busy || item.locked}
              title={lockedTitle}
              className="block w-full px-3 py-1.5 text-left font-semibold text-green-700 hover:bg-bg-subtle disabled:opacity-50"
            >
              ✓ Approve
            </button>
          )}
          {item.status !== "rejected" && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onReject();
              }}
              disabled={busy || item.locked}
              title={lockedTitle}
              className="block w-full px-3 py-1.5 text-left font-semibold text-text-secondary hover:bg-bg-subtle disabled:opacity-50"
            >
              ✕ Reject
            </button>
          )}
          {item.status === "rejected" && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onApprove();
              }}
              disabled={busy}
              className="block w-full px-3 py-1.5 text-left font-semibold text-green-700 hover:bg-bg-subtle disabled:opacity-50"
            >
              ↺ Restore
            </button>
          )}
          {confirmDelete ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setConfirmDelete(false);
                onRemove();
              }}
              disabled={busy}
              className="block w-full px-3 py-1.5 text-left font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Yes, delete
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              disabled={busy || item.locked}
              title={lockedTitle}
              className="block w-full px-3 py-1.5 text-left font-semibold text-red-700 hover:bg-bg-subtle disabled:opacity-50"
            >
              🗑 Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const QUANTITY_CHIPS = [5, 10, 20, 50] as const;

function GenerateQuestionsModal({
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

  const topUnits = units.filter((u) => u.parent_id === null);
  const subfoldersOf = (parentId: string) => units.filter((u) => u.parent_id === parentId);
  const docsIn = (uid: string | null) => docs.filter((d) => d.unit_id === uid);

  // Smart "Save to" default, derived during render. If the teacher hasn't
  // explicitly picked a target yet AND all selected docs share a unit, use
  // that unit. Otherwise fall back to the override (or null/Uncategorized).
  const autoUnitId: string | null = (() => {
    if (selectedDocs.size === 0) return null;
    const selected = docs.filter((d) => selectedDocs.has(d.id));
    const shared = selected[0]?.unit_id ?? null;
    return selected.every((d) => d.unit_id === shared) ? shared : null;
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
    for (const top of topUnits) {
      const topDocs = docsIn(top.id);
      if (topDocs.length > 0) {
        groups.push({ id: top.id, label: top.name, docs: topDocs });
      }
      for (const sub of subfoldersOf(top.id)) {
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
