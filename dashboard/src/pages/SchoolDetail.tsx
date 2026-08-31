import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip,
} from "recharts";
import {
  api,
  type SchoolDetail as SchoolDetailData,
  type SchoolOverviewData,
  type SchoolSection,
  type SchoolTeacher,
} from "../lib/api";
import { formatRelativeDate, fmtCost } from "../lib/format";
import { btnGhost, btnPrimary, btnSmall, inputStyle } from "../lib/styles";
import { useConfirm } from "../lib/confirm";
import { confirmAndDeleteUser } from "../lib/deleteUserFlow";
import { useToast } from "../lib/toast";
import StatTile from "../components/StatTile";
import StatusPill from "../components/StatusPill";
import DataTable, { type Column } from "../components/DataTable";
import {
  activityPill,
  activityStatus,
  costWindowLabel,
  isAtRisk,
} from "../lib/definitions";

// Dedicated per-school deep page. Lives at /schools/:schoolId. Two API
// fetches in parallel:
//   - /admin/schools/:id           the teacher → section → student tree
//   - /admin/schools/:id/overview  cost, activity, health
//
// The unit is teacher→class, not a flat student roster: every student
// lives UNDER a section, and a student enrolled in several sections
// appears under each. Per-submission AI cost rolls up to the section;
// a teacher's authoring/generation cost stays at the teacher level.

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
  const [error, setError] = useState<string | null>(null);

  // Which section rows are drilled open (id set). Client-side expand —
  // the students already ride along in the detail payload, so opening a
  // section costs no extra fetch.
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());

  // Edit (inline)
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);

  // Invite
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
    // Reset every per-school piece of state — mid-edit nav from school A
    // to school B shouldn't leave A's form fields mounted under B's
    // header. `handleSaveEdit` guards on `!detail` so a stale form can't
    // post against the wrong id, but the UI briefly showed wrong values
    // until reload landed.
    setDetail(null);
    setOverview(null);
    setOpenSections(new Set());
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

  const toggleSection = (id: string) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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

  // Account-level actions on the people inside the school. Both go
  // through the shared flow (lib/deleteUserFlow) so this page, the
  // Users directory and the independent-users panel gate a deletion
  // identically — the dangerous surface must not be the casual one.
  const handleDeleteUser = async (userId: string, label: string) => {
    try {
      if (await confirmAndDeleteUser(confirm, userId, label)) reload();
    } catch (err) {
      toast((err as Error).message);
    }
  };

  // Takes the TARGET state so the same handler reactivates. Without
  // that this page could only ever switch access off — the button read
  // "Deactivate" even for someone already deactivated, and undoing it
  // meant going to find them in the global Users directory.
  const handleSetUserActive = async (
    userId: string, label: string, nextActive: boolean,
  ) => {
    if (!nextActive && !(await confirm({
      title: `Deactivate ${label}?`,
      message: "They lose access immediately. Nothing is deleted — their classes, homework and grades stay exactly as they are, and you can reactivate them at any time.",
      confirmLabel: "Deactivate",
    }))) return;
    try {
      await api.setUserActive(userId, nextActive);
      toast(`${label} ${nextActive ? "reactivated" : "deactivated"}.`, "success");
      reload();
    } catch (err) {
      toast((err as Error).message);
    }
  };

  // What a delete actually does, stated in the dialog.
  //
  // It used to say only "N teachers will be unlinked", which left an
  // operator to guess at everything else — and the natural guess for a
  // button labelled "Permanently delete" is that a term's work goes
  // with it. It doesn't. Every FK to schools.id is ON DELETE SET NULL
  // except teacher_invites, so the delete DETACHES rather than
  // destroys (pinned in tests/test_admin_school_delete.py).
  //
  // The two non-obvious consequences are named because nothing else in
  // the UI reveals them: the classes survive but belong to no school,
  // and historical AI spend loses its school attribution — which in a
  // console built for cost tracking means deleting a school quietly
  // rewrites the reporting past.
  const handleDelete = async () => {
    if (!detail) return;
    // Takes the plural form explicitly — "class" + "s" is "classs".
    const plural = (n: number, one: string, many: string) =>
      `${n} ${n === 1 ? one : many}`;
    if (!(await confirm({
      title: `Permanently delete ${detail.name}?`,
      message: (
        <>
          <p style={{ margin: "0 0 8px" }}>
            <strong>{plural(detail.teachers.length, "teacher", "teachers")}</strong> and{" "}
            <strong>{plural(studentCount, "student", "students")}</strong> keep their
            accounts, but are unlinked from this school.
          </p>
          <p style={{ margin: "0 0 8px" }}>
            <strong>{plural(classCount, "class", "classes")}</strong> and all their
            homework, submissions and grades survive — but detach from the
            school and disappear from every school-scoped view.
          </p>
          <p style={{ margin: "0 0 8px" }}>
            The school's AI spend stays in platform totals but is no longer
            attributed to it.
          </p>
          <p style={{ margin: 0 }}>This cannot be undone.</p>
        </>
      ),
      confirmLabel: "Delete school",
    }))) return;
    try {
      await api.deleteSchool(detail.id);
      navigate("/schools");
    } catch (err) {
      const message = (err as Error).message;
      // A 404 here means the row is already gone — a double-click, or a
      // retry after a response was lost. The delete the operator wanted
      // has happened, so treat it as success rather than reporting a
      // failure for a school that no longer exists.
      if (/404|not found/i.test(message)) {
        navigate("/schools");
        return;
      }
      toast(message);
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

  // Distinct enrolled students across every section — a student in
  // multiple sections counts once here (but appears under each section
  // in the breakdown below). Memoized off the payload.
  const { classCount, studentCount } = useMemo(() => {
    const sections = [
      ...(detail?.teachers.flatMap((t) => t.sections) ?? []),
      ...(detail?.unassigned_sections ?? []),
    ];
    const ids = new Set<string>();
    for (const s of sections) for (const stu of s.students) ids.add(stu.id);
    return { classCount: sections.length, studentCount: ids.size };
  }, [detail]);

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
  const costPerStudent = studentCount > 0 ? overview.cost.cost_30d / studentCount : null;
  const costPerTeacher = teacherCount > 0 ? overview.cost.cost_30d / teacherCount : null;

  const statusPill = detail.is_active
    ? activityPill(activityStatus(overview.last_active_at))
    : { tone: "neutral" as const, label: "INACTIVE" };
  const lastActivityAtRisk =
    detail.is_active && isAtRisk({ lastActiveAt: overview.last_active_at, failedCalls: overview.failed_calls_24h });

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
        <StatTile label="Classes" value={classCount} />
        <StatTile label="Students" value={studentCount.toLocaleString()} />
        <StatTile
          label={`Cost · ${costWindowLabel()}`}
          value={fmtCost(overview.cost.cost_30d)}
          delta={cost30dDeltaPct === null ? undefined : { pct: cost30dDeltaPct, goodWhen: "down", note: "vs prev 30d" }}
        />
        <StatTile
          label="Last activity"
          tone={lastActivityAtRisk ? "warn" : "default"}
          value={overview.last_active_at ? formatRelativeDate(overview.last_active_at) : "none yet"}
        />
        <StatTile
          label="Failed · 24h"
          tone={overview.failed_calls_24h > 0 ? "danger" : "default"}
          value={overview.failed_calls_24h}
        />
      </div>

      {/* ── 01 — TEACHERS & CLASSES (the hero) ──────────────────── */}
      {/* The teacher → section → student hierarchy. Each teacher owns
          class periods; drill a class to see its students, their work,
          and grades. Per-submission AI cost rolls up to the class. */}
      <Section
        number="01"
        label={`Teachers & classes (${teacherCount})`}
        action={
          teacherCount > 0 ? (
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
        {teacherCount === 0 && detail.unassigned_sections.length === 0 ? (
          <p style={{ color: "var(--muted)", fontStyle: "italic" }}>
            No teachers yet. Invite one below to get the school started.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            {detail.teachers.map((t) => (
              <TeacherBlock
                key={t.id}
                teacher={t}
                openSections={openSections}
                onToggleSection={toggleSection}
                onDeleteUser={handleDeleteUser}
                onToggleActive={handleSetUserActive}
              />
            ))}
            {detail.unassigned_sections.length > 0 && (
              <UnassignedBlock
                sections={detail.unassigned_sections}
                openSections={openSections}
                onToggleSection={toggleSection}
                onDeleteUser={handleDeleteUser}
                onToggleActive={handleSetUserActive}
              />
            )}
          </div>
        )}
      </Section>

      {/* ── 02 — ACTIVITY (week over week) ──────────────────────── */}
      {!overview.is_internal && (
        <Section number="02" label="Activity (this week vs last)">
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

      {/* ── 03 — COST ───────────────────────────────────────────── */}
      <Section
        number="03"
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

      {/* ── 04 — HEALTH ─────────────────────────────────────────── */}
      <Section number="04" label="Health">
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

      {/* ── 05 — MANAGE TEACHERS (invite + pending) ─────────────── */}
      <Section number="05" label="Manage teachers">
        <div style={{ marginBottom: detail.pending_invites.length > 0 ? 28 : 0 }}>
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

        {detail.pending_invites.length > 0 && (
          <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 18 }}>
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
    </div>
  );
}

function gradeLabel(grade: number): string {
  if (grade <= 0) return "—";
  if (grade <= 2) return "K–2";
  if (grade <= 5) return "3–5";
  if (grade <= 8) return "6–8";
  if (grade <= 12) return "9–12";
  return "College";
}

/* ── Teacher → classes breakdown ───────────────────────────────── */

function TeacherBlock({
  teacher,
  openSections,
  onToggleSection,
  onDeleteUser,
  onToggleActive,
}: {
  teacher: SchoolTeacher;
  openSections: Set<string>;
  onToggleSection: (id: string) => void;
  onDeleteUser: (userId: string, label: string) => void;
  onToggleActive: (userId: string, label: string, nextActive: boolean) => void;
}) {
  // Teacher's last activity = the most recent submission across their
  // classes. Section-rolled cost + gen cost gives their full footprint.
  const sectionCost = teacher.sections.reduce((sum, s) => sum + s.cost_30d, 0);
  const totalCost = sectionCost + teacher.gen_cost_30d;
  const lastAt = teacher.sections
    .map((s) => s.last_activity_at)
    .filter((d): d is string => !!d)
    .sort()
    .at(-1) ?? null;
  const studentTotal = teacher.sections.reduce((sum, s) => sum + s.student_count, 0);

  return (
    <div style={{ border: "1px solid var(--rule)", borderRadius: 4, overflow: "hidden" }}>
      {/* Teacher header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          padding: "16px 18px",
          background: "var(--paper-2)",
          borderBottom: teacher.sections.length > 0 ? "1px solid var(--rule)" : "none",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <Link
            to={`/teachers/${teacher.id}`}
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 18,
              color: "var(--ink)",
              textDecoration: "none",
            }}
            title="View this teacher's roster"
          >
            {teacher.name || "—"}
          </Link>
          {/* Access state has to be visible on the roster itself. The
              only other signal is the Deactivate/Reactivate button
              label, which you have to read one row at a time — so
              "who has been switched off here?" was unanswerable at a
              glance on the page that answers everything else. */}
          {!teacher.is_active && (
            <span style={{ marginLeft: 8, verticalAlign: "middle" }}>
              <StatusPill tone="neutral" label="DEACTIVATED" title="Access revoked — nothing deleted" />
            </span>
          )}
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {teacher.email}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted-2)", marginTop: 6 }}>
            {teacher.sections.length} class{teacher.sections.length === 1 ? "" : "es"}
            {" · "}
            {studentTotal} student{studentTotal === 1 ? "" : "s"}
            {" · "}
            {lastAt ? `active ${formatRelativeDate(lastAt)}` : "no activity yet"}
          </div>
        </div>
        <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 16, color: totalCost > 0 ? "var(--ink)" : "var(--muted-2)", letterSpacing: -0.2 }}>
            {fmtCost(totalCost)}
            <span style={{ fontSize: 10.5, color: "var(--muted)", fontFamily: "var(--font-sans)", marginLeft: 5 }}>· 30d</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }} title="Authoring/generation spend not tied to a submission">
            {fmtCost(teacher.gen_cost_30d)} generation · {teacher.gen_call_count_30d.toLocaleString()} call{teacher.gen_call_count_30d === 1 ? "" : "s"}
          </div>
          <Link
            to={`/llm-calls?user=${teacher.id}&hours=720`}
            className="link-btn"
            style={{ fontSize: 11.5, marginTop: 4, display: "inline-block" }}
          >
            View calls →
          </Link>
          {/* Account actions sit on the teacher, not the school: an
              operator dealing with one departed teacher shouldn't have
              to go find them in the global Users directory. Deactivate
              is first and plainly styled because it is the right answer
              to almost every reason someone lands here; Delete is the
              destructive outlier and says so. */}
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 10 }}>
            <button
              style={{ ...btnSmall, ...btnGhost }}
              onClick={() => onToggleActive(teacher.id, teacher.email, !teacher.is_active)}
            >
              {teacher.is_active ? "Deactivate" : "Reactivate"}
            </button>
            <button
              style={{ ...btnSmall, ...btnGhost, color: "var(--danger)", borderColor: "var(--danger)" }}
              onClick={() => onDeleteUser(teacher.id, teacher.email)}
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      {/* Sections (class periods) */}
      {teacher.sections.length === 0 ? (
        <div style={{ padding: "14px 18px", fontSize: 12.5, color: "var(--muted)", fontStyle: "italic" }}>
          No classes yet.
        </div>
      ) : (
        <div>
          {teacher.sections.map((s) => (
            <SectionRow
              key={s.id}
              section={s}
              open={openSections.has(s.id)}
              onToggle={() => onToggleSection(s.id)}
              onDeleteUser={onDeleteUser}
              onToggleActive={onToggleActive}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Fallback bucket for sections whose owner isn't a current teacher of
// this school (a data anomaly). Renders with the same section rows so
// the students are still reachable rather than silently missing.
function UnassignedBlock({
  sections,
  openSections,
  onToggleSection,
  onDeleteUser,
  onToggleActive,
}: {
  sections: SchoolSection[];
  openSections: Set<string>;
  onToggleSection: (id: string) => void;
  onDeleteUser: (userId: string, label: string) => void;
  onToggleActive: (userId: string, label: string, nextActive: boolean) => void;
}) {
  return (
    <div style={{ border: "1px solid var(--rule)", borderRadius: 4, overflow: "hidden" }}>
      <div style={{ padding: "16px 18px", background: "var(--paper-2)", borderBottom: "1px solid var(--rule)" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--ink)" }}>
          Unassigned classes
        </div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
          {sections.length} class{sections.length === 1 ? "" : "es"} with no owning teacher at this school
        </div>
      </div>
      <div>
        {sections.map((s) => (
          <SectionRow
            key={s.id}
            section={s}
            open={openSections.has(s.id)}
            onToggle={() => onToggleSection(s.id)}
            onDeleteUser={onDeleteUser}
            onToggleActive={onToggleActive}
          />
        ))}
      </div>
    </div>
  );
}

// A factory rather than a const because the last column carries the
// per-student account actions, which need the page's handlers. Same
// gate as everywhere else — the shared flow decides how hard it is.
const studentCols = (
  onDeleteUser: (userId: string, label: string) => void,
  onToggleActive: (userId: string, label: string, nextActive: boolean) => void,
): Column<SchoolSection["students"][number]>[] => [
  {
    key: "student",
    header: "Student",
    width: "40%",
    render: (s) => (
      <div style={{ minWidth: 0 }}>
        <div style={{ color: "var(--ink)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }}>
          {s.name || "—"}
          {!s.is_active && (
            <span style={{ marginLeft: 6, verticalAlign: "middle" }}>
              <StatusPill tone="neutral" label="DEACTIVATED" title="Access revoked — nothing deleted" />
            </span>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis" }}>{s.email}</div>
      </div>
    ),
  },
  {
    key: "grade",
    header: "Grade",
    width: "12%",
    render: (s) => <span style={{ color: "var(--ink-soft)" }}>{gradeLabel(s.grade_level)}</span>,
  },
  {
    key: "subs",
    header: "Submissions",
    numeric: true,
    width: "16%",
    sortValue: (s) => s.submission_count,
    render: (s) => (
      <span style={{ color: s.submission_count > 0 ? "var(--ink)" : "var(--muted-2)" }}>
        {s.submission_count}
      </span>
    ),
  },
  {
    key: "grade_avg",
    header: "Avg grade",
    numeric: true,
    width: "16%",
    sortValue: (s) => s.avg_score ?? -1,
    render: (s) =>
      s.avg_score === null ? (
        <span style={{ color: "var(--muted-2)" }}>—</span>
      ) : (
        <span style={{ color: "var(--ink)" }} title={`${s.graded_count} graded`}>{Math.round(s.avg_score)}%</span>
      ),
  },
  {
    key: "last",
    header: "Last work",
    width: "16%",
    align: "right",
    render: (s) => (
      <span style={{ color: "var(--ink-soft)", fontSize: 12 }}>
        {s.last_activity_at ? formatRelativeDate(s.last_activity_at) : "—"}
      </span>
    ),
  },
  {
    key: "actions",
    header: "",
    width: "14%",
    align: "right",
    render: (s) => (
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button
          style={{ ...btnSmall, ...btnGhost }}
          onClick={() => onToggleActive(s.id, s.name || s.email, !s.is_active)}
        >
          {s.is_active ? "Deactivate" : "Reactivate"}
        </button>
        <button
          style={{ ...btnSmall, ...btnGhost, color: "var(--danger)", borderColor: "var(--danger)" }}
          onClick={() => onDeleteUser(s.id, s.name || s.email)}
        >
          Delete
        </button>
      </div>
    ),
  },
];

function SectionRow({
  section,
  open,
  onToggle,
  onDeleteUser,
  onToggleActive,
}: {
  section: SchoolSection;
  open: boolean;
  onToggle: () => void;
  onDeleteUser: (userId: string, label: string) => void;
  onToggleActive: (userId: string, label: string, nextActive: boolean) => void;
}) {
  return (
    <div style={{ borderTop: "1px solid var(--rule)" }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: "18px 2fr 1fr 1fr 1fr 1.1fr",
          gap: 14,
          alignItems: "center",
          padding: "13px 18px",
          background: open ? "var(--paper-2)" : "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          font: "inherit",
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 10, color: "var(--muted-2)", transition: "transform 0.12s", transform: open ? "rotate(90deg)" : "none" }}>▶</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 15.5, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {section.name}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {section.course_name}
          </div>
        </div>
        <SectionStat value={section.student_count} label="students" />
        <SectionStat value={section.submitted_count} label="submitted" tone={section.submitted_count > 0 ? "ink" : "muted"} />
        <div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: section.cost_30d > 0 ? "var(--ink)" : "var(--muted-2)", letterSpacing: -0.2 }}>
            {fmtCost(section.cost_30d)}
          </div>
          <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.8, marginTop: 2 }}>cost · 30d</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>
            {section.last_activity_at ? formatRelativeDate(section.last_activity_at) : "none yet"}
          </div>
          <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.8, marginTop: 2 }}>last work</div>
        </div>
      </button>

      {open && (
        <div style={{ padding: "4px 18px 18px", background: "var(--paper-2)" }}>
          {section.students.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "var(--muted)", fontStyle: "italic", margin: "8px 0 0" }}>
              No students enrolled in this class yet.
            </p>
          ) : (
            <DataTable
              columns={studentCols(onDeleteUser, onToggleActive)}
              rows={section.students}
              rowKey={(s) => s.id}
              defaultSort={{ key: "student", dir: "asc" }}
              minWidth={520}
              searchKeys={(s) => [s.name, s.email]}
              searchLabel="students"
              pageSize={25}
            />
          )}
        </div>
      )}
    </div>
  );
}

function SectionStat({ value, label, tone = "ink" }: { value: number; label: string; tone?: "ink" | "muted" }) {
  return (
    <div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 15, color: tone === "ink" && value > 0 ? "var(--ink)" : "var(--muted-2)", letterSpacing: -0.2 }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.8, marginTop: 2 }}>{label}</div>
    </div>
  );
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
