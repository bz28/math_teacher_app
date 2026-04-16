"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { teacher, type BankItem, type TeacherUnit } from "@/lib/api";
import { subfoldersOf, topUnits } from "@/lib/units";
import { cn } from "@/lib/utils";

/**
 * Search-first, single-pane question picker for building a homework.
 *
 * Layout: filter row (search + unit) on top, pinned selected-chip
 * strip underneath (only when something's picked), then the bank as
 * grouped-by-unit rows. Rich rows with title + body snippet +
 * metadata chips. Variations are filtered at load — approved
 * primaries only. Keyboard: `/` focuses search, `Esc` clears it.
 */
export function BankPicker({
  courseId,
  assignmentId,
  picked,
  onChange,
}: {
  courseId: string;
  /** Scope to approved problems that originated from this homework.
   *  Post-Feature-6d, every bank item knows which HW spawned it, so
   *  the picker shows only this HW's own approved problems — no
   *  cross-HW sharing. Feature 7's auto-attach-on-approve will
   *  eventually make this whole picker redundant for the common
   *  case. */
  assignmentId: string;
  picked: string[];
  onChange: (next: string[]) => void;
}) {
  const [items, setItems] = useState<BankItem[]>([]);
  const [units, setUnits] = useState<TeacherUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unitFilter, setUnitFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      teacher.bank(courseId, { status: "approved", assignment_id: assignmentId }),
      teacher.units(courseId),
    ])
      .then(([b, u]) => {
        if (cancelled) return;
        // Practice variations (items with a parent_question_id) can't
        // be added to a homework as standalone problems — they're
        // scaffolding attached to their parent primary, served via the
        // Practice/Learn loops. Hide them from the picker.
        setItems(b.items.filter((i) => i.parent_question_id === null));
        setUnits(u.units);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load problems");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, assignmentId]);

  // Keyboard: `/` focuses search (unless the user is already typing
  // in another field); `Esc` clears search when focused.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "/" && !isEditableTarget(e.target)) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === "Escape" && document.activeElement === searchRef.current) {
        e.preventDefault();
        setSearch("");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const togglePick = (id: string) => {
    onChange(
      picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id],
    );
  };

  const itemById = useMemo(
    () => new Map(items.map((i) => [i.id, i])),
    [items],
  );
  const unitName = useMemo(() => {
    const byId = new Map(units.map((u) => [u.id, u.name]));
    return (uid: string | null) =>
      uid === null ? "Uncategorized" : byId.get(uid) ?? "Unknown unit";
  }, [units]);

  // Trim + lowercase once per search change.
  const query = search.trim().toLowerCase();

  // Filter by search and unit. Precompute the set of unit ids that
  // count as "in the filtered unit" (the unit itself + its subfolders)
  // so we don't rescan the unit tree for every item.
  const filtered = useMemo(() => {
    const allowedUnitIds =
      unitFilter === "all" || unitFilter === "uncategorized"
        ? null
        : new Set<string>([
            unitFilter,
            ...subfoldersOf(units, unitFilter).map((sf) => sf.id),
          ]);

    return items.filter((item) => {
      if (unitFilter === "uncategorized" && item.unit_id !== null) {
        return false;
      }
      if (allowedUnitIds && !allowedUnitIds.has(item.unit_id ?? "")) {
        return false;
      }
      if (!query) return true;
      return (
        item.title.toLowerCase().includes(query) ||
        item.question.toLowerCase().includes(query) ||
        unitName(item.unit_id).toLowerCase().includes(query)
      );
    });
  }, [items, units, unitFilter, query, unitName]);

  // Group filtered items by unit for rendering, in the same order the
  // top-level + subfolder traversal produces. Counts reflect the
  // filtered set — moving counts are OK here because the point is to
  // tell the teacher "there are still N in this unit that match".
  const visibleGroups = useMemo(() => {
    const groups: { id: string; label: string; items: BankItem[] }[] = [];
    const itemsIn = (uid: string | null) =>
      filtered.filter((i) => i.unit_id === uid);

    const uncat = itemsIn(null);
    if (uncat.length > 0) {
      groups.push({ id: "uncategorized", label: "Uncategorized", items: uncat });
    }
    for (const top of topUnits(units)) {
      const topItems = itemsIn(top.id);
      if (topItems.length > 0) {
        groups.push({ id: top.id, label: top.name, items: topItems });
      }
      for (const sub of subfoldersOf(units, top.id)) {
        const subItems = itemsIn(sub.id);
        if (subItems.length > 0) {
          groups.push({
            id: sub.id,
            label: `${top.name} / ${sub.name}`,
            items: subItems,
          });
        }
      }
    }
    return groups;
  }, [filtered, units]);

  const tops = topUnits(units);

  const clearFilters = () => {
    setSearch("");
    setUnitFilter("all");
  };

  return (
    <div className="mt-3 flex flex-col gap-3">
      {/* Filter row — search + unit on one line, sticky on scroll. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted">
            <SearchIcon />
          </span>
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title, text, or unit  (press / to focus)"
            className="w-full rounded-[--radius-md] border border-border-light bg-bg-base py-1.5 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none"
          />
        </div>
        <select
          value={unitFilter}
          onChange={(e) => setUnitFilter(e.target.value)}
          className="rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-1.5 text-xs text-text-primary focus:border-primary focus:outline-none"
          aria-label="Filter by unit"
        >
          <option value="all">All units</option>
          <option value="uncategorized">Uncategorized</option>
          {tops.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
          {tops.flatMap((u) =>
            subfoldersOf(units, u.id).map((sf) => (
              <option key={sf.id} value={sf.id}>
                {u.name} / {sf.name}
              </option>
            )),
          )}
        </select>
      </div>

      {/* Pinned selected strip — compact chips, one per pick. */}
      {picked.length > 0 && (
        <div className="rounded-[--radius-md] border border-primary/40 bg-primary-bg/30 p-3">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">
              {picked.length} selected
            </div>
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-[11px] font-medium text-text-secondary hover:text-red-600"
            >
              Clear all
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {picked.map((id, i) => {
              const item = itemById.get(id);
              const label = item?.title || `Selection ${i + 1}`;
              return (
                <span
                  key={id}
                  className="inline-flex max-w-[260px] items-center gap-1 rounded-[--radius-pill] bg-surface px-2 py-1 text-[11px] text-text-primary shadow-sm"
                  title={label}
                >
                  <span className="truncate">{label}</span>
                  <button
                    type="button"
                    onClick={() => togglePick(id)}
                    className="shrink-0 rounded p-0.5 text-text-muted hover:bg-bg-subtle hover:text-red-600"
                    aria-label={`Remove ${label}`}
                  >
                    ✕
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Bank list */}
      <div className="max-h-[480px] overflow-y-auto rounded-[--radius-md] border border-border-light bg-bg-base p-3">
        {loading ? (
          <p className="p-4 text-sm text-text-muted">Loading bank…</p>
        ) : error ? (
          <p className="p-4 text-sm text-red-600">{error}</p>
        ) : items.length === 0 ? (
          <EmptyBankState />
        ) : visibleGroups.length === 0 ? (
          <EmptyFilterState query={search} onClear={clearFilters} />
        ) : (
          <ul className="space-y-5">
            {visibleGroups.map((group) => (
              <li key={group.id}>
                <div className="flex items-baseline gap-2 border-b border-border-light pb-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-text-primary">
                    {group.label}
                  </span>
                  <span className="text-[11px] text-text-muted">
                    · {group.items.length}{" "}
                    {group.items.length === 1 ? "question" : "questions"}
                  </span>
                </div>
                <ul className="mt-2 space-y-1.5">
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
  const usedCount = item.used_in?.length ?? 0;
  return (
    <li>
      <label
        className={cn(
          "flex cursor-pointer items-start gap-3 rounded-[--radius-sm] border p-3 transition-colors",
          checked
            ? "border-primary/40 bg-primary-bg/40"
            : "border-transparent hover:border-border-light hover:bg-bg-subtle/50",
        )}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="mt-0.5 h-4 w-4 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 text-sm font-semibold text-text-primary">
              {item.title || "(untitled)"}
            </div>
            <DifficultyChip difficulty={item.difficulty} />
          </div>
          <div className="mt-1 line-clamp-2 text-xs text-text-secondary">
            {snippetOf(item.question)}
          </div>
          {(item.source || usedCount > 0) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-text-muted">
              {item.source && <MetaChip>{item.source}</MetaChip>}
              {usedCount > 0 && (
                <MetaChip>
                  Used in {usedCount} {usedCount === 1 ? "homework" : "homeworks"}
                </MetaChip>
              )}
            </div>
          )}
        </div>
      </label>
    </li>
  );
}

function DifficultyChip({ difficulty }: { difficulty: string }) {
  const tone =
    difficulty === "easy"
      ? "bg-green-100 text-green-700 dark:bg-green-500/20"
      : difficulty === "medium"
        ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20"
        : "bg-red-100 text-red-700 dark:bg-red-500/20";
  return (
    <span
      className={cn(
        "shrink-0 rounded-[--radius-pill] px-1.5 py-0.5 text-[9px] font-bold uppercase",
        tone,
      )}
    >
      {difficulty}
    </span>
  );
}

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-[--radius-pill] bg-bg-subtle px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
      {children}
    </span>
  );
}

function EmptyBankState() {
  return (
    <div className="py-10 text-center">
      <p className="text-sm font-medium text-text-primary">
        No approved problems yet for this homework.
      </p>
      <p className="mt-1 text-xs text-text-muted">
        Close this dialog, click <span className="font-semibold">✨ Generate more</span>{" "}
        to create problems, then approve them from the review queue.
      </p>
    </div>
  );
}

function EmptyFilterState({
  query,
  onClear,
}: {
  query: string;
  onClear: () => void;
}) {
  return (
    <div className="py-10 text-center">
      <p className="text-sm font-medium text-text-primary">
        {query
          ? `No questions match "${query}".`
          : "No questions in this filter."}
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-2 text-xs font-medium text-primary hover:underline"
      >
        Clear filters
      </button>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

/**
 * Return a plain-text excerpt of the question body for scanning.
 *
 * Strip inline `$...$` LaTeX blocks before slicing — otherwise the
 * 120-char boundary can cut mid-expression and produce source like
 * `"...found $\frac{1"` that renders as broken LaTeX. The title line
 * carries the concept, so the snippet only needs to be a scannable
 * text excerpt; dropping math entirely keeps it clean.
 */
function snippetOf(question: string): string {
  const stripped = question
    .replace(/\$[^$]*\$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length <= 120) return stripped;
  return stripped.slice(0, 120).replace(/\s\S*$/, "") + "…";
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}
