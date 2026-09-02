import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type SchoolListItem } from "../lib/api";
import { formatRelativeDate, fmtCost } from "../lib/format";
import { BOARD_PAGE_SIZE } from "../lib/pagination";
import { btnGhost, btnPrimary, inputStyle } from "../lib/styles";
import {
  STALE_AFTER_DAYS,
  activityPill,
  activityStatus,
  costWindowLabel,
  isAtRisk,
} from "../lib/definitions";
import StatTile from "../components/StatTile";
import StatusPill from "../components/StatusPill";
import DataTable, { type Column } from "../components/DataTable";
import ErrorState from "../components/ErrorState";

const USAGE_WINDOW = "7d";

// Table filter tabs, mirroring the Leads all/active/stale pattern.
type SchoolFilter = "all" | "active" | "at-risk";

// Per-school risk rank for the default ordering — the whole point of
// the tab is to surface an at-risk-yet-valuable pilot in 3 seconds.
// Failing (2) outranks merely stale (1); deactivated schools sink
// below everything (-1) since we turned them off deliberately.
function riskRank(s: SchoolListItem): number {
  if (!s.is_active) return -1;
  if (s.failed_calls_24h > 0) return 2;
  if (isAtRisk({ lastActiveAt: s.last_active_at })) return 1;
  return 0;
}

