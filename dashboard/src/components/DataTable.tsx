import { useMemo, useState, type ReactNode } from "react";

import { Pagination, SearchInput } from "./Pagination";

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
 *
 * Long lists: pass `searchKeys` and/or `pageSize` and the table grows a
 * search box and a pager ON ITS OWN, but only once the list is long enough
 * to need them (see LONG_LIST_THRESHOLD). Both used to be wired by hand per
 * page, which meant most tables never got them at all — a roster reads fine
 * at six teachers and is unusable at sixty, and nobody notices until the day
 * it happens. Owning the behaviour here means every table crosses that line
 * correctly without anyone remembering to.
 */

// Below this many rows a search box and pager are noise: the list already
// fits on screen and the eye beats typing.
export const LONG_LIST_THRESHOLD = 10;

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
  /** Fields a search query matches against. Omit for no search. */
  searchKeys?: (row: T) => (string | null | undefined)[];
  /** Rows per page. Omit to render every row. */
  pageSize?: number;
  /** Noun used in the search placeholder and empty copy, e.g. "teachers". */
  searchLabel?: string;
}

export default function DataTable<T>({
  columns, rows, rowKey, onRowClick, rowStatus, drill,
  loading, error, onRetry, empty, defaultSort, minWidth = 640, loadingRows = 6,
  searchKeys, pageSize, searchLabel = "rows",
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

  // Both affordances stay hidden until the list is genuinely long, so a
  // caller opting in doesn't force chrome onto a table of three.
  const longEnough = rows.length > LONG_LIST_THRESHOLD;
  const canSearch = !!searchKeys && longEnough;
  const canPage = !!pageSize && longEnough;

  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!canSearch || !q) return sorted;
    return sorted.filter((row) =>
      searchKeys!(row).some((v) => (v ?? "").toLowerCase().includes(q)),
    );
  }, [sorted, query, canSearch, searchKeys]);

  // Clamp rather than reset-in-an-effect. The stored offset can outrun the
  // list whenever it shrinks under you — a search narrowing the results, a
  // parent refetch returning fewer rows — and slicing past the end renders
  // an empty table that reads as "no results" instead of "wrong page".
  // Deriving it during render also means there is no cascading re-render,
  // and no window where the two disagree.
  const maxOffset =
    canPage && filtered.length > 0
      ? Math.floor((filtered.length - 1) / pageSize!) * pageSize!
      : 0;
  const safeOffset = Math.min(offset, maxOffset);

  const visible = useMemo(
    () => (canPage ? filtered.slice(safeOffset, safeOffset + pageSize!) : filtered),
    [filtered, canPage, safeOffset, pageSize],
  );

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const alignOf = (c: Column<T>): "left" | "right" | "center" =>
    c.align ?? (c.numeric ? "right" : "left");

  return (
    <>
      {canSearch && !loading && !error && (
        <div className="dt-toolbar">
          <SearchInput
            value={query}
            onChange={(v) => {
              setQuery(v);
              setOffset(0);
            }}
            placeholder={`Search ${searchLabel}\u2026`}
            ariaLabel={`Search ${searchLabel}`}
          />
          <span className="dt-count">
            {filtered.length === rows.length
              ? `${rows.length} ${searchLabel}`
              : `${filtered.length} of ${rows.length}`}
          </span>
        </div>
      )}
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
          ) : visible.length === 0 ? (
            <tr>
              <td colSpan={colCount}>
                <div className="dt-state">
                  {query.trim() ? (
                    <>
                      <span className="dt-state-title">
                        No {searchLabel} match &ldquo;{query.trim()}&rdquo;.
                      </span>
                      <div className="dt-state-sub">
                        <button
                          type="button"
                          className="dt-retry"
                          onClick={() => setQuery("")}
                        >
                          Clear search
                        </button>
                      </div>
                    </>
                  ) : (
                    empty ?? <span className="dt-state-title">Nothing here yet.</span>
                  )}
                </div>
              </td>
            </tr>
          ) : (
            visible.map((row) => {
              const status = rowStatus?.(row);
              return (
                <tr
                  key={rowKey(row)}
                  className={`dt-row${onRowClick ? " dt-row-click" : ""}`}
                  style={status ? ({ "--row-status": status } as React.CSSProperties) : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  // Clickable rows are the primary affordance on most tabs, so
                  // they have to be reachable without a mouse. We keep the <tr>
                  // (rather than role="button", which would strip the row out of
                  // the table semantics screen readers rely on) and add the two
                  // things a native button would give us: focus and Enter/Space.
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          // Only when the row itself has focus. Cells can hold
                          // their own controls (Users' row-actions button),
                          // which stopPropagation on click — but a keydown
                          // from one would still bubble here and fire the row
                          // handler on top of the button's own action. No tab
                          // pairs onRowClick with an inner control today; this
                          // keeps that combination from silently breaking.
                          if (e.target !== e.currentTarget) return;
                          if (e.key !== "Enter" && e.key !== " ") return;
                          e.preventDefault(); // Space would scroll the page
                          onRowClick(row);
                        }
                      : undefined
                  }
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
      {canPage && !loading && !error && filtered.length > pageSize! && (
        <Pagination
          offset={safeOffset}
          limit={pageSize!}
          total={filtered.length}
          onChange={setOffset}
        />
      )}
    </>
  );
}
