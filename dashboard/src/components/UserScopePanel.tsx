import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type UsersData } from "../lib/api";
import { formatRelativeDate } from "../lib/format";
import StatCard from "./StatCard";
import { Pagination, SearchInput } from "./Pagination";

// Shared user-listing surface for the per-audience pages
// (Independent students, Independent teachers). Wraps the
// /admin/users endpoint with a role + no_school filter so each
// audience page only sees its own slice — and only its aggregates,
// since the backend filters total_users / active_7d / total_spend
// against the same scope.
//
// The legacy /users page still uses Users.tsx directly without
// scoping. Phase 2 will decide whether to fold that into this
// component too or keep it as the "all users" engineer tool.

type SortKey = "total_cost" | "session_count" | "last_active" | "name";
const PAGE_SIZE = 25;

export interface UserScopePanelProps {
  eyebrow: string;
  title: string;
  subtitle: string;
  role: "student" | "teacher" | "admin";
  /**
   * When true, hide the "today's usage" column. Daily limit pills
   * are a student-flow concept; for teachers they're noise.
   */
  showDailyUsage?: boolean;
  emptyMessage: string;
}

export default function UserScopePanel({
  eyebrow,
  title,
  subtitle,
  role,
  showDailyUsage = false,
  emptyMessage,
}: UserScopePanelProps) {
  const navigate = useNavigate();
  const [data, setData] = useState<UsersData | null>(null);
  const [hours, setHours] = useState("720");
  const [sortBy, setSortBy] = useState<SortKey>("total_cost");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{
    top?: number;
    bottom?: number;
    right: number;
  }>({ right: 0 });
  const menuToggleRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const reload = () =>
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
      .then(setData);

  function openMenuFor(userId: string) {
    if (openMenu === userId) {
      setOpenMenu(null);
      return;
    }
    const btn = menuToggleRefs.current[userId];
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 240) {
      setMenuPos({
        bottom: window.innerHeight - rect.top + 4,
        right: window.innerWidth - rect.right,
      });
    } else {
      setMenuPos({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
    setOpenMenu(userId);
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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [hours, sortBy, search, offset, role]);

  const handleSearchChange = (v: string) => { setSearch(v); setOffset(0); };
  const handleSortChange = (v: SortKey) => { setSortBy(v); setOffset(0); };
  const handleHoursChange = (v: string) => { setHours(v); setOffset(0); };

  const handleToggleSubscription = async (
    userId: string,
    currentTier: string,
  ) => {
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
    if (
      !confirm(
        "Reset this user's daily usage limits? They'll be able to use the app as if the day just started.",
      )
    )
      return;
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

  if (!data) return <p className="loading">Loading…</p>;

  return (
    <div>
      <div className="page-header">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>

      <div className="filters">
        <SearchInput
          value={search}
          onChange={handleSearchChange}
          placeholder="Search by name or email…"
        />
        <select value={hours} onChange={(e) => handleHoursChange(e.target.value)}>
          <option value="24">Last 24 hours</option>
          <option value="168">Last 7 days</option>
          <option value="720">Last 30 days</option>
          <option value="2160">Last 90 days</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => handleSortChange(e.target.value as SortKey)}
        >
          <option value="total_cost">Sort by cost</option>
          <option value="session_count">Sort by sessions</option>
          <option value="last_active">Sort by last active</option>
          <option value="name">Sort by name</option>
        </select>
      </div>

      <div className="stat-grid">
        <StatCard label="Total" value={data.total_users} />
        <StatCard label="Active 7d" value={data.active_7d} />
        <StatCard label="Spend" value={`$${data.total_spend.toFixed(2)}`} />
        <StatCard label="Showing" value={data.filtered_count} sub="matches" />
      </div>

      <div className="table-card">
        <div className="table-scroll">
          <table>
            <colgroup>
              <col style={{ width: "28%" }} />
              <col style={{ width: "10%" }} />
              {showDailyUsage && <col style={{ width: "22%" }} />}
              <col style={{ width: "8%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: showDailyUsage ? "14%" : "26%" }} />
              <col style={{ width: "8%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>User</th>
                <th>Plan</th>
                {showDailyUsage && <th>Today's usage</th>}
                <th>Sessions</th>
                <th>Cost</th>
                <th>Joined / active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id}>
                  <td style={{ overflow: "hidden" }}>
                    <div
                      style={{
                        fontFamily: "var(--font-display)",
                        fontSize: 17,
                        color: "var(--ink)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {u.name || "—"}
                    </div>
                    <div
                      style={{
                        fontSize: 11.5,
                        color: "var(--muted)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {u.email}
                    </div>
                    {u.grade_level > 0 && (
                      <div
                        style={{
                          marginTop: 4,
                          fontFamily: "var(--font-sans)",
                          fontSize: 10,
                          textTransform: "uppercase",
                          letterSpacing: 1.4,
                          color: "var(--muted-2)",
                        }}
                      >
                        {gradeLabel(u.grade_level)}
                      </div>
                    )}
                  </td>
                  <td>
                    <span
                      className="badge"
                      style={
                        u.subscription_tier === "pro"
                          ? { background: "var(--info-soft)", color: "var(--info)" }
                          : { background: "transparent", color: "var(--muted)" }
                      }
                    >
                      {u.subscription_tier === "pro" ? "Pro" : "Free"}
                      {u.subscription_tier === "pro" &&
                      u.subscription_status !== "active"
                        ? ` (${u.subscription_status})`
                        : ""}
                    </span>
                  </td>
                  {showDailyUsage && (
                    <td>
                      <div
                        style={{
                          display: "flex",
                          gap: 6,
                          fontSize: 11,
                          flexWrap: "wrap",
                        }}
                      >
                        <UsagePill
                          label="P"
                          used={u.daily_usage.sessions}
                          limit={u.daily_usage.sessions_limit}
                          title="Problems"
                        />
                        <UsagePill
                          label="C"
                          used={u.daily_usage.chats}
                          limit={u.daily_usage.chats_limit}
                          title="Chats"
                        />
                        <UsagePill
                          label="S"
                          used={u.daily_usage.scans}
                          limit={u.daily_usage.scans_limit}
                          title="Scans"
                        />
                      </div>
                    </td>
                  )}
                  <td className="num">{u.session_count}</td>
                  <td className="num" style={{ color: u.total_cost > 0 ? "var(--ink)" : "var(--muted-2)" }}>
                    ${u.total_cost.toFixed(4)}
                  </td>
                  <td>
                    <div style={{ fontSize: 12 }} title={new Date(u.registered).toLocaleString()}>
                      <span style={{ color: "var(--muted-2)" }}>Joined </span>
                      {formatRelativeDate(u.registered)}
                    </div>
                    <div
                      style={{ fontSize: 12 }}
                      title={u.last_active ? new Date(u.last_active).toLocaleString() : undefined}
                    >
                      <span style={{ color: "var(--muted-2)" }}>Active </span>
                      {u.last_active ? formatRelativeDate(u.last_active) : "—"}
                    </div>
                  </td>
                  <td>
                    <button
                      ref={(el) => { menuToggleRefs.current[u.id] = el; }}
                      className="action-toggle"
                      onClick={(e) => { e.stopPropagation(); openMenuFor(u.id); }}
                    >
                      …
                    </button>
                    {openMenu === u.id && (
                      <div
                        className="action-dropdown"
                        style={{
                          ...(menuPos.top != null ? { top: menuPos.top } : {}),
                          ...(menuPos.bottom != null ? { bottom: menuPos.bottom } : {}),
                          right: menuPos.right,
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button onClick={() => { setOpenMenu(null); navigate(`/llm-calls?user=${u.id}`); }}>
                          View calls
                        </button>
                        <button
                          onClick={() => {
                            setOpenMenu(null);
                            handleToggleSubscription(u.id, u.subscription_tier);
                          }}
                        >
                          {u.subscription_tier === "pro" ? "Downgrade plan" : "Upgrade plan"}
                        </button>
                        {u.subscription_tier !== "pro" && (
                          <button onClick={() => { setOpenMenu(null); handleResetLimit(u.id); }}>
                            Reset daily limits
                          </button>
                        )}
                        <button
                          className="danger"
                          onClick={() => { setOpenMenu(null); handleDelete(u.id, u.email); }}
                        >
                          Delete user
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {data.users.length === 0 && (
                <tr>
                  <td colSpan={showDailyUsage ? 7 : 6}>
                    <div className="empty-state">
                      <div className="empty-state-title">{emptyMessage}</div>
                      <div className="empty-state-sub">
                        Adjust the filters above or check back later.
                      </div>
                    </div>
                  </td>
                </tr>
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
  if (grade <= 2) return "K–2";
  if (grade <= 5) return "3–5";
  if (grade <= 8) return "6–8";
  if (grade <= 12) return "9–12";
  return "College";
}

function UsagePill({
  label,
  used,
  limit,
  title,
}: {
  label: string;
  used: number;
  limit: number | null;
  title: string;
}) {
  const isUnlimited = limit === null;
  const atLimit = !isUnlimited && used >= limit;
  return (
    <span
      style={{
        padding: "2px 6px",
        borderRadius: 2,
        fontFamily: "var(--font-mono)",
        fontWeight: 500,
        background: atLimit
          ? "var(--danger-soft)"
          : isUnlimited
            ? "var(--ok-soft)"
            : "transparent",
        color: atLimit ? "var(--danger)" : isUnlimited ? "var(--ok)" : "var(--ink-soft)",
        border: `1px solid ${
          atLimit
            ? "rgba(138,35,23,0.3)"
            : isUnlimited
              ? "rgba(74,107,58,0.3)"
              : "var(--rule)"
        }`,
        whiteSpace: "nowrap" as const,
      }}
      title={`${title}: ${used}${isUnlimited ? " (unlimited)" : ` / ${limit}`}`}
    >
      {label}: {used}
      {isUnlimited ? "/∞" : `/${limit}`}
    </span>
  );
}
