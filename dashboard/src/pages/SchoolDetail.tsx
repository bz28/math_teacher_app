import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip,
} from "recharts";
import {
  api,
  type SchoolDetail as SchoolDetailData,
  type SchoolOverviewData,
  type SchoolStudentsData,
} from "../lib/api";
import { formatRelativeDate, fmtCost } from "../lib/format";
import { btnGhost, btnPrimary, btnSmall, inputStyle } from "../lib/styles";
import { useConfirm } from "../lib/confirm";
import { useToast } from "../lib/toast";
import { Pagination } from "../components/Pagination";
import StatTile from "../components/StatTile";
import StatusPill from "../components/StatusPill";
import {
  activityPill,
  activityStatus,
  costWindowLabel,
  isAtRisk,
} from "../lib/definitions";

// Roster page size — the /admin/schools/:id/students endpoint accepts
// limit/offset, so a >100-student school is now fully reachable via the
// shared <Pagination> control instead of a hard "first 100" cap.
const ROSTER_PAGE_SIZE = 50;

// Dedicated per-school deep page. Lives at /schools/:schoolId. Two
// API fetches in parallel:
//   - /admin/schools/:id           teachers + invites + CRUD shape
//   - /admin/schools/:id/overview  cost, activity, health
// We render four numbered sections so the page scans top-to-bottom
// even on a single column. Section 03 (health) deep-links to
// /llm-calls with the school + failures filters preset — we don't
// duplicate the LLM Calls rendering here.

interface EditForm {
  name: string;
  contact_name: string;
  contact_email: string;
  city: string;
  state: string;
  notes: string;
}

