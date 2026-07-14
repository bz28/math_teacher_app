import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, type SchoolListItem, type UsersData } from "../lib/api";
import { formatRelativeDate, fmtCost } from "../lib/format";
import { activityPill, activityStatus, daysSince, windowLabel } from "../lib/definitions";
import StatTile from "../components/StatTile";
import StatusPill, { type PillTone } from "../components/StatusPill";
import DataTable, { type Column } from "../components/DataTable";
import { Pagination, SearchInput } from "../components/Pagination";
import { InviteAdminForm } from "../components/InviteAdminForm";
import { useConfirm } from "../lib/confirm";
import { useToast } from "../lib/toast";

type UserRow = UsersData["users"][number];

const PAGE_SIZE = 25;

// Role presets driving the segmented filter. "" is the cross-cutting
// All view; each other value maps straight to the backend `role` param.
// The Admins preset is just role=admin — the retired Admins tab.
const ROLE_TABS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "student", label: "Students" },
  { value: "teacher", label: "Teachers" },
  { value: "admin", label: "Admins" },
];

/** Best-available "last seen" for a row: the more recent of unified
 *  activity (last_active_at = max of last tutoring session and last
 *  logged ActivityLog action, so a teacher's grade/publish counts) and
 *  a login (last_login). Admins never run sessions, so last_login is
 *  the only signal they have. */
function lastSeenOf(u: UserRow): string | null {
  const { last_active_at: a, last_login: b } = u;
  if (!a) return b;
  if (!b) return a;
  return new Date(a) >= new Date(b) ? a : b;
}

function roleBadge(role: string): { tone: PillTone; label: string } {
  if (role === "admin") return { tone: "info", label: "ADMIN" };
  if (role === "teacher") return { tone: "live", label: "TEACHER" };
  return { tone: "neutral", label: "STUDENT" };
}

function inviteBadge(status: UserRow["invite_status"]): { tone: PillTone; label: string } {
  if (status === "pending") return { tone: "warn", label: "PENDING INVITE" };
  if (status === "expired") return { tone: "danger", label: "INVITE EXPIRED" };
  return { tone: "ok", label: "ACTIVE" };
}

