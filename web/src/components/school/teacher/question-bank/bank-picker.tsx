"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { teacher, type BankItem, type TeacherUnit } from "@/lib/api";
import { subfoldersOf, topUnits } from "@/lib/units";
import { defaultUnitFilter, groupBankItems } from "./bank-groups";
import { QuestionRow } from "./question-row";

type Load =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; items: BankItem[]; units: TeacherUnit[] };

/**
 * The course's approved questions, grouped by the homework they came
 * from, to put on a homework without another review: they were approved
 * once already. Search and a unit filter narrow it; questions already on
 * the homework are left out. Selection is controlled and kept in the
 * order the teacher picks, which is the order they're added.
 */
export function BankPicker({
  courseId,
  homeworkUnitIds = [],
  excludeIds,
  selected,
  onChange,
  disabled,
}: {
  courseId: string;
  /** The homework's units: the filter starts on its unit when it has
   *  one, on every unit when it spans several. */
  homeworkUnitIds?: string[];
  excludeIds?: string[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [unitId, setUnitId] = useState<string>(() => defaultUnitFilter(homeworkUnitIds));
  const searchId = useId();
  const unitSelectId = useId();

  useEffect(() => {
    let cancelled = false;
    Promise.all([teacher.bank(courseId, { status: "approved" }), teacher.units(courseId)])
      .then(([bank, u]) => {
        if (!cancelled) setLoad({ state: "ready", items: bank.items, units: u.units });
      })
      .catch(() => {
        if (!cancelled) setLoad({ state: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, attempt]);

  const units = useMemo(() => (load.state === "ready" ? load.units : []), [load]);
  const unitScope = useMemo(() => {
    if (!unitId) return null;
    return new Set([unitId, ...subfoldersOf(units, unitId).map((u) => u.id)]);
  }, [unitId, units]);
  const groups = useMemo(
    () =>
      load.state === "ready"
        ? groupBankItems(load.items, { excludeIds, query, unitIds: unitScope })
        : [],
    [load, excludeIds, query, unitScope],
  );
  const anyApproved = useMemo(
    () =>
      load.state === "ready" &&
      groupBankItems(load.items, { excludeIds }).length > 0,
    [load, excludeIds],
  );

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  if (load.state === "loading") {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading the question bank">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-12 animate-pulse rounded-[--radius-sm] bg-bg-subtle" />
        ))}
      </div>
    );
  }
  if (load.state === "error") {
    return (
      <p className="rounded-[--radius-md] border border-border-light px-4 py-3 text-sm text-text-secondary">
        Couldn’t load the question bank.{" "}
        <button
          type="button"
          onClick={() => {
            setLoad({ state: "loading" });
            setAttempt((n) => n + 1);
          }}
          className="font-semibold text-primary hover:underline"
        >
          Try again
        </button>
      </p>
    );
  }
  if (!anyApproved) {
    return (
      <p className="rounded-[--radius-md] border border-dashed border-border-light px-4 py-5 text-center text-sm text-text-muted">
        No approved questions to add yet. Questions you approve on any homework in this course
        show up here, ready to reuse.
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={searchId} className="sr-only">
          Search questions
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search questions"
          disabled={disabled}
          className="min-w-0 flex-1 rounded-[--radius-md] border border-border-light bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none"
        />
        <label htmlFor={unitSelectId} className="sr-only">
          Unit
        </label>
        <select
          id={unitSelectId}
          value={unitId}
          onChange={(e) => setUnitId(e.target.value)}
          disabled={disabled}
          className="rounded-[--radius-pill] border border-border-light bg-bg-subtle px-3 py-2 text-xs font-semibold text-text-primary focus:border-primary focus:outline-none"
        >
          <option value="">All units</option>
          {topUnits(units).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>

      {groups.length === 0 ? (
        <p className="mt-4 text-sm text-text-muted">
          Nothing matches{query.trim() ? ` “${query.trim()}”` : ""}
          {unitId ? " in this unit" : ""}.{" "}
          {unitId && (
            <button
              type="button"
              onClick={() => setUnitId("")}
              className="font-semibold text-primary hover:underline"
            >
              Search all units
            </button>
          )}
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          {groups.map((g) => (
            <section key={g.key || "loose"} aria-label={g.title}>
              <div className="flex items-baseline gap-2 pb-1.5">
                <h3 className="text-[13px] font-bold text-text-primary">{g.title}</h3>
                <span className="text-xs text-text-muted">
                  {g.detail ? `${g.detail} · ` : ""}
                  {g.items.length} approved
                </span>
              </div>
              {g.items.map((item) => (
                <QuestionRow
                  key={item.id}
                  item={item}
                  checked={selected.includes(item.id)}
                  onToggle={() => toggle(item.id)}
                  disabled={disabled}
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** The picker's footer line: what adding does, so no one hunts for a review step. */
export function bankSelectionNote(count: number): string {
  return `${count} selected · added as approved, no review needed`;
}