export default function Schools() {
  const navigate = useNavigate();
  const [schools, setSchools] = useState<SchoolListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SchoolFilter>("all");

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", contact_name: "", contact_email: "", city: "", state: "", notes: "" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    api.schools()
      .then((d) => { setSchools(d.schools); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load schools."))
      .finally(() => setLoading(false));
  };

  useEffect(() => { reload(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await api.createSchool({
        name: createForm.name.trim(),
        contact_name: createForm.contact_name.trim(),
        contact_email: createForm.contact_email.trim(),
        city: createForm.city.trim() || undefined,
        state: createForm.state.trim() || undefined,
        notes: createForm.notes.trim() || undefined,
      });
      setCreateForm({ name: "", contact_name: "", contact_email: "", city: "", state: "", notes: "" });
      setShowCreate(false);
      reload();
    } catch (e) {
      setCreateError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  // Aggregates over the full list — every headline number comes from
  // the same payload so the tiles and table can't disagree.
  const totalSchools = schools.length;
  const activeSchools = schools.filter((s) => s.is_active).length;
  const totalStudents = schools.reduce((n, s) => n + s.student_count, 0);
  const costThisWindow = schools.reduce((n, s) => n + s.cost_30d, 0);
  const costPrevWindow = schools.reduce((n, s) => n + s.cost_prev_30d, 0);
  const atRiskCount = schools.filter((s) => riskRank(s) > 0).length;
  const costDeltaPct = costPrevWindow > 0
    ? ((costThisWindow - costPrevWindow) / costPrevWindow) * 100
    : null;

  // Filter, then rank so at-risk × high-value leads. Default order is
  // risk desc, then cost desc; clicking any header hands sorting to
  // DataTable (which reads the column's sortValue).
  const visibleSchools = useMemo(() => {
    const filtered = schools.filter((s) => {
      if (filter === "active") return s.is_active;
      if (filter === "at-risk") return riskRank(s) > 0;
      return true;
    });
    return [...filtered].sort((a, b) => {
      const r = riskRank(b) - riskRank(a);
      return r !== 0 ? r : b.cost_30d - a.cost_30d;
    });
  }, [schools, filter]);

  const columns: Column<SchoolListItem>[] = [
    {
      key: "school", header: "School", width: "24%",
      sortValue: (s) => s.name.toLowerCase(),
      render: (s) => {
        const pill = s.is_active
          ? activityPill(activityStatus(s.last_active_at))
          : { tone: "neutral" as const, label: "INACTIVE" };
        return (
          <div style={{ minWidth: 0, opacity: s.is_active ? 1 : 0.6 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {s.name}
            </div>
            <div style={{ marginTop: 4 }}>
              <StatusPill {...pill} />
            </div>
          </div>
        );
      },
    },
    {
      key: "teachers", header: "Teachers", numeric: true, width: "9%",
      sortValue: (s) => s.teacher_count,
      render: (s) => <span style={{ color: s.teacher_count > 0 ? "var(--ink)" : "var(--muted-2)" }}>{s.teacher_count}</span>,
    },
    {
      key: "students", header: "Students", numeric: true, width: "9%",
      sortValue: (s) => s.student_count,
      render: (s) => <span style={{ color: s.student_count > 0 ? "var(--ink)" : "var(--muted-2)" }}>{s.student_count}</span>,
    },
    {
      key: "usage", header: `Usage · ${USAGE_WINDOW}`, numeric: true, width: "11%",
      sortValue: (s) => s.submissions_7d,
      render: (s) => (
        <span title="Submissions in the last 7 days" style={{ color: s.submissions_7d > 0 ? "var(--ink)" : "var(--muted-2)" }}>
          {s.submissions_7d}
        </span>
      ),
    },
    {
      key: "cost", header: `Cost · ${costWindowLabel()}`, numeric: true, width: "16%",
      sortValue: (s) => s.cost_30d,
      render: (s) => (
        <span style={{ display: "inline-flex", alignItems: "baseline", gap: 8, justifyContent: "flex-end" }}>
          <span style={{ color: s.cost_30d > 0 ? "var(--ink)" : "var(--muted-2)", fontWeight: 600 }}>{fmtCost(s.cost_30d)}</span>
          {deltaInline(s.cost_30d, s.cost_prev_30d)}
        </span>
      ),
    },
    {
      key: "activity", header: "Last activity", width: "13%",
      sortValue: (s) => (s.last_active_at ? new Date(s.last_active_at).getTime() : 0),
      render: (s) => {
        if (!s.last_active_at) return <span style={{ color: "var(--muted-2)", fontSize: 12 }}>none yet</span>;
        const atRisk = s.is_active && isAtRisk({ lastActiveAt: s.last_active_at });
        return (
          <span style={{ fontSize: 12, color: atRisk ? "var(--accent)" : "var(--ink-soft)" }}>
            {formatRelativeDate(s.last_active_at)}
          </span>
        );
      },
    },
    {
      key: "health", header: "Health", numeric: true, width: "9%",
      sortValue: (s) => s.failed_calls_24h,
      render: (s) =>
        s.failed_calls_24h > 0 ? (
          <span
            title={`${s.failed_calls_24h} AI call${s.failed_calls_24h === 1 ? "" : "s"} failing in the last 24h`}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, justifyContent: "flex-end", color: "var(--danger)", fontWeight: 600 }}
          >
            <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--danger)" }} />
            {s.failed_calls_24h}
          </span>
        ) : (
          <span aria-hidden="true" title="No failing calls in the last 24h" style={{ color: "var(--muted-2)" }}>·</span>
        ),
    },
  ];

  if (error && schools.length === 0) {
    return <ErrorState message={error} onRetry={reload} />;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <span className="eyebrow">Audience</span>
          <h1>Schools</h1>
          <p>
            {totalSchools === 0
              ? "No schools yet."
              : `${totalSchools} school${totalSchools === 1 ? "" : "s"}. ${activeSchools} active.${atRiskCount > 0 ? ` ${atRiskCount} at risk.` : ""}`}
          </p>
        </div>
        {!showCreate && (
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            + Add school
          </button>
        )}
      </div>

      {/* ── Headline tiles — clickable ones drive the table filter ── */}
      <div className="tile-grid">
        <StatTile
          label="Total schools"
          value={totalSchools}
          onClick={() => setFilter("all")}
          active={filter === "all"}
        />
        <StatTile
          label="Active"
          value={activeSchools}
          sub={`${totalSchools - activeSchools} inactive`}
          onClick={() => setFilter("active")}
          active={filter === "active"}
        />
        <StatTile
          label="Students"
          value={totalStudents.toLocaleString()}
          sub="enrolled across all schools"
        />
        <StatTile
          label={`Cost · ${costWindowLabel()}`}
          value={fmtCost(costThisWindow)}
          delta={costDeltaPct === null ? undefined : { pct: costDeltaPct, goodWhen: "down", note: "vs prev 30d" }}
        />
        <StatTile
          label="At risk"
          tone={atRiskCount > 0 ? "danger" : "default"}
          value={atRiskCount}
          sub={`failing, or quiet ${STALE_AFTER_DAYS}d+`}
          onClick={() => setFilter("at-risk")}
          active={filter === "at-risk"}
        />
      </div>

      {/* ── Create form ─────────────────────────────────────────── */}
      {showCreate && (
        <div className="table-card" style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ marginBottom: 0 }}>Add new school</h3>
            <button onClick={() => { setShowCreate(false); setCreateError(null); }} style={btnGhost}>Cancel</button>
          </div>
          {createError && (
            <div style={{ marginBottom: 12, padding: "8px 12px", background: "var(--danger-soft)", borderRadius: 3, border: "1px solid rgba(138, 35, 23, 0.3)", fontSize: 13, color: "var(--danger)" }}>
              {createError}
            </div>
          )}
          <form onSubmit={handleCreate} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <FormField label="School name">
              <input type="text" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} placeholder="Lincoln High School" required style={inputStyle} />
            </FormField>
            <FormField label="Contact name">
              <input type="text" value={createForm.contact_name} onChange={(e) => setCreateForm({ ...createForm, contact_name: e.target.value })} placeholder="Jane Smith" required style={inputStyle} />
            </FormField>
            <FormField label="Contact email">
              <input type="email" value={createForm.contact_email} onChange={(e) => setCreateForm({ ...createForm, contact_email: e.target.value })} placeholder="jsmith@school.edu" required style={inputStyle} />
            </FormField>
            <div style={{ display: "flex", gap: 12 }}>
              <FormField label="City">
                <input type="text" value={createForm.city} onChange={(e) => setCreateForm({ ...createForm, city: e.target.value })} placeholder="San Francisco" style={inputStyle} />
              </FormField>
              <FormField label="State">
                <input type="text" value={createForm.state} onChange={(e) => setCreateForm({ ...createForm, state: e.target.value })} placeholder="CA" style={{ ...inputStyle, maxWidth: 80 }} />
              </FormField>
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <FormField label="Internal notes (optional)">
                <textarea value={createForm.notes} onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })} placeholder="Deal context, pricing, etc." rows={2} style={{ ...inputStyle, resize: "vertical" }} />
              </FormField>
            </div>
            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
              <button type="submit" disabled={creating} style={{ ...btnPrimary, opacity: creating ? 0.6 : 1 }}>
                {creating ? "Creating…" : "Add school"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Schools table ───────────────────────────────────────── */}
      <div className="table-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ marginBottom: 0 }}>
            {filter === "active" ? "Active schools" : filter === "at-risk" ? "At-risk schools" : "All schools"}
            <span style={{ fontWeight: 400, color: "var(--muted-2)", marginLeft: 8 }}>({visibleSchools.length})</span>
          </h3>
          <div style={{ display: "flex", background: "var(--paper-2)", borderRadius: 3, padding: 2, border: "1px solid var(--rule)" }}>
            {(["all", "active", "at-risk"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: "6px 14px", border: "none", borderRadius: 2, fontSize: 11, fontWeight: 600, cursor: "pointer",
                  textTransform: "uppercase", letterSpacing: "1.2px", fontFamily: "var(--font-sans)",
                  background: filter === f ? "var(--surface)" : "transparent",
                  color: filter === f ? "var(--ink)" : "var(--muted)",
                }}
              >
                {f === "all" ? `All (${totalSchools})` : f === "active" ? `Active (${activeSchools})` : `At risk (${atRiskCount})`}
              </button>
            ))}
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={visibleSchools}
          rowKey={(s) => s.id}
          onRowClick={(s) => navigate(`/schools/${s.id}`)}
          drill
          loading={loading}
          minWidth={860}
          // Client-side, unlike the server-paged tables elsewhere: this
          // endpoint returns every school in one payload. Names repeat
          // heavily in the real data, so city/state are searchable too —
          // typing "Lincoln" alone would match fourteen rows.
          searchKeys={(s) => [s.name, s.city, s.state, s.contact_email]}
          searchLabel="schools"
          pageSize={BOARD_PAGE_SIZE}
          rowStatus={(s) =>
            s.failed_calls_24h > 0
              ? "var(--danger)"
              : s.is_active && isAtRisk({ lastActiveAt: s.last_active_at })
                ? "var(--accent)"
                : undefined
          }
          empty={
            schools.length === 0 ? (
              <div>
                <div className="dt-state-title">No schools yet.</div>
                <div className="dt-state-sub">Click "+ Add school" when you close your first deal.</div>
              </div>
            ) : filter === "at-risk" ? (
              <div>
                <div className="dt-state-title">Nothing at risk.</div>
                <div className="dt-state-sub">
                  Every active school is healthy and touched within {STALE_AFTER_DAYS} days.{" "}
                  <button onClick={() => setFilter("all")} className="link-btn">View all schools</button>
                </div>
              </div>
            ) : (
              <div>
                <div className="dt-state-title">No active schools.</div>
                <div className="dt-state-sub">
                  All schools are inactive.{" "}
                  <button onClick={() => setFilter("all")} className="link-btn">View all schools</button>
                </div>
              </div>
            )
          }
        />
      </div>
    </div>
  );
}

/* ── Helpers ───────────────────────────────────────────────────── */

// Inline cost trend vs the prior 30d window. Up (spending more) reads
// sienna, down reads moss — matches the tile delta convention.
function deltaInline(curr: number, prev: number) {
  if (prev <= 0) return null;
  const pct = ((curr - prev) / prev) * 100;
  if (Math.round(pct) === 0) return <span style={{ color: "var(--muted-2)", fontSize: 11 }}>→ 0%</span>;
  const up = pct > 0;
  return (
    <span style={{ color: up ? "var(--accent)" : "var(--ok)", fontSize: 11, fontWeight: 500 }}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
      <label style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", color: "var(--muted)", letterSpacing: 0.5 }}>
        {label}
      </label>
      {children}
    </div>
  );
}
