import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type UsersData } from "../lib/api";
import { formatRelativeDate } from "../lib/format";
import StatCard from "../components/StatCard";
import { Pagination, SearchInput } from "../components/Pagination";

type SortKey = "total_cost" | "session_count" | "last_active" | "name";
const PAGE_SIZE = 25;

export default function Users() {
  const navigate = useNavigate();
  const [data, setData] = useState<UsersData | null>(null);
  const [hours, setHours] = useState("720");
  const [sortBy, setSortBy] = useState<SortKey>("total_cost");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const reload = () =>
    api.users({
      hours,
      sort_by: sortBy,
      limit: String(PAGE_SIZE),
      offset: String(offset),
      ...(search ? { search } : {}),
    }).then(setData);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [hours, sortBy, search, offset]);

  // Reset to first page when filters change
  const handleSearchChange = (v: string) => { setSearch(v); setOffset(0); };
  const handleSortChange = (v: SortKey) => { setSortBy(v); setOffset(0); };
  const handleHoursChange = (v: string) => { setHours(v); setOffset(0); };

  useEffect(() => {
    if (!openMenu) return;
    const close = () => setOpenMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [openMenu]);

  if (!data) return <p>Loading...</p>;

  const topSpender = data.users.length > 0 ? data.users[0] : null;

  const handleChangeRole = async (userId: string, newRole: string) => {
    if (!confirm(`Change this user's role to "${newRole}"?`)) return;
    try {
      await api.updateUserRole(userId, newRole);
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleToggleSubscription = async (userId: string, currentTier: string) => {
    const isPro = currentTier === "pro";
    const action = isPro ? "downgrade to Free" : "upgrade to Pro";
    if (!confirm(`${action} for this user?`)) return;
    try {
      await api.updateUserSubscription(
        userId,
        isPro ? "free" : "pro",
        isPro ? "none" : "active",
      );
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleResetLimit = async (userId: string) => {
    if (!confirm("Reset this user's daily usage limits? They'll be able to use the app as if the day just started.")) return;
    try {
      await api.resetDailyLimit(userId);
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleDelete = async (userId: string, email: string) => {
    if (!confirm(`Delete user ${email}? This cannot be undone.`)) return;
    try {
      await api.deleteUser(userId);
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <div>
      <h1>Users</h1>

      <div className="filters" style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <SearchInput value={search} onChange={handleSearchChange} placeholder="Search by name or email..." />
        <select value={hours} onChange={(e) => handleHoursChange(e.target.value)}>
          <option value="24">Last 24 hours</option>
          <option value="168">Last 7 days</option>
          <option value="720">Last 30 days</option>
          <option value="2160">Last 90 days</option>
        </select>
      </div>

      <div className="stat-grid">
        <StatCard label="Total Users" value={data.total_users} />
        <StatCard label="Active (7d)" value={data.active_7d} />
        <StatCard label="Total Spend" value={`$${data.total_spend.toFixed(2)}`} />
        <StatCard
          label="Top Spender"
          value={topSpender ? `$${topSpender.total_cost.toFixed(2)}` : "-"}
          sub={topSpender?.name || topSpender?.email || "-"}
        />
      </div>

      <div className="table-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ marginBottom: 0 }}>
            {search ? `Results for "${search}"` : "All Users"}
            <span style={{ fontWeight: 400, color: "#94a3b8", marginLeft: 8 }}>
              ({data.filtered_count})
            </span>
          </h3>
          <select value={sortBy} onChange={(e) => handleSortChange(e.target.value as SortKey)} style={{ fontSize: 13 }}>
            <option value="total_cost">Sort by Cost</option>
            <option value="session_count">Sort by Sessions</option>
            <option value="last_active">Sort by Last Active</option>
            <option value="name">Sort by Name</option>
          </select>
        </div>
        <div className="table-scroll">
        <table>
          <colgroup>
            <col style={{ width: "22%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "28%" }} />
            <col style={{ width: "8%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "14%" }} />
            <col style={{ width: "8%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>User</th>
              <th>Plan</th>
              <th>Today&apos;s Usage</th>
              <th>Sessions</th>
              <th>Cost</th>
              <th>Joined / Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id}>
                <td style={{ overflow: "hidden" }}>
                  <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {u.name || "-"}
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {u.email}
                  </div>
                  <div style={{ display: "flex", gap: 4, marginTop: 2, flexWrap: "wrap" }}>
                    <span
                      className={`badge ${u.role === "admin" ? "badge-active" : u.role === "teacher" ? "badge-warning" : "badge-completed"}`}
                    >
                      {u.role}
                    </span>
                    {u.grade_level > 0 && (
                      <span className="badge" style={{ background: "#f0f9ff", color: "#0369a1" }}>
                        {gradeLabel(u.grade_level)}
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  <span
                    className="badge"
                    style={{
                      background: u.subscription_tier === "pro" ? "#dbeafe" : "#f1f5f9",
                      color: u.subscription_tier === "pro" ? "#2563eb" : "#64748b",
                    }}
                  >
                    {u.subscription_tier === "pro" ? "Pro" : "Free"}
                    {u.subscription_tier === "pro" && u.subscription_status !== "active"
                      ? ` (${u.subscription_status})`
                      : ""}
                  </span>
                </td>
                <td>
                  <div style={{ display: "flex", gap: 6, fontSize: 11, flexWrap: "wrap" }}>
                    <UsagePill label="P" used={u.daily_usage.sessions} limit={u.daily_usage.sessions_limit} title="Problems" />
                    <UsagePill label="C" used={u.daily_usage.chats} limit={u.daily_usage.chats_limit} title="Chats" />
                    <UsagePill label="S" used={u.daily_usage.scans} limit={u.daily_usage.scans_limit} title="Scans" />
                  </div>
                </td>
                <td>{u.session_count}</td>
                <td style={{ fontWeight: u.total_cost > 0 ? 600 : 400 }}>
                  ${u.total_cost.toFixed(4)}
                </td>
                <td>
                  <div style={{ fontSize: 12 }} title={new Date(u.registered).toLocaleString()}>
                    <span style={{ color: "#94a3b8" }}>Joined </span>{formatRelativeDate(u.registered)}
                  </div>
                  <div style={{ fontSize: 12 }} title={u.last_active ? new Date(u.last_active).toLocaleString() : undefined}>
                    <span style={{ color: "#94a3b8" }}>Active </span>{u.last_active ? formatRelativeDate(u.last_active) : "-"}
                  </div>
                </td>
                <td>
                  <div className="action-menu-wrapper">
                    <button
                      className="action-toggle"
                      onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === u.id ? null : u.id); }}
                    >
                      ...
                    </button>
                    {openMenu === u.id && (
                      <div className="action-dropdown" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => { setOpenMenu(null); navigate(`/llm-calls?user=${u.id}`); }}>
                          View Calls
                        </button>
                        <button onClick={() => { setOpenMenu(null); handleToggleSubscription(u.id, u.subscription_tier); }}>
                          {u.subscription_tier === "pro" ? "Downgrade Plan" : "Upgrade Plan"}
                        </button>
                        {(["student", "teacher", "admin"] as const).filter((r) => r !== u.role).map((r) => (
                          <button key={r} onClick={() => { setOpenMenu(null); handleChangeRole(u.id, r); }}>
                            Make {r.charAt(0).toUpperCase() + r.slice(1)}
                          </button>
                        ))}
                        {u.subscription_tier !== "pro" && (
                          <button onClick={() => { setOpenMenu(null); handleResetLimit(u.id); }}>
                            Reset Daily Limits
                          </button>
                        )}
                        <button className="danger" onClick={() => { setOpenMenu(null); handleDelete(u.id, u.email); }}>
                          Delete User
                        </button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {data.users.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: "center", color: "#999" }}>No users found</td></tr>
            )}
          </tbody>
        </table>
        </div>
        <Pagination
          offset={offset}
          limit={PAGE_SIZE}
          total={data.filtered_count}
          onChange={setOffset}
        />
      </div>
    </div>
  );
}

function gradeLabel(grade: number): string {
  if (grade <= 2) return "K-2";
  if (grade <= 5) return "3-5";
  if (grade <= 8) return "6-8";
  if (grade <= 12) return "9-12";
  return "College";
}

function UsagePill({ label, used, limit, title }: { label: string; used: number; limit: number | null; title: string }) {
  const isUnlimited = limit === null;
  const atLimit = !isUnlimited && used >= limit;
  return (
    <span
      style={{
        padding: "2px 5px",
        borderRadius: 4,
        fontWeight: 600,
        background: atLimit ? "#fef2f2" : isUnlimited ? "#f0fdf4" : "#f8fafc",
        color: atLimit ? "#ef4444" : isUnlimited ? "#16a34a" : "#475569",
        border: `1px solid ${atLimit ? "#fecaca" : isUnlimited ? "#bbf7d0" : "#e2e8f0"}`,
        whiteSpace: "nowrap" as const,
      }}
      title={`${title}: ${used}${isUnlimited ? " (unlimited)" : ` / ${limit}`}`}
    >
      {label}: {used}{isUnlimited ? "/\u221e" : `/${limit}`}
    </span>
  );
}
