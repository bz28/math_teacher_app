"use client";

import { useEffect, useState } from "react";
import { MathText } from "@/components/shared/math-text";
import { teacher, type BankItem, type TeacherUnit } from "@/lib/api";
import { subfoldersOf, topUnits } from "@/lib/units";

/**
 * Two-pane question picker — bank list on the left (filtered to approved
 * + grouped by unit), selected sidebar on the right with reorderable
 * picks. Reused by NewHomeworkModal and EditProblemsView.
 */
export function BankPicker({
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
  const tops = topUnits(units);
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
    for (const top of tops) {
      if (unitFilter !== "all" && unitFilter !== top.id) {
        // If the filter is a specific unit, also include its subfolders
        const isSubfolderOfFilter = subfoldersOf(units, unitFilter).some((s) => s.id === top.id);
        if (!isSubfolderOfFilter) continue;
      }
      const topItems = itemsIn(top.id);
      if (topItems.length > 0) {
        groups.push({ id: top.id, label: top.name, items: topItems });
      }
      for (const sub of subfoldersOf(units, top.id)) {
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
