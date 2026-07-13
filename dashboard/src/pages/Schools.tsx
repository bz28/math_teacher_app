import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type SchoolListItem } from "../lib/api";
import { formatRelativeDate } from "../lib/format";
import { btnGhost, btnPrimary, inputStyle } from "../lib/styles";
import StatCard from "../components/StatCard";
import { useConfirm } from "../lib/confirm";
import { useToast } from "../lib/toast";

const AT_RISK_DAYS = 14;

// Table filter tabs, mirroring the Leads all/active/stale pattern.
type SchoolFilter = "all" | "active" | "at-risk";
// Sortable columns. `null` key keeps the server's default ordering.
type SortKey = "cost" | "teachers" | "activity";
type SortDir = "asc" | "desc";

export default function Schools() {
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const [schools, setSchools] = useState<SchoolListItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Table filter + column sort. Sort defaults to the server order
  // (sortKey null); clicking a header selects it desc, then toggles.
  const [filter, setFilter] = useState<SchoolFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", contact_name: "", contact_email: "", city: "", state: "", notes: "" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; right: number }>({ right: 0 });
  const menuToggleRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Row id currently being deleted — drives the in-flight "Deleting…"
  // affordance after the confirm modal closes but before reload() lands.
  // Without this, a slow delete leaves the row visually idle while the
  // network is in motion, inviting a double-click.
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    api.schools().then((d) => setSchools(d.schools)).finally(() => setLoading(false));
  };

  useEffect(() => { reload(); }, []);

  function openMenuFor(schoolId: string) {
    if (openMenu === schoolId) { setOpenMenu(null); return; }
    const btn = menuToggleRefs.current[schoolId];
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 160) {
      setMenuPos({ bottom: window.innerHeight - rect.top + 4, right: window.innerWidth - rect.right });
    } else {
      setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpenMenu(schoolId);
  }

  useEffect(() => {
    if (!openMenu) return;
    const close = () => setOpenMenu(null);
    document.addEventListener("click", close);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [openMenu]);

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

  const handleToggleActive = async (school: SchoolListItem) => {
    const action = school.is_active ? "Deactivate" : "Activate";
    if (!(await confirm({
      title: `${action} ${school.name}?`,
      message: school.is_active
        ? "All teachers and students will lose access until the school is reactivated."
        : "Teachers and students will regain access on their next sign-in.",
      confirmLabel: action,
      variant: school.is_active ? "danger" : "primary",
    }))) return;
    try {
      await api.updateSchool(school.id, { is_active: !school.is_active });
      reload();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const handleDelete = async (school: SchoolListItem) => {
    if (!(await confirm({
      title: `Delete ${school.name}?`,
      message: (
        <>
          <strong>{school.teacher_count}</strong> teacher{school.teacher_count !== 1 ? "s" : ""} will be unlinked,
          all pending invites will be cancelled, and this can&apos;t be undone.
          {" "}If this school was converted from a lead, remember to update the lead status in the Leads tab.
        </>
      ),
      confirmLabel: "Delete school",
    }))) return;
    setDeletingId(school.id);
    try {
      await api.deleteSchool(school.id);
      reload();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setDeletingId(null);
    }
  };

  // Click a header: select it (desc) or, if already selected, flip
  // direction. Computed before the early return to keep hook order
  // stable.
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const visibleSchools = useMemo(() => {
    const filtered = schools.filter((s) => {
      if (filter === "active") return s.is_active;
      if (filter === "at-risk") return s.is_active && isAtRisk(s.last_activity_at);
      return true;
    });
    if (!sortKey) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    // Copy before sort — never mutate the source array in place.
    return [...filtered].sort((a, b) => dir * (sortValue(a, sortKey) - sortValue(b, sortKey)));
  }, [schools, filter, sortKey, sortDir]);

  if (loading) return <p className="loading">Loading…</p>;

  // Aggregates over the (current) school list — all displayed numbers
  // come from the same payload so the band is internally consistent.
  const totalSchools = schools.length;
  const activeSchools = schools.filter((s) => s.is_active).length;
  const costThisWindow = schools.reduce((s, x) => s + x.cost_30d, 0);
  const costPrevWindow = schools.reduce((s, x) => s + x.cost_prev_30d, 0);
  const atRiskCount = schools.filter((s) =>
    s.is_active && isAtRisk(s.last_activity_at),
  ).length;

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

      <div className="stat-grid">
        <StatCard
          label="Total schools"
          value={totalSchools}
          onClick={() => setFilter("all")}
          active={filter === "all"}
        />
        <StatCard
          label="Active"
          value={activeSchools}
          onClick={() => setFilter("active")}
          active={filter === "active"}
        />
        <StatCard
          label="Cost (30d)"
          value={`$${costThisWindow.toFixed(2)}`}
          sub={costPrevWindow > 0 ? deltaSub(costThisWindow, costPrevWindow) : "no prior data"}
        />
        <StatCard
          label="At risk"
          value={atRiskCount}
          onClick={() => setFilter("at-risk")}
          active={filter === "at-risk"}
          sub={`no activity ${AT_RISK_DAYS}d`}
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
          <div style={{ display: "flex", gap: 0, background: "var(--paper-2)", borderRadius: 3, padding: 2, border: "1px solid var(--rule)" }}>
            {(["all", "active", "at-risk"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: "6px 14px", border: "none", borderRadius: 2, fontSize: 11, fontWeight: 600, cursor: "pointer",
                  textTransform: "uppercase", letterSpacing: "1.2px",
                  fontFamily: "var(--font-sans)",
                  background: filter === f ? "var(--surface)" : "transparent",
                  color: filter === f ? "var(--ink)" : "var(--muted)",
                }}
              >
                {f === "all"
                  ? `All (${totalSchools})`
                  : f === "active"
                    ? `Active (${activeSchools})`
                    : `At risk (${atRiskCount})`}
              </button>
            ))}
          </div>
        </div>
        <table>
          <colgroup>
            <col style={{ width: "20%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "11%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "5%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>School</th>
              <SortableTh label="Teachers" col="teachers" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortableTh label="Cost (30d)" col="cost" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <th>vs prev</th>
              <SortableTh label="Last activity" col="activity" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <th>Status</th>
              <th>Notes</th>
              <th>Added</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibleSchools.map((s) => {
              const isDeleting = deletingId === s.id;
              return (
              <tr
                key={s.id}
                className="clickable"
                style={{ opacity: isDeleting ? 0.4 : s.is_active ? 1 : 0.55, pointerEvents: isDeleting ? "none" : undefined }}
                onClick={() => navigate(`/schools/${s.id}`)}
              >
                <td>
                  <div>
                    <Link
                      to={`/schools/${s.id}`}
                      style={{
                        color: "var(--ink)",
                        fontFamily: "var(--font-display)",
                        fontSize: 17,
                        textDecoration: "none",
                      }}
                    >
                      {s.name}
                    </Link>
                    <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
                      {s.contact_name} · {s.contact_email}
                    </div>
                    {(s.city || s.state) && (
                      <div style={{ fontSize: 11, color: "var(--muted-2)" }}>
                        {[s.city, s.state].filter(Boolean).join(", ")}
                      </div>
                    )}
                  </div>
                </td>
                <td className="num">{s.teacher_count}</td>
                <td className="num" style={{ color: s.cost_30d > 0 ? "var(--ink)" : "var(--muted-2)" }}>
                  ${s.cost_30d.toFixed(2)}
                </td>
                <td className="num" style={{ fontSize: 12 }}>
                  {s.cost_prev_30d > 0 ? deltaInline(s.cost_30d, s.cost_prev_30d) : <span style={{ color: "var(--muted-2)" }}>—</span>}
                </td>
                <td style={{ fontSize: 12 }}>
                  {s.last_activity_at ? (
                    <span style={{ color: isAtRisk(s.last_activity_at) ? "var(--accent)" : "var(--ink-soft)" }}>
                      {formatRelativeDate(s.last_activity_at)}
                    </span>
                  ) : (
                    <span style={{ color: "var(--muted-2)" }}>none yet</span>
                  )}
                </td>
                <td>
                  <span className="list-row-status">
                    <span aria-hidden="true" className={`dot ${s.is_active ? "dot-ok" : "dot-muted"}`}>●</span>
                    {s.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td>
                  {s.notes ? (
                    <div style={{ fontSize: 12, color: "var(--ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.notes}>
                      {s.notes}
                    </div>
                  ) : (
                    <span style={{ color: "var(--muted-2)", fontSize: 12 }}>—</span>
                  )}
                </td>
                <td style={{ fontSize: 12, color: "var(--muted)" }}>{formatRelativeDate(s.created_at)}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <button
                    ref={(el) => { menuToggleRefs.current[s.id] = el; }}
                    className="action-toggle"
                    disabled={isDeleting}
                    onClick={(e) => { e.stopPropagation(); openMenuFor(s.id); }}
                  >
                    {isDeleting ? "Deleting…" : "…"}
                  </button>
                  {openMenu === s.id && (
                    <div
                      className="action-dropdown"
                      style={{
                        ...(menuPos.top != null ? { top: menuPos.top } : {}),
                        ...(menuPos.bottom != null ? { bottom: menuPos.bottom } : {}),
                        right: menuPos.right,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button onClick={() => { setOpenMenu(null); navigate(`/schools/${s.id}`); }}>
                        View details
                      </button>
                      <button onClick={() => { setOpenMenu(null); handleToggleActive(s); }}>
                        {s.is_active ? "Deactivate" : "Activate"}
                      </button>
                      <button className="danger" onClick={() => { setOpenMenu(null); handleDelete(s); }}>
                        Delete school
                      </button>
                    </div>
                  )}
                </td>
              </tr>
              );
            })}
            {visibleSchools.length === 0 && (
              <tr>
                <td colSpan={9}>
                  <div className="empty-state">
                    {schools.length === 0 ? (
                      <>
                        <div className="empty-state-title">No schools yet.</div>
                        <div className="empty-state-sub">Click "+ Add school" when you close your first deal.</div>
                      </>
                    ) : filter === "at-risk" ? (
                      <>
                        <div className="empty-state-title">Nothing at risk.</div>
                        <div className="empty-state-sub">
                          Every active school has been touched in the last {AT_RISK_DAYS} days.{" "}
                          <button onClick={() => setFilter("all")} className="link-btn">View all schools</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="empty-state-title">No active schools.</div>
                        <div className="empty-state-sub">
                          All schools are inactive.{" "}
                          <button onClick={() => setFilter("all")} className="link-btn">View all schools</button>
                        </div>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}

/* ── Sortable header ───────────────────────────────────────────── */

function SortableTh({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey | null;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = sortKey === col;
  return (
    <th>
      <button
        type="button"
        onClick={() => onSort(col)}
        aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          border: "none",
          background: "transparent",
          padding: 0,
          font: "inherit",
          color: active ? "var(--ink)" : "inherit",
          cursor: "pointer",
          letterSpacing: "inherit",
          textTransform: "inherit",
        }}
      >
        {label}
        <span aria-hidden="true" style={{ fontSize: 9, color: active ? "var(--accent)" : "var(--muted-2)" }}>
          {active ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
        </span>
      </button>
    </th>
  );
}

/* ── Helpers ───────────────────────────────────────────────────── */

// Numeric sort key per column. `last_activity_at` maps to a timestamp
// (null → 0, i.e. "never active" sorts as the stalest) so activity
// asc surfaces the most at-risk schools first.
function sortValue(s: SchoolListItem, key: SortKey): number {
  if (key === "cost") return s.cost_30d;
  if (key === "teachers") return s.teacher_count;
  return s.last_activity_at ? new Date(s.last_activity_at).getTime() : 0;
}

function isAtRisk(lastActivityAt: string | null): boolean {
  if (!lastActivityAt) return true;
  const age = Date.now() - new Date(lastActivityAt).getTime();
  return age > AT_RISK_DAYS * 24 * 60 * 60 * 1000;
}

function deltaSub(curr: number, prev: number): string {
  if (prev === 0) return "no prior data";
  const pct = ((curr - prev) / prev) * 100;
  const arrow = pct > 0 ? "↑" : pct < 0 ? "↓" : "→";
  return `${arrow} ${Math.abs(pct).toFixed(0)}% vs prev`;
}

function deltaInline(curr: number, prev: number) {
  if (prev === 0) return <span style={{ color: "var(--muted-2)" }}>—</span>;
  const pct = ((curr - prev) / prev) * 100;
  const up = pct > 0;
  return (
    <span style={{ color: up ? "var(--accent)" : pct < 0 ? "var(--ok)" : "var(--muted)" }}>
      {up ? "↑" : pct < 0 ? "↓" : "→"} {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

/* ── Shared sub-components ──────────────────────────────────────── */

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