export default function SchoolDetail() {
  const confirm = useConfirm();
  const toast = useToast();
  const { schoolId } = useParams<{ schoolId: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<SchoolDetailData | null>(null);
  const [overview, setOverview] = useState<SchoolOverviewData | null>(null);
  const [students, setStudents] = useState<SchoolStudentsData | null>(null);
  const [studentOffset, setStudentOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Edit (inline)
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);

  // Invite
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Detail + overview only — the roster is paginated on its own effect
  // (keyed on schoolId + studentOffset) so paging doesn't refetch the
  // header/cost blocks, and mutations that don't touch the roster
  // (edit, invite) don't reset the current page.
  const reload = async () => {
    if (!schoolId) return;
    try {
      const [d, o] = await Promise.all([
        api.school(schoolId),
        api.schoolOverview(schoolId),
      ]);
      setDetail(d);
      setOverview(o);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    // Reset every per-school piece of state — mid-edit nav from
    // school A to school B shouldn't leave A's form fields mounted
    // under B's header. `handleSaveEdit` guards on `!detail` so a
    // stale form can't post against the wrong id, but the UI was
    // showing the wrong values briefly until reload landed.
    setDetail(null);
    setOverview(null);
    setStudents(null);
    setStudentOffset(0);
    setError(null);
    setEditing(false);
    setEditForm(null);
    setSaving(false);
    setInviteEmail("");
    setInviteUrl(null);
    setCopied(false);
    setInviting(false);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  // Paginated roster fetch. Runs on mount, when the school changes, and
  // when the operator pages. A roster failure is non-fatal — the header
  // and cost sections still render — so it doesn't set the page error.
  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;
    api
      .schoolStudents(schoolId, {
        limit: String(ROSTER_PAGE_SIZE),
        offset: String(studentOffset),
      })
      .then((st) => { if (!cancelled) setStudents(st); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [schoolId, studentOffset]);

  const startEditing = () => {
    if (!detail) return;
    setEditForm({
      name: detail.name,
      contact_name: detail.contact_name,
      contact_email: detail.contact_email,
      city: detail.city || "",
      state: detail.state || "",
      notes: detail.notes || "",
    });
    setEditing(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !editForm) return;
    setSaving(true);
    try {
      await api.updateSchool(detail.id, {
        name: editForm.name.trim(),
        contact_name: editForm.contact_name.trim(),
        contact_email: editForm.contact_email.trim(),
        city: editForm.city.trim() || undefined,
        state: editForm.state.trim() || undefined,
        notes: editForm.notes.trim() || undefined,
      });
      setEditing(false);
      reload();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async () => {
    if (!detail) return;
    const next = !detail.is_active;
    if (!(await confirm({
      title: `${next ? "Activate" : "Deactivate"} ${detail.name}?`,
      message: detail.is_active
        ? "All teachers and students will lose access until the school is reactivated."
        : "Teachers and students will regain access on their next sign-in.",
      confirmLabel: next ? "Activate" : "Deactivate",
      variant: detail.is_active ? "danger" : "primary",
    }))) return;
    try {
      await api.updateSchool(detail.id, { is_active: next });
      reload();
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const handleDelete = async () => {
    if (!detail) return;
    if (!(await confirm({
      title: `Permanently delete ${detail.name}?`,
      message: <><strong>{detail.teachers.length}</strong> teacher{detail.teachers.length === 1 ? "" : "s"} will be unlinked. This cannot be undone.</>,
      confirmLabel: "Delete",
    }))) return;
    try {
      await api.deleteSchool(detail.id);
      navigate("/schools");
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    setInviting(true);
    try {
      const res = await api.inviteTeacher(detail.id, inviteEmail.trim());
      setInviteUrl(res.invite_url);
      setInviteEmail("");
      reload();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setInviting(false);
    }
  };

  const handleCancelInvite = async (inviteId: string) => {
    if (!detail) return;
    if (!(await confirm({
      title: "Cancel this invite?",
      message: "The invite link will stop working. You can issue a new one anytime.",
      confirmLabel: "Cancel invite",
    }))) return;
    try {
      await api.cancelInvite(detail.id, inviteId);
      reload();
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const handleCopyInvite = () => {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const trendChartData = useMemo(
    () =>
      overview?.cost.trend_12_weeks.map((p) => ({
        week: p.week_start ?? "",
        cost: p.cost,
      })) ?? [],
    [overview],
  );

  if (error) {
    const isNotFound = error.includes("404");
    return (
      <div>
        <div className="page-header">
          <Link to="/schools" className="link-btn">← Schools</Link>
          <h1 style={{ marginTop: 8 }}>
            {isNotFound ? "School not found" : "Couldn't load school"}
          </h1>
          <p style={{ color: "var(--danger)" }}>
            {isNotFound ? "This school may have been deleted." : error}
          </p>
        </div>
      </div>
    );
  }

  if (!detail || !overview) return <p className="loading">Loading…</p>;

  const monthDeltaPct =
    overview.cost.last_month > 0
      ? ((overview.cost.this_month - overview.cost.last_month) /
          overview.cost.last_month) *
        100
      : null;

  // Rolling-30d cost delta for the KPI strip — same window the Schools
  // list shows, so the number matches what the operator clicked in on.
  const cost30dDeltaPct =
    overview.cost.cost_prev_30d > 0
      ? ((overview.cost.cost_30d - overview.cost.cost_prev_30d) /
          overview.cost.cost_prev_30d) *
        100
      : null;

  // Unit economics — cost per active seat. Cheap, and the first thing a
  // buyer-facing founder wants for pricing. Guard divide-by-zero.
  const teacherCount = detail.teachers.length;
  const studentCount = students?.total_students ?? 0;
  const costPerStudent = studentCount > 0 ? overview.cost.cost_30d / studentCount : null;
  const costPerTeacher = teacherCount > 0 ? overview.cost.cost_30d / teacherCount : null;

  const statusPill = detail.is_active
    ? activityPill(activityStatus(overview.last_activity_at))
    : { tone: "neutral" as const, label: "INACTIVE" };
  const lastActivityAtRisk =
    detail.is_active && isAtRisk({ lastActiveAt: overview.last_activity_at, failedCalls: overview.failed_calls_24h });

  return (
    <div>
      {/* Back trail */}
      <div style={{ marginBottom: 16 }}>
        <Link to="/schools" className="link-btn">← Schools</Link>
      </div>

      {/* ── Header (editorial) ───────────────────────────────────── */}
      {editing && editForm ? (
        <EditHeader
          form={editForm}
          onChange={setEditForm}
          onSubmit={handleSaveEdit}
          onCancel={() => setEditing(false)}
          saving={saving}
        />
      ) : (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 36, gap: 24 }}>
          <div className="page-header" style={{ marginBottom: 0, flex: 1 }}>
            <span className="eyebrow">School</span>
            <h1 style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
              {detail.name}
              <span
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: 1.4,
                  textTransform: "uppercase",
                  color: detail.is_active ? "var(--ok)" : "var(--muted-2)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span aria-hidden="true" className={`dot ${detail.is_active ? "dot-ok" : "dot-muted"}`}>●</span>
                {detail.is_active ? "Active" : "Inactive"}
              </span>
            </h1>
            <p>
              {detail.contact_name} · {detail.contact_email}
              {(detail.city || detail.state) && ` · ${[detail.city, detail.state].filter(Boolean).join(", ")}`}
            </p>
            {detail.notes && (
              <p style={{ marginTop: 8, fontStyle: "normal", fontFamily: "var(--font-sans)", fontSize: 13.5, color: "var(--ink-soft)", maxWidth: "72ch", lineHeight: 1.6 }}>
                {detail.notes}
              </p>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={startEditing} style={btnGhost}>Edit</button>
            <button onClick={handleToggleActive} style={btnGhost}>
              {detail.is_active ? "Deactivate" : "Activate"}
            </button>
            <button onClick={handleDelete} style={{ ...btnGhost, color: "var(--danger)", borderColor: "rgba(138, 35, 23, 0.3)" }}>
              Delete
            </button>
          </div>
        </div>
      )}

      {/* ── KPI strip — "is this pilot healthy?" in 3 seconds ────── */}
      <div className="tile-grid" style={{ marginBottom: 44 }}>
        <StatTile label="Status" value={<StatusPill {...statusPill} />} />
        <StatTile label="Teachers" value={teacherCount} />
        <StatTile
          label="Students"
          value={students ? studentCount.toLocaleString() : "…"}
        />
        <StatTile
          label={`Cost · ${costWindowLabel()}`}
          value={fmtCost(overview.cost.cost_30d)}
          delta={cost30dDeltaPct === null ? undefined : { pct: cost30dDeltaPct, goodWhen: "down", note: "vs prev 30d" }}
        />
        <StatTile
          label="Last activity"
          tone={lastActivityAtRisk ? "warn" : "default"}
          value={overview.last_activity_at ? formatRelativeDate(overview.last_activity_at) : "none yet"}
        />
        <StatTile
          label="Failed · 24h"
          tone={overview.failed_calls_24h > 0 ? "danger" : "default"}
          value={overview.failed_calls_24h}
        />
      </div>

      {/* ── 01 — ACTIVITY (adoption is the headline) ────────────── */}
      {!overview.is_internal && (
        <Section number="01" label="Activity (this week vs last)">
          <ActivityRow
            label="Active classes"
            curr={overview.activity.this_week.active_classes}
            prev={overview.activity.last_week.active_classes}
          />
          <ActivityRow
            label="Active teachers"
            curr={overview.activity.this_week.active_teachers}
            prev={overview.activity.last_week.active_teachers}
          />
          <ActivityRow
            label="Active students"
            curr={overview.activity.this_week.active_students}
            prev={overview.activity.last_week.active_students}
          />
          <ActivityRow
            label="HWs published"
            curr={overview.activity.this_week.hws_published}
            prev={overview.activity.last_week.hws_published}
          />
          <ActivityRow
            label="Submissions"
            curr={overview.activity.this_week.submissions}
            prev={overview.activity.last_week.submissions}
          />
        </Section>
      )}

      {/* ── 02 — COST ───────────────────────────────────────────── */}
      <Section
        number="02"
        label="Cost"
        action={
          <Link
            to={`/llm-calls?school=${detail.id}&hours=720`}
            className="link-btn"
            style={{ fontSize: 12 }}
          >
            View all calls (30d) →
          </Link>
        }
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 32, marginBottom: 28 }}>
          <DataBlock
            label="This month"
            value={`$${overview.cost.this_month.toFixed(2)}`}
            sub={
              monthDeltaPct === null
                ? "first month of data"
                : `${monthDeltaPct > 0 ? "↑" : monthDeltaPct < 0 ? "↓" : "→"} ${Math.abs(monthDeltaPct).toFixed(0)}% vs last month`
            }
            subColor={
              monthDeltaPct === null
                ? "var(--muted)"
                : monthDeltaPct > 0
                  ? "var(--accent)"
                  : monthDeltaPct < 0
                    ? "var(--ok)"
                    : "var(--muted)"
            }
          />
          <DataBlock
            label="Last month"
            value={`$${overview.cost.last_month.toFixed(2)}`}
          />
          <DataBlock
            label="Projected end of month"
            value={`$${overview.cost.projected_month_end.toFixed(2)}`}
            sub="if usage stays flat"
          />
        </div>

        {/* Unit economics — cost per active seat over the rolling 30d. */}
        {(costPerStudent !== null || costPerTeacher !== null) && (
          <div style={{ display: "flex", gap: 40, flexWrap: "wrap", borderTop: "1px solid var(--rule)", paddingTop: 18, marginBottom: trendChartData.length > 1 ? 28 : 0 }}>
            {costPerStudent !== null && (
              <UnitEcon label={`Cost / student · ${costWindowLabel()}`} value={fmtCost(costPerStudent)} sub={`${studentCount.toLocaleString()} enrolled`} />
            )}
            {costPerTeacher !== null && (
              <UnitEcon label={`Cost / teacher · ${costWindowLabel()}`} value={fmtCost(costPerTeacher)} sub={`${teacherCount} teacher${teacherCount === 1 ? "" : "s"}`} />
            )}
          </div>
        )}

        {trendChartData.length > 1 && (
          <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 18 }}>
            <h3 style={{ marginBottom: 10 }}>12-week trend</h3>
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart data={trendChartData}>
                <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                <YAxis hide />
                <Tooltip
                  formatter={(v) => `$${Number(v).toFixed(2)}`}
                  labelFormatter={(l) => `Week of ${l}`}
                />
                <Area
                  type="monotone"
                  dataKey="cost"
                  stroke="var(--accent)"
                  fill="var(--accent-soft)"
                  strokeWidth={1.5}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Section>

      {/* ── 03 — HEALTH ─────────────────────────────────────────── */}
      <Section number="03" label="Health">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
          <HealthBlock
            label="Failed calls (24h)"
            count={overview.failed_calls_24h}
            href={`/llm-calls?school=${detail.id}&status=failed&hours=24`}
          />
          <HealthBlock
            label="Failed calls (7d)"
            count={overview.failed_calls_7d}
            href={`/llm-calls?school=${detail.id}&status=failed&hours=168`}
          />
        </div>
      </Section>

      {/* ── 04 — TEACHERS ───────────────────────────────────────── */}
      {/* Per-row layout: name+email | joined | 30d cost+calls | → */}
      {/* drill-in. Mirrors the student row pattern on TeacherDetail */}
      {/* so admins have a single mental model for "drill into a */}
      {/* user's LLM calls". Cost is the primary signal for the */}
      {/* heavy-spender scan; call count is the secondary check. */}
      <Section
        number="04"
        label={`Teachers (${detail.teachers.length})`}
        action={
          detail.teachers.length > 0 ? (
            <Link
              to={`/llm-calls?school=${detail.id}&hours=720`}
              className="link-btn"
              style={{ fontSize: 12 }}
              title="LLM calls for everyone at this school (teachers + students)"
            >
              View all school calls (30d) →
            </Link>
          ) : undefined
        }
      >
        {/* Invite CTA — first, because growing the roster is the
            action an operator comes here to take. */}
        <div style={{ paddingBottom: 18, marginBottom: 24, borderBottom: "1px solid var(--rule)" }}>
          <h3 style={{ marginBottom: 12 }}>Invite a teacher</h3>
          <form onSubmit={handleInvite} style={{ display: "flex", gap: 8 }}>
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="teacher@school.edu"
              required
              style={{ ...inputStyle, flex: 1 }}
            />
            <button type="submit" disabled={inviting} style={{ ...btnPrimary, opacity: inviting ? 0.6 : 1, whiteSpace: "nowrap" }}>
              {inviting ? "Sending…" : "Send invite"}
            </button>
          </form>
          {inviteUrl && (
            <div style={{ marginTop: 14, padding: "12px 14px", background: "var(--ok-soft)", border: "1px solid rgba(74, 107, 58, 0.3)", borderRadius: 3 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--ok)", marginBottom: 6, letterSpacing: 1.2, textTransform: "uppercase" }}>
                Invite created
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <code style={{ fontSize: 12, color: "var(--ink-soft)", flex: 1, wordBreak: "break-all", fontFamily: "var(--font-mono)" }}>
                  {inviteUrl}
                </code>
                <button onClick={handleCopyInvite} style={{ ...btnSmall, color: copied ? "var(--ok)" : "var(--accent)" }}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          )}
        </div>

        {detail.teachers.length > 0 ? (
          <div className="list" style={{ marginBottom: 24 }}>
            {detail.teachers.map((t) => (
              <div
                key={t.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.6fr 1fr 1fr auto",
                  gap: 18,
                  alignItems: "center",
                  padding: "14px 0",
                  borderBottom: "1px solid var(--rule)",
                }}
              >
                <div style={{ overflow: "hidden" }}>
                  <Link
                    to={`/teachers/${t.id}`}
                    style={{
                      display: "block",
                      fontFamily: "var(--font-display)",
                      fontSize: 17,
                      color: "var(--ink)",
                      textDecoration: "none",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title="View this teacher's roster"
                  >
                    {t.name || "—"}
                  </Link>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.email}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "var(--muted-2)" }}>
                  <span style={{ color: "var(--muted-2)" }}>Joined </span>
                  {formatRelativeDate(t.joined_at)}
                </div>
                <div title="LLM activity over the last 30 days">
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 15,
                      color: t.total_cost_30d > 0 ? "var(--ink)" : "var(--muted-2)",
                      letterSpacing: -0.2,
                      lineHeight: 1.2,
                    }}
                  >
                    {fmtCost(t.total_cost_30d)}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                    {t.call_count_30d.toLocaleString()} call{t.call_count_30d === 1 ? "" : "s"} · 30d
                  </div>
                </div>
                <Link
                  to={`/llm-calls?user=${t.id}&hours=720`}
                  className="action-toggle"
                  title="View this teacher's LLM calls"
                  style={{ textDecoration: "none", textAlign: "center" }}
                >
                  →
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: "var(--muted)", fontStyle: "italic", marginBottom: 24 }}>
            No teachers yet. Send an invite above.
          </p>
        )}

        {/* Pending invites — only if any */}
        {detail.pending_invites.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ marginBottom: 12 }}>Pending invites ({detail.pending_invites.length})</h3>
            <div className="list">
              {detail.pending_invites.map((inv) => (
                <div
                  key={inv.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.4fr 1fr 1fr auto",
                    gap: 18,
                    alignItems: "center",
                    padding: "12px 0",
                    borderBottom: "1px solid var(--rule)",
                  }}
                >
                  <div style={{ fontSize: 13 }}>{inv.email}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    sent {formatRelativeDate(inv.created_at)}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    expires {formatRelativeDate(inv.expires_at)}
                  </div>
                  <button onClick={() => handleCancelInvite(inv.id)} style={{ ...btnSmall, color: "var(--danger)" }}>
                    Cancel
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* ── 05 — STUDENTS ─────────────────────────────────────────── */}
      <Section
        number="05"
        label={`Students (${students ? students.total_students : "…"})`}
      >
        {!students ? (
          <p className="loading">Loading roster…</p>
        ) : students.total_students === 0 ? (
          <p style={{ color: "var(--muted)", fontStyle: "italic" }}>
            No students enrolled yet. Once teachers create sections and
            students join, they'll appear here.
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <colgroup>
                <col style={{ width: "34%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "20%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Plan</th>
                  <th>Grade</th>
                  <th>Joined</th>
                  <th>Last active</th>
                </tr>
              </thead>
              <tbody>
                {students.students.map((s) => (
                  <tr key={s.id}>
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
                        {s.name || "—"}
                      </div>
                      <div
                        style={{
                          fontSize: 11.5,
                          color: "var(--muted)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {s.email}
                      </div>
                    </td>
                    <td>
                      <span
                        className="badge"
                        style={
                          s.subscription_tier === "pro"
                            ? { background: "var(--info-soft)", color: "var(--info)" }
                            : { background: "transparent", color: "var(--muted)" }
                        }
                      >
                        {s.subscription_tier === "pro" ? "Pro" : "Free"}
                      </span>
                      {s.subscription_status && s.subscription_status !== "active" && (
                        <div
                          style={{ fontSize: 10.5, color: "var(--accent)", marginTop: 4, textTransform: "uppercase", letterSpacing: 0.6 }}
                          title="Subscription status"
                        >
                          {s.subscription_status.replace(/_/g, " ")}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                      {s.grade_level > 0 ? gradeLabel(s.grade_level) : "—"}
                    </td>
                    <td>
                      <div style={{ fontSize: 12 }} title={new Date(s.registered).toLocaleString()}>
                        {formatRelativeDate(s.registered)}
                      </div>
                    </td>
                    <td>
                      <div
                        style={{ fontSize: 12 }}
                        title={s.last_active ? new Date(s.last_active).toLocaleString() : undefined}
                      >
                        {s.last_active ? formatRelativeDate(s.last_active) : "—"}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              offset={studentOffset}
              limit={ROSTER_PAGE_SIZE}
              total={students.total_students}
              onChange={setStudentOffset}
            />
          </div>
        )}
      </Section>
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

/* ── Subcomponents ─────────────────────────────────────────────── */

function Section({
  number,
  label,
  action,
  children,
}: {
  number: string;
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 56 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 14,
          paddingBottom: 12,
          marginBottom: 20,
          borderBottom: "2px solid var(--ink)",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            color: "var(--muted-2)",
            letterSpacing: 0.5,
          }}
        >
          {number}
        </span>
        <h2
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 26,
            color: "var(--ink)",
            margin: 0,
            letterSpacing: -0.3,
          }}
        >
          {label}
        </h2>
        {action && <div style={{ marginLeft: "auto" }}>{action}</div>}
      </div>
      {children}
    </section>
  );
}

function DataBlock({
  label,
  value,
  sub,
  subColor,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  subColor?: string;
}) {
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 1.6,
          color: "var(--muted)",
          marginBottom: 10,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 32,
          color: "var(--ink)",
          letterSpacing: -0.5,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 12,
            color: subColor ?? "var(--muted)",
            marginTop: 8,
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function UnitEcon({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <div style={{ fontFamily: "var(--font-sans)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1.4, color: "var(--muted)", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, color: "var(--ink)", letterSpacing: -0.3, lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontFamily: "var(--font-sans)", fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
        {sub}
      </div>
    </div>
  );
}

function ActivityRow({
  label,
  curr,
  prev,
}: {
  label: string;
  curr: number;
  prev: number;
}) {
  const delta = curr - prev;
  const pct = prev > 0 ? (delta / prev) * 100 : null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1.4fr 0.6fr 0.6fr 1fr",
        alignItems: "baseline",
        padding: "14px 0",
        borderBottom: "1px solid var(--rule)",
        fontFamily: "var(--font-sans)",
      }}
    >
      <div style={{ fontSize: 14, color: "var(--ink)" }}>{label}</div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 22,
          color: curr > 0 ? "var(--ink)" : "var(--muted-2)",
          textAlign: "right",
        }}
      >
        {curr.toLocaleString()}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          color: "var(--muted-2)",
          textAlign: "right",
        }}
      >
        ({prev.toLocaleString()})
      </div>
      <div
        style={{
          fontSize: 12,
          color:
            delta > 0
              ? "var(--ok)"
              : delta < 0
                ? "var(--accent)"
                : "var(--muted-2)",
          textAlign: "right",
        }}
      >
        {delta === 0 ? "→ no change" : `${delta > 0 ? "↑" : "↓"} ${Math.abs(delta).toLocaleString()}${pct !== null ? ` (${Math.abs(pct).toFixed(0)}%)` : ""}`}
      </div>
    </div>
  );
}

function HealthBlock({
  label,
  count,
  href,
}: {
  label: string;
  count: number;
  href: string;
}) {
  const danger = count > 0;
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 1.6,
          color: "var(--muted)",
          marginBottom: 10,
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 32,
            color: danger ? "var(--danger)" : "var(--ok)",
            letterSpacing: -0.5,
            lineHeight: 1,
          }}
        >
          {count}
        </span>
        {danger && (
          <Link to={href} className="link-btn" style={{ fontSize: 13 }}>
            View {count} trace{count === 1 ? "" : "s"} →
          </Link>
        )}
      </div>
    </div>
  );
}

function EditHeader({
  form,
  onChange,
  onSubmit,
  onCancel,
  saving,
}: {
  form: EditForm;
  onChange: (f: EditForm) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <form
      onSubmit={onSubmit}
      style={{
        marginBottom: 36,
        padding: 20,
        border: "1px solid var(--rule-strong)",
        background: "var(--surface)",
        borderRadius: 3,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3 style={{ marginBottom: 0 }}>Edit school</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={onCancel} disabled={saving} style={btnGhost}>Cancel</button>
          <button type="submit" disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label="School name">
          <input type="text" value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} required style={inputStyle} />
        </Field>
        <Field label="Contact name">
          <input type="text" value={form.contact_name} onChange={(e) => onChange({ ...form, contact_name: e.target.value })} required style={inputStyle} />
        </Field>
        <Field label="Contact email">
          <input type="email" value={form.contact_email} onChange={(e) => onChange({ ...form, contact_email: e.target.value })} required style={inputStyle} />
        </Field>
        <div style={{ display: "flex", gap: 8 }}>
          <Field label="City">
            <input type="text" value={form.city} onChange={(e) => onChange({ ...form, city: e.target.value })} style={inputStyle} />
          </Field>
          <Field label="State">
            <input type="text" value={form.state} onChange={(e) => onChange({ ...form, state: e.target.value })} style={{ ...inputStyle, maxWidth: 80 }} />
          </Field>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <Field label="Internal notes">
            <textarea
              value={form.notes}
              onChange={(e) => onChange({ ...form, notes: e.target.value })}
              rows={2}
              placeholder="Deal context, pricing, etc."
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </Field>
        </div>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
      <label style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "var(--muted)", letterSpacing: 1.6 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

