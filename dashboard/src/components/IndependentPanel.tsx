import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type UsersData } from "../lib/api";
import { fmtCost, formatRelativeDate } from "../lib/format";
import { activityStatus, activityPill, windowLabel } from "../lib/definitions";
import StatTile from "./StatTile";
import StatusPill from "./StatusPill";
import DataTable, { type Column } from "./DataTable";
import { Pagination, SearchInput } from "./Pagination";

/**
 * IndependentPanel — the shared listing surface for the two consumer
 * audiences that sit outside a school deal (Independent teachers,
 * Independent students). Deliberately light: a "who exists + basic
 * activity" view on the canonical foundation (StatTile + DataTable +
 * definitions), NOT an operator console. Money-in metrics (conversion,
 * MRR, revenue) are intentionally out of scope — the only dollar figure
 * is *our* cost, from logged LLM spend.
 *
 * The heavier per-user operator controls (subscription toggles, daily-
 * limit resets, deletion, classroom/attention filters) live on the
 * cross-cutting Users page and the per-teacher roster; this surface
 * stays a scannable directory that drills into detail on row-click.
 */

type Row = UsersData["users"][number];
// Server-side sort keys the /admin/users endpoint accepts. Every option
// maps to a column the operator can actually see, so the ordering is
// never a mystery. Ordering + pagination are both server-driven, so the
// list stays honest across the whole population (not just one page).
type SortKey = "total_cost" | "last_active" | "name";
const PAGE_SIZE = 25;

export interface IndependentPanelProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  role: "student" | "teacher";
  emptyMessage: string;
}

export default function IndependentPanel({
  eyebrow,
  title,
  subtitle,
  role,
  emptyMessage,
}: IndependentPanelProps) {
  const navigate = useNavigate();
  const [data, setData] = useState<UsersData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hours, setHours] = useState("720");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("total_cost");
  const [offset, setOffset] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    // Keep last-good data on refetch (no null flash) — the same pattern
    // Overview uses; state is only touched in the async callbacks, never
    // synchronously in the effect body.
    let cancelled = false;
    api
      .users({
        hours,
        sort_by: sortBy,
        limit: String(PAGE_SIZE),
        offset: String(offset),
        role,
        no_school: "true",
        ...(search ? { search } : {}),
      })
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load."); });
    return () => { cancelled = true; };
  }, [hours, search, sortBy, offset, role, reloadKey]);

  // Filter changes reset to the first page so the operator never lands
  // on an out-of-range offset.
  const onSearch = (v: string) => { setSearch(v); setOffset(0); };
  const onHours = (v: string) => { setHours(v); setOffset(0); };
  const onSort = (v: SortKey) => { setSortBy(v); setOffset(0); };

  const win = windowLabel(Number(hours));

  // Teachers drill into their roster; students have no dedicated detail
  // page, so their most useful drill-in is their logged AI calls.
  const rowHref = (u: Row) =>
    role === "teacher" ? `/teachers/${u.id}` : `/llm-calls?user=${u.id}`;

  // Columns render in the server-provided order (no client sort) so the
  // visible page always agrees with the sort control and pagination.
  const columns: Column<Row>[] = [
    {
      key: "user", header: "User", width: "36%",
      render: (u) => (
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontFamily: "var(--font-display)", fontSize: 16, color: "var(--ink)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {u.name || "—"}
          </div>
          <div style={{
            fontSize: 11.5, color: "var(--muted)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {u.email}
          </div>
        </div>
      ),
    },
    {
      key: "activity", header: "Activity", width: "20%",
      render: (u) => {
        const pill = activityPill(activityStatus(u.last_active));
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
            <StatusPill tone={pill.tone} label={pill.label} />
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
              {u.last_active ? formatRelativeDate(u.last_active) : "never"}
            </span>
          </div>
        );
      },
    },
    {
      key: "joined", header: "Joined", width: "14%",
      render: (u) => (
        <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }} title={new Date(u.registered).toLocaleString()}>
          {formatRelativeDate(u.registered)}
        </span>
      ),
    },
    {
      key: "cost", header: `Our cost (${win})`, numeric: true, width: "16%",
      render: (u) => (
        <span style={{ color: u.total_cost > 0 ? "var(--ink)" : "var(--muted-2)", fontWeight: 600 }}>
          {fmtCost(u.total_cost)}
        </span>
      ),
    },
    {
      key: "plan", header: "Plan", width: "14%",
      render: (u) => {
        const pro = u.subscription_tier === "pro";
        return (
          <span
            className="badge"
            style={pro
              ? { background: "var(--info-soft)", color: "var(--info)" }
              : { background: "transparent", color: "var(--muted)" }}
          >
            {pro ? "Pro" : "Free"}
            {pro && u.subscription_status !== "active" ? ` (${u.subscription_status})` : ""}
          </span>
        );
      },
    },
  ];

  return (
    <div>
      <div className="page-header">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>

      <div className="filters" style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <SearchInput value={search} onChange={onSearch} placeholder="Search by name or email…" />
        <select value={hours} onChange={(e) => onHours(e.target.value)}>
          <option value="24">Last 24 hours</option>
          <option value="168">Last 7 days</option>
          <option value="720">Last 30 days</option>
          <option value="2160">Last 90 days</option>
        </select>
        <select value={sortBy} onChange={(e) => onSort(e.target.value as SortKey)}>
          <option value="total_cost">Sort by cost</option>
          <option value="last_active">Sort by last active</option>
          <option value="name">Sort by name</option>
        </select>
      </div>

      <div className="tile-grid">
        <StatTile label="Total" value={data ? data.total_users.toLocaleString() : "—"} />
        <StatTile
          label={`New · ${win}`}
          value={data ? data.new_users.toLocaleString() : "—"}
          sub="signed up this window"
        />
        <StatTile
          label="Active"
          value={data ? data.active_7d.toLocaleString() : "—"}
          sub="used it in the last 7d"
        />
      </div>

      <div className="table-card">
        <DataTable
          columns={columns}
          rows={data?.users ?? []}
          rowKey={(u) => u.id}
          onRowClick={(u) => navigate(rowHref(u))}
          drill
          loading={!data && !error}
          error={error}
          onRetry={() => setReloadKey((k) => k + 1)}
          empty={
            <div>
              <div className="dt-state-title">{emptyMessage}</div>
              <div className="dt-state-sub">Adjust the search or window above, or check back later.</div>
            </div>
          }
          minWidth={720}
        />
        <Pagination
          offset={offset}
          limit={PAGE_SIZE}
          total={data?.filtered_count ?? 0}
          onChange={setOffset}
        />
      </div>
    </div>
  );
}
