import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, type UsersData } from "../lib/api";
import { formatRelativeDate } from "../lib/format";
import StatCard from "./StatCard";
import { Pagination, SearchInput } from "./Pagination";
import { useConfirm } from "../lib/confirm";

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
  /**
   * When true, surface the Classroom column (sections / students /
   * 30d submissions) and the "Has classroom" / "Active 30d" filter
   * chips. Only meaningful when role === "teacher".
   */
  showClassroom?: boolean;
  /**
   * When true, surface the three student-attention chips (At limit
   * today / Free heavy / Pro inactive). Only meaningful when
   * role === "student".
   */
  showStudentChips?: boolean;
  emptyMessage: string;
  /**
   * Optional slot rendered between the page header and the filter
   * bar. Used by the Admins page to mount its invite-admin form.
   */
  headerSlot?: ReactNode;
  /**
   * Bump this number to force a reload of the user list without
   * unmounting the panel. Lets the parent invalidate data after a
   * mutation (e.g. inviting an admin) while preserving the
   * operator's search, sort, time-window, and pagination state.
   */
  reloadSignal?: number;
}

export default function UserScopePanel({
  eyebrow,
  title,
  subtitle,
  role,
  showDailyUsage = false,
  showClassroom = false,
  showStudentChips = false,
  emptyMessage,
  headerSlot,
  reloadSignal = 0,
}: UserScopePanelProps) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [data, setData] = useState<UsersData | null>(null);
  const [hours, setHours] = useState("720");
  const [sortBy, setSortBy] = useState<SortKey>("total_cost");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasClassroom, setHasClassroom] = useState(false);
  const [activeClassroom, setActiveClassroom] = useState(false);
  const [atLimitToday, setAtLimitToday] = useState(false);
  const [freeHeavy, setFreeHeavy] = useState(false);
  const [proInactive, setProInactive] = useState(false);
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
        ...(hasClassroom ? { has_classroom: "true" } : {}),
        ...(activeClassroom ? { active_classroom: "true" } : {}),
        ...(atLimitToday ? { at_limit_today: "true" } : {}),
        ...(freeHeavy ? { free_heavy: "true" } : {}),
        ...(proInactive ? { pro_inactive: "true" } : {}),
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
  useEffect(() => { reload(); }, [hours, sortBy, search, offset, role, hasClassroom, activeClassroom, atLimitToday, freeHeavy, proInactive, reloadSignal]);

  const handleSearchChange = (v: string) => { setSearch(v); setOffset(0); };
  const handleSortChange = (v: SortKey) => { setSortBy(v); setOffset(0); };
  const handleHoursChange = (v: string) => { setHours(v); setOffset(0); };
  const toggleHasClassroom = () => { setHasClassroom((v) => !v); setOffset(0); };
  const toggleActiveClassroom = () => { setActiveClassroom((v) => !v); setOffset(0); };
  const toggleAtLimitToday = () => { setAtLimitToday((v) => !v); setOffset(0); };
  const toggleFreeHeavy = () => { setFreeHeavy((v) => !v); setOffset(0); };
  const toggleProInactive = () => { setProInactive((v) => !v); setOffset(0); };

  const handleToggleSubscription = async (
    userId: string,
    currentTier: string,
  ) => {
    const isPro = currentTier === "pro";
    const action = isPro ? "Downgrade to Free" : "Upgrade to Pro";
    if (!(await confirm({
      title: `${action} for this user?`,
      message: isPro
        ? "Daily usage limits will apply on the next session."
        : "Daily limits will be lifted on the next session.",
      confirmLabel: action,
      variant: "primary",
    }))) return;
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
    if (!(await confirm({
      title: "Reset daily limits?",
      message: "They'll be able to use the app as if the day just started.",
      confirmLabel: "Reset",
      variant: "primary",
    }))) return;
    try {
      await api.resetDailyLimit(userId);
      reload();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const handleDelete = async (userId: string, email: string) => {
    if (!(await confirm({
      title: "Delete user?",
      message: <><strong>{email}</strong> will be removed permanently. This can't be undone.</>,
      confirmLabel: "Delete",
    }))) return;
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

      {headerSlot}

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
        {showClassroom && (
          <>
            <FilterChip
              active={hasClassroom}
              onClick={toggleHasClassroom}
              label="Has classroom"
              title="Has at least one section with enrolled students"
            />
            <FilterChip
              active={activeClassroom}
              onClick={toggleActiveClassroom}
              label="Active 30d"
              title="At least one submission graded on their assignments in the last 30 days"
            />
          </>
        )}
        {showStudentChips && (
          <>
            <FilterChip
              active={atLimitToday}
              onClick={toggleAtLimitToday}
              label="At limit today"
              title="Free user who hit any daily cap (sessions / chats / scans) today — Pro conversion candidate"
            />
            <FilterChip
              active={freeHeavy}
              onClick={toggleFreeHeavy}
              label="Free · heavy"
              title="Free user with 3+ sessions in the last 7 days — about to hit the wall"
            />
            <FilterChip
              active={proInactive}
              onClick={toggleProInactive}
              label="Pro · inactive 14d"
              title="Paying user with no session in 14 days — silent churn risk"
            />
          </>
        )}
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
            {(() => {
              const w = columnWidths(showDailyUsage, showClassroom);
              return (
                <colgroup>
                  <col style={{ width: w.user }} />
                  <col style={{ width: w.plan }} />
                  {showDailyUsage && <col style={{ width: w.dailyUsage }} />}
                  {showClassroom && <col style={{ width: w.classroom }} />}
                  <col style={{ width: w.sessions }} />
                  <col style={{ width: w.cost }} />
                  <col style={{ width: w.joined }} />
                  <col style={{ width: w.action }} />
                </colgroup>
              );
            })()}
            <thead>
              <tr>
                <th>User</th>
                <th>Plan</th>
                {showDailyUsage && <th>Today's usage</th>}
                {showClassroom && <th>Classroom</th>}
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
                      {/* Only teachers have a roster page worth
                          drilling into; students fall through to plain
                          text. */}
                      {role === "teacher" ? (
                        <Link
                          to={`/teachers/${u.id}`}
                          style={{ color: "var(--ink)", textDecoration: "none" }}
                        >
                          {u.name || "—"}
                        </Link>
                      ) : (
                        u.name || "—"
                      )}
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
                  {showClassroom && (
                    <td>
                      <ClassroomCell classroom={u.classroom} teacherId={u.id} />
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
                  <td colSpan={6 + (showDailyUsage ? 1 : 0) + (showClassroom ? 1 : 0)}>
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

function ClassroomCell({
  classroom,
  teacherId,
}: {
  classroom: { sections: number; students: number; submissions_30d: number };
  teacherId: string;
}) {
  const empty = classroom.sections === 0 && classroom.students === 0;
  if (empty) {
    return <span style={{ color: "var(--muted-2)", fontSize: 12 }}>—</span>;
  }
  // Student count is a link into the per-teacher roster; sections +
  // 30d submissions stay as plain text since the roster page is the
  // student drill-in.
  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--ink-soft)", lineHeight: 1.6 }}>
      <div>
        <span style={{ color: "var(--ink)" }}>{classroom.sections}</span>{" "}
        <span style={{ color: "var(--muted)" }}>section{classroom.sections === 1 ? "" : "s"}</span>
        {" · "}
        <Link
          to={`/teachers/${teacherId}`}
          style={{ color: "var(--accent)", textDecoration: "none" }}
          title="View student roster"
        >
          <span style={{ color: "var(--accent)" }}>{classroom.students.toLocaleString()}</span>{" "}
          <span>student{classroom.students === 1 ? "" : "s"}</span>
        </Link>
      </div>
      <div style={{ color: "var(--muted)" }}>
        <span style={{ color: classroom.submissions_30d > 0 ? "var(--ink-soft)" : "var(--muted-2)" }}>
          {classroom.submissions_30d.toLocaleString()}
        </span>{" "}
        submission{classroom.submissions_30d === 1 ? "" : "s"} (30d)
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  title,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        padding: "7px 14px",
        border: `1px solid ${active ? "var(--accent)" : "var(--rule-strong)"}`,
        background: active ? "var(--accent-soft)" : "var(--surface)",
        color: active ? "var(--accent)" : "var(--ink-soft)",
        borderRadius: 3,
        fontFamily: "var(--font-sans)",
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: 0.5,
        cursor: "pointer",
      }}
    >
      {label} {active ? "✕" : ""}
    </button>
  );
}

// Per-config column widths. Each map sums to 100% so the table
// fills the container exactly — the previous version's widths
// summed to anywhere from 88% (no flags) to 112% (both flags) which
// either left empty space or overflowed.
function columnWidths(
  showDailyUsage: boolean,
  showClassroom: boolean,
): {
  user: string;
  plan: string;
  dailyUsage: string;
  classroom: string;
  sessions: string;
  cost: string;
  joined: string;
  action: string;
} {
  if (showDailyUsage && showClassroom) {
    return {
      user: "20%", plan: "8%", dailyUsage: "20%", classroom: "22%",
      sessions: "6%", cost: "8%", joined: "8%", action: "8%",
    };
  }
  if (showDailyUsage) {
    return {
      user: "26%", plan: "10%", dailyUsage: "22%", classroom: "0%",
      sessions: "8%", cost: "10%", joined: "16%", action: "8%",
    };
  }
  if (showClassroom) {
    return {
      user: "22%", plan: "10%", dailyUsage: "0%", classroom: "24%",
      sessions: "8%", cost: "10%", joined: "18%", action: "8%",
    };
  }
  return {
    user: "30%", plan: "10%", dailyUsage: "0%", classroom: "0%",
    sessions: "8%", cost: "12%", joined: "32%", action: "8%",
  };
}
