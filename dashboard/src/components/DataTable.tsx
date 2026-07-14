import { useMemo, useState, type ReactNode } from "react";

/**
 * DataTable — the canonical table for every tab. Hairline row rules (no
 * zebra, no card chrome), a sticky mono-uppercase header with sortable
 * labels, numeric columns right-aligned in mono tabular-nums, a row
 * hover wash with a sienna left-tick, an optional 3px per-row status
 * bar, a trailing drill "→" affordance, and built-in loading (shimmer),
 * empty, and error+retry states.
 *
 * Generic over the row type; drive it with a columns config so a tab is
 * just data + column definitions. Sorting is internal (click a header).
 */

export interface Column<T> {
  /** Stable key; also the sort identity. */
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Right-aligns and mono-fonts the column (numbers, costs, counts). */
  numeric?: boolean;
  /** Provide to make the header sortable. Return a number or string. */
  sortValue?: (row: T) => number | string;
  /** colgroup width, e.g. "20%" or "120px". */
  width?: string;
  /** Override alignment independent of `numeric`. */
  align?: "left" | "right" | "center";
}

type SortDir = "asc" | "desc";

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Returns a CSS color for the row's 3px left status bar, or undefined. */
  rowStatus?: (row: T) => string | undefined;
  /** Show a trailing "→" drill affordance (implies rows are navigable). */
  drill?: boolean;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Empty-state content when there are zero rows and no error/loading. */
  empty?: ReactNode;
  /** Initial sort. Omit to keep the caller's row order. */
  defaultSort?: { key: string; dir?: SortDir };
  /** Min width before horizontal scroll kicks in. Default 640. */
  minWidth?: number;
  /** Rows rendered by the shimmer loader. Default 6. */
  loadingRows?: number;
}

export default function DataTable<T>({
  columns, rows, rowKey, onRowClick, rowStatus, drill,
  loading, error, onRetry, empty, defaultSort, minWidth = 640, loadingRows = 6,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(defaultSort?.key ?? null);
  const [sortDir, setSortDir] = useState<SortDir>(defaultSort?.dir ?? "desc");

  const colCount = columns.length + (drill ? 1 : 0);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (typeof av === "number" && typeof bv === "number") return dir * (av - bv);
      return dir * String(av).localeCompare(String(bv));
    });
  }, [rows, columns, sortKey, sortDir]);

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const alignOf = (c: Column<T>): "left" | "right" | "center" =>
    c.align ?? (c.numeric ? "right" : "left");

  return (
    <div className="dt-scroll">
      <table className="dt" style={{ minWidth }}>
        <colgroup>
          {columns.map((c) => (
            <col key={c.key} style={c.width ? { width: c.width } : undefined} />
          ))}
          {drill && <col style={{ width: 40 }} />}
        </colgroup>
        <thead>
          <tr>
            {columns.map((c) => {
              const sortable = !!c.sortValue;
              const active = sortKey === c.key;
              return (
                <th
                  key={c.key}
                  style={{ textAlign: alignOf(c) }}
                  aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                >
                  {sortable ? (
                    <button
                      type="button"
                      className={`dt-sort${active ? " dt-sort-active" : ""}`}
                      onClick={() => toggleSort(c.key)}
                    >
                      {c.header}
                      <span aria-hidden="true" className="dt-sort-caret">
                        {active ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
                      </span>
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
            {drill && <th aria-hidden="true" />}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: loadingRows }).map((_, i) => (
              <tr key={`sk-${i}`} className="dt-row dt-row-skeleton">
                {columns.map((c) => (
                  <td key={c.key} style={{ textAlign: alignOf(c) }}>
                    <span className="dt-shimmer" style={{ width: c.numeric ? "40%" : "70%" }} />
                  </td>
                ))}
                {drill && <td />}
              </tr>
            ))
          ) : error ? (
            <tr>
              <td colSpan={colCount}>
                <div className="dt-state" role="alert">
                  <div className="dt-state-title">Couldn't load this table.</div>
                  <div className="dt-state-sub">{error}</div>
                  {onRetry && (
                    <button type="button" className="dt-retry" onClick={onRetry}>Retry</button>
                  )}
                </div>
              </td>
            </tr>
          ) : sorted.length === 0 ? (
            <tr>
              <td colSpan={colCount}>
                <div className="dt-state">{empty ?? <span className="dt-state-title">Nothing here yet.</span>}</div>
              </td>
            </tr>
          ) : (
            sorted.map((row) => {
              const status = rowStatus?.(row);
              return (
                <tr
                  key={rowKey(row)}
                  className={`dt-row${onRowClick ? " dt-row-click" : ""}`}
                  style={status ? ({ "--row-status": status } as React.CSSProperties) : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={c.numeric ? "num" : undefined}
                      style={{ textAlign: alignOf(c) }}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                  {drill && <td className="dt-drill" aria-hidden="true">→</td>}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