export default function Users() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const role = searchParams.get("role") ?? "";
  const isAdminView = role === "admin";

  const [data, setData] = useState<UsersData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [hours, setHours] = useState("720");
  const [plan, setPlan] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [schools, setSchools] = useState<SchoolListItem[]>([]);

  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; right: number }>({ right: 0 });
  const menuToggleRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const reload = () =>
    api
      .users({
        hours,
        limit: String(PAGE_SIZE),
        offset: String(offset),
        ...(role ? { role } : {}),
        ...(plan ? { plan } : {}),
        ...(schoolId ? { school_id: schoolId } : {}),
        ...(search ? { search } : {}),
      })
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load users."));

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [hours, role, plan, schoolId, search, offset, reloadKey]);

  // Institutional schools power the school filter. Best-effort — a
  // failure just leaves the dropdown with "All schools".
  useEffect(() => {
    api.schools().then((r) => setSchools(r.schools)).catch(() => {});
  }, []);

  // Close the action menu on any outside click or scroll.
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

  const setRole = (v: string) => {
    setOffset(0);
    setOpenMenu(null);
    setSearchParams(v ? { role: v } : {}, { replace: true });
  };
  const onFilter = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setOffset(0); };

  function openMenuFor(userId: string) {
    if (openMenu === userId) { setOpenMenu(null); return; }
    const btn = menuToggleRefs.current[userId];
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow < 260) {
      setMenuPos({ bottom: window.innerHeight - rect.top + 4, right: window.innerWidth - rect.right });
    } else {
      setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setOpenMenu(userId);
  }

  // ── Mutations ──────────────────────────────────────────────────────
  const handleChangeRole = async (userId: string, newRole: string) => {
    if (!(await confirm({
      title: `Change role to ${newRole}?`,
      message: "The user will see different routes and permissions next time they sign in.",
      confirmLabel: "Change role",
      variant: "primary",
    }))) return;
    try { await api.updateUserRole(userId, newRole); reload(); }
    catch (e) { toast((e as Error).message); }
  };

  const handleToggleSubscription = async (userId: string, currentTier: string) => {
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
      await api.updateUserSubscription(userId, isPro ? "free" : "pro", isPro ? "none" : "active");
      reload();
    } catch (e) { toast((e as Error).message); }
  };

  const handleResetLimit = async (userId: string) => {
    if (!(await confirm({
      title: "Reset daily limits?",
      message: "They'll be able to use the app as if the day just started.",
      confirmLabel: "Reset",
      variant: "primary",
    }))) return;
    try { await api.resetDailyLimit(userId); reload(); }
    catch (e) { toast((e as Error).message); }
  };

  const handleResendInvite = async (userId: string, email: string) => {
    try {
      await api.resendInvite(userId);
      toast(`Invite resent to ${email}.`, "success");
      reload();
    } catch (e) { toast((e as Error).message); }
  };

  const handleRevokeInvite = async (userId: string, email: string) => {
    if (!(await confirm({
      title: "Revoke invite?",
      message: <>The pending admin <strong>{email}</strong> will be removed. They can be re-invited later.</>,
      confirmLabel: "Revoke invite",
    }))) return;
    try { await api.deleteUser(userId); reload(); }
    catch (e) { toast((e as Error).message); }
  };

  const handleDelete = async (userId: string, email: string) => {
    if (!(await confirm({
      title: "Delete user?",
      message: <><strong>{email}</strong> will be removed permanently. This can't be undone.</>,
      confirmLabel: "Delete",
    }))) return;
    try { await api.deleteUser(userId); reload(); }
    catch (e) { toast((e as Error).message); }
  };

  // ── Derived stat band ──────────────────────────────────────────────
  const newThisWeek = useMemo(() => {
    if (!data) return 0;
    // daysSince() hides Date.now behind a function call — matches how
    // definitions.ts keeps recency math out of the render purity path.
    return data.registrations_by_day
      .filter((r) => { const d = daysSince(r.day); return d !== null && d <= 7; })
      .reduce((sum, r) => sum + r.count, 0);
  }, [data]);
  const spark = data?.registrations_by_day.map((r) => r.count) ?? [];
  const win = windowLabel(Number(hours));

  // ── Columns ────────────────────────────────────────────────────────
  const userCol: Column<UserRow> = {
    key: "user", header: "User", width: "26%",
    sortValue: (u) => (u.name || u.email).toLowerCase(),
    render: (u) => {
      const rb = roleBadge(u.role);
      return (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis" }}>
            {u.name || "—"}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis" }}>
            {u.email}
          </div>
          <div style={{ marginTop: 5, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {!role && <StatusPill tone={rb.tone} label={rb.label} />}
            {u.grade_level > 0 && (
              <span style={{ fontFamily: "var(--font-sans)", fontSize: 10, textTransform: "uppercase", letterSpacing: 1.4, color: "var(--muted-2)" }}>
                {gradeLabel(u.grade_level)}
              </span>
            )}
          </div>
        </div>
      );
    },
  };

  const actionCol: Column<UserRow> = {
    key: "actions", header: "", width: "44px", align: "right",
    render: (u) => (
      <button
        ref={(el) => { menuToggleRefs.current[u.id] = el; }}
        className="action-toggle"
        aria-label="Row actions"
        onClick={(e) => { e.stopPropagation(); openMenuFor(u.id); }}
      >
        …
      </button>
    ),
  };

  const defaultCols: Column<UserRow>[] = [
    userCol,
    {
      key: "school", header: "School", width: "16%",
      sortValue: (u) => u.school?.name.toLowerCase() ?? "",
      render: (u) => u.school
        ? <span style={{ color: "var(--ink-soft)" }}>{u.school.name}</span>
        : <span style={{ color: "var(--muted-2)" }}>—</span>,
    },
    {
      key: "plan", header: "Plan", width: "13%",
      sortValue: (u) => u.subscription_tier,
      render: (u) => {
        const pro = u.subscription_tier === "pro";
        return (
          <span
            className="badge"
            style={pro ? { background: "var(--info-soft)", color: "var(--info)" } : { background: "transparent", color: "var(--muted)" }}
          >
            {pro ? "Pro" : "Free"}
            {pro && u.subscription_status !== "active" ? ` (${u.subscription_status})` : ""}
          </span>
        );
      },
    },
    {
      key: "activity", header: "Activity", width: "17%",
      sortValue: (u) => { const s = lastSeenOf(u); return s ? new Date(s).getTime() : 0; },
      render: (u) => {
        const seen = lastSeenOf(u);
        const pill = activityPill(activityStatus(seen));
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <StatusPill tone={pill.tone} label={pill.label} />
            <span style={{ fontSize: 11.5, color: "var(--muted)" }} title={seen ? new Date(seen).toLocaleString() : undefined}>
              {seen ? formatRelativeDate(seen) : "never"}
            </span>
          </div>
        );
      },
    },
    {
      key: "cost", header: `Cost · ${win}`, width: "15%", numeric: true,
      sortValue: (u) => u.total_cost,
      render: (u) => (
        <div>
          <div style={{ color: u.total_cost > 0 ? "var(--ink)" : "var(--muted-2)", fontWeight: 600 }}>
            {fmtCost(u.total_cost)}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            {u.llm_call_count.toLocaleString()} call{u.llm_call_count === 1 ? "" : "s"}
            {u.avg_cost_per_session > 0 ? ` · ${fmtCost(u.avg_cost_per_session)}/sess` : ""}
          </div>
        </div>
      ),
    },
    actionCol,
  ];

  const adminCols: Column<UserRow>[] = [
    userCol,
    {
      key: "status", header: "Status", width: "18%",
      sortValue: (u) => u.invite_status,
      render: (u) => { const b = inviteBadge(u.invite_status); return <StatusPill tone={b.tone} label={b.label} />; },
    },
    {
      key: "invited", header: "Invited", width: "18%",
      sortValue: (u) => new Date(u.registered).getTime(),
      render: (u) => (
        <span style={{ color: "var(--ink-soft)" }} title={new Date(u.registered).toLocaleString()}>
          {formatRelativeDate(u.registered)}
        </span>
      ),
    },
    {
      key: "last_login", header: "Last dashboard login", width: "20%",
      sortValue: (u) => (u.last_login ? new Date(u.last_login).getTime() : 0),
      render: (u) => u.last_login
        ? <span style={{ color: "var(--ink-soft)" }} title={new Date(u.last_login).toLocaleString()}>{formatRelativeDate(u.last_login)}</span>
        : <span style={{ color: "var(--muted-2)" }}>never signed in</span>,
    },
    actionCol,
  ];

  const columns = isAdminView ? adminCols : defaultCols;

  const openUser = data?.users.find((u) => u.id === openMenu) ?? null;

  return (
    <div>
      <div className="page-header">
        <span className="eyebrow">System</span>
        <h1>Users</h1>
        <p>Every account in one place — filter by role, then manage plan, access, and invites from any row.</p>
      </div>

      {/* Segmented role filter — "Admins" is the retired tab, now a preset. */}
      <div className="segmented" role="tablist" aria-label="Filter by role">
        {ROLE_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={role === t.value}
            className={`segment${role === t.value ? " segment-active" : ""}`}
            onClick={() => setRole(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Invite-admin form lives on the Admins preset. */}
      {isAdminView && <InviteAdminForm onInvited={reload} />}

      <div className="filters">
        <SearchInput value={search} onChange={onFilter(setSearch)} placeholder="Search by name or email…" />
        {!isAdminView && (
          <>
            <select value={plan} onChange={(e) => onFilter(setPlan)(e.target.value)} aria-label="Filter by plan">
              <option value="">All plans</option>
              <option value="pro">Pro</option>
              <option value="free">Free</option>
            </select>
            <select value={schoolId} onChange={(e) => onFilter(setSchoolId)(e.target.value)} aria-label="Filter by school">
              <option value="">All schools</option>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </>
        )}
        <select value={hours} onChange={(e) => onFilter(setHours)(e.target.value)} aria-label="Activity window">
          <option value="24">Last 24 hours</option>
          <option value="168">Last 7 days</option>
          <option value="720">Last 30 days</option>
          <option value="2160">Last 90 days</option>
        </select>
      </div>

      <div className="tile-grid">
        <StatTile label="Total users" value={(data?.total_users ?? 0).toLocaleString()} sub={role ? `${role}s` : "all roles"} />
        <StatTile label="Active 7d" value={(data?.active_7d ?? 0).toLocaleString()} sub="seen in last 7 days" />
        <StatTile label={`Spend · ${win}`} value={fmtCost(data?.total_spend ?? 0)} sub="filtered scope" />
        <StatTile label="New this week" value={newThisWeek.toLocaleString()} sub="new sign-ups" spark={spark} />
      </div>

      <div className="table-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <h3 style={{ marginBottom: 0 }}>
            {ROLE_TABS.find((t) => t.value === role)?.label ?? "All"}
            <span style={{ fontWeight: 400, color: "var(--muted)", marginLeft: 8, fontFamily: "var(--font-mono)", fontSize: 13 }}>
              {data ? data.filtered_count.toLocaleString() : "—"}
            </span>
          </h3>
        </div>
        <DataTable
          columns={columns}
          rows={data?.users ?? []}
          rowKey={(u) => u.id}
          loading={!data && !error}
          error={!data ? error : null}
          onRetry={() => { setError(null); setReloadKey((k) => k + 1); }}
          minWidth={720}
          empty={
            <>
              <span className="dt-state-title">No users match.</span>
              <span className="dt-state-sub">Adjust the filters above or check back later.</span>
            </>
          }
        />
        {data && (
          <Pagination offset={offset} limit={PAGE_SIZE} total={data.filtered_count} onChange={setOffset} />
        )}
      </div>

      {/* Row action menu — fixed-position so it escapes the table scroll. */}
      {openUser && (
        <div
          className="action-dropdown"
          style={{
            ...(menuPos.top != null ? { top: menuPos.top } : {}),
            ...(menuPos.bottom != null ? { bottom: menuPos.bottom } : {}),
            right: menuPos.right,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => { setOpenMenu(null); navigate(`/llm-calls?user=${openUser.id}`); }}>
            View calls
          </button>
          {(["student", "teacher", "admin"] as const)
            .filter((r) => r !== openUser.role)
            .map((r) => (
              <button key={r} onClick={() => { setOpenMenu(null); handleChangeRole(openUser.id, r); }}>
                Make {r.charAt(0).toUpperCase() + r.slice(1)}
              </button>
            ))}
          <button onClick={() => { setOpenMenu(null); handleToggleSubscription(openUser.id, openUser.subscription_tier); }}>
            {openUser.subscription_tier === "pro" ? "Downgrade plan" : "Upgrade plan"}
          </button>
          {openUser.subscription_tier !== "pro" && (
            <button onClick={() => { setOpenMenu(null); handleResetLimit(openUser.id); }}>
              Reset daily limits
            </button>
          )}
          {openUser.role === "admin" && openUser.invite_status !== "active" && (
            <>
              <button onClick={() => { setOpenMenu(null); handleResendInvite(openUser.id, openUser.email); }}>
                Resend invite
              </button>
              <button className="danger" onClick={() => { setOpenMenu(null); handleRevokeInvite(openUser.id, openUser.email); }}>
                Revoke invite
              </button>
            </>
          )}
          <button className="danger" onClick={() => { setOpenMenu(null); handleDelete(openUser.id, openUser.email); }}>
            Delete user
          </button>
        </div>
      )}
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
