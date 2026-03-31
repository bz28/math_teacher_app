import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { api, type UsersData } from "../lib/api";
import StatCard from "../components/StatCard";

type SortKey = "total_cost" | "session_count" | "last_active" | "name";

export default function Users() {
  const navigate = useNavigate();
  const [data, setData] = useState<UsersData | null>(null);
  const [hours, setHours] = useState("720");
  const [sortBy, setSortBy] = useState<SortKey>("total_cost");

  const reload = () => api.users({ hours, sort_by: sortBy }).then(setData);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [hours, sortBy]);

  if (!data) return <p>Loading...</p>;

  const topSpender = data.users.length > 0 ? data.users[0] : null;

  const handleToggleRole = async (userId: string, currentRole: string) => {
    const newRole = currentRole === "admin" ? "student" : "admin";
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

      <div className="filters" style={{ display: "flex", gap: 12 }}>
        <select value={hours} onChange={(e) => setHours(e.target.value)}>
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

      <div className="chart-row">
        <div className="chart-card" style={{ flex: 1 }}>
          <h3>Registrations / Day</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data.registrations_by_day}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" tick={{ fontSize: 12 }} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="#6366f1" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="table-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ marginBottom: 0 }}>All Users</h3>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)} style={{ fontSize: 13 }}>
            <option value="total_cost">Sort by Cost</option>
            <option value="session_count">Sort by Sessions</option>
            <option value="last_active">Sort by Last Active</option>
            <option value="name">Sort by Name</option>
          </select>
        </div>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Plan</th>
              <th>Today&apos;s Usage</th>
              <th>Sessions</th>
              <th>Total Cost</th>
              <th>Last Active</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id}>
                <td>{u.name || "-"}</td>
                <td>{u.email}</td>
                <td>
                  <span className={`badge ${u.role === "admin" ? "badge-active" : "badge-completed"}`}>
                    {u.role}
                  </span>
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
                  <div style={{ display: "flex", gap: 8, fontSize: 11 }}>
                    <UsagePill label="Problems" used={u.daily_usage.sessions} limit={u.daily_usage.sessions_limit} />
                    <UsagePill label="Chats" used={u.daily_usage.chats} limit={u.daily_usage.chats_limit} />
                    <UsagePill label="Scans" used={u.daily_usage.scans} limit={u.daily_usage.scans_limit} />
                  </div>
                </td>
                <td>{u.session_count}</td>
                <td style={{ fontWeight: u.total_cost > 0 ? 600 : 400 }}>
                  ${u.total_cost.toFixed(4)}
                </td>
                <td>{u.last_active ? new Date(u.last_active).toLocaleString() : "-"}</td>
                <td>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`/llm-calls?user=${u.id}`); }}
                      style={{
                        padding: "4px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                        border: "1px solid #e2e8f0", borderRadius: 4, background: "#fff", color: "#475569",
                      }}
                      title="View LLM calls for this user"
                    >
                      View Calls
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToggleSubscription(u.id, u.subscription_tier); }}
                      style={{
                        padding: "4px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                        border: "1px solid #e2e8f0", borderRadius: 4, background: "#fff",
                        color: u.subscription_tier === "pro" ? "#f59e0b" : "#10b981",
                      }}
                      title={u.subscription_tier === "pro" ? "Downgrade subscription to Free" : "Upgrade subscription to Pro"}
                    >
                      {u.subscription_tier === "pro" ? "Downgrade Plan" : "Upgrade Plan"}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToggleRole(u.id, u.role); }}
                      style={{
                        padding: "4px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                        border: "1px solid #e2e8f0", borderRadius: 4, background: "#fff",
                        color: u.role === "admin" ? "#f59e0b" : "#6366f1",
                      }}
                      title={u.role === "admin" ? "Change role to student" : "Change role to admin"}
                    >
                      {u.role === "admin" ? "Remove Admin" : "Make Admin"}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(u.id, u.email); }}
                      style={{
                        padding: "4px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                        border: "1px solid #fecaca", borderRadius: 4, background: "#fef2f2", color: "#ef4444",
                      }}
                      title="Permanently delete this user"
                    >
                      Delete User
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {data.users.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: "center", color: "#999" }}>No users found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UsagePill({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const isUnlimited = limit === null;
  const atLimit = !isUnlimited && used >= limit;
  return (
    <span
      style={{
        padding: "2px 6px",
        borderRadius: 4,
        fontWeight: 600,
        background: atLimit ? "#fef2f2" : isUnlimited ? "#f0fdf4" : "#f8fafc",
        color: atLimit ? "#ef4444" : isUnlimited ? "#16a34a" : "#475569",
        border: `1px solid ${atLimit ? "#fecaca" : isUnlimited ? "#bbf7d0" : "#e2e8f0"}`,
        whiteSpace: "nowrap" as const,
      }}
      title={`${label}: ${used}${isUnlimited ? " (unlimited)" : ` / ${limit}`}`}
    >
      {label}: {used}{isUnlimited ? " / ∞" : ` / ${limit}`}
    </span>
  );
}
