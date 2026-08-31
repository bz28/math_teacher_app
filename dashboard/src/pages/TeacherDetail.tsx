import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type TeacherRosterStudent, type TeacherStudentsData } from "../lib/api";
import { formatRelativeDate } from "../lib/format";
import { activityPill, activityStatus, costWindowLabel } from "../lib/definitions";
import StatTile from "../components/StatTile";
import StatusPill from "../components/StatusPill";
import DataTable, { type Column } from "../components/DataTable";
import TeacherActivitySection from "../components/TeacherActivitySection";
import TeacherLLMCalls from "../components/TeacherLLMCalls";
import TeacherSubmissions from "../components/TeacherSubmissions";
import { useScopeToSchool } from "../lib/useSelectedSchool";

// Per-teacher drill-in — the "what is this pilot teacher actually doing"
// view. Lives at /teachers/:teacherId, reachable from the Independent
// Teachers list and from any school's roster. One fetch resolves the
// teacher, their usage rollup, sections, and student roster; the AI
// generations + activity timeline load lazily inside
// TeacherActivitySection. Matches the Overview aesthetic (StatTile grid,
// StatusPill verdict, DataTable rows).

export default function TeacherDetail() {
  const { teacherId } = useParams<{ teacherId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<TeacherStudentsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Click a section to filter the roster to just its students.
  const [sectionFilter, setSectionFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!teacherId) return;
    // Reset every per-teacher piece of state — mid-page nav from teacher
    // A to teacher B shouldn't leave A's roster (or section filter)
    // mounted under B's header.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    setError(null);
    setSectionFilter(null);
    api
      .teacherStudents(teacherId)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [teacherId]);

  // Tell the rail which school this page is showing, so the switcher
  // can't sit there naming a different one an inch from the breadcrumb.
  // Institutional only: an indie teacher's synthetic school isn't in the
  // switcher's list, and publishing it would just move the contradiction.
  useScopeToSchool(
    data?.teacher.school?.kind === "institutional" ? data.teacher.school.id : null,
  );

  const sectionNames = useMemo(
    () => Object.fromEntries((data?.sections ?? []).map((s) => [s.id, s.name])),
    [data],
  );

  if (error) {
    return (
      <div className="page-header">
        <h1>Teacher not found</h1>
        <p>{error}</p>
        <Link to="/teachers/independent" className="link-btn">← Back to Independent teachers</Link>
      </div>
    );
  }
  if (!data) return <p className="loading">Loading…</p>;

  const t = data.teacher;
  const u = data.usage;
  const isPro = t.subscription_tier === "pro";
  const health = activityPill(activityStatus(t.last_active_at));

  // Breadcrumb: institutional teachers trail back to their School page;
  // indie teachers (individual synthetic school, or none) to the
  // Independent Teachers list. Fixes the old hardcoded "Independent".
  const breadcrumb =
    t.school && t.school.kind === "institutional"
      ? { to: `/schools/${t.school.id}`, label: t.school.name }
      : { to: "/teachers/independent", label: "Independent teachers" };

  const gradedPct =
    u.submissions_received > 0
      ? Math.round((u.graded / u.submissions_received) * 100)
      : null;
  const reachPct =
    data.total_students > 0
      // students_reached is all-time distinct submitters; total_students is
      // current enrollment. A student who submitted then unenrolled could
      // push this past 100%, so cap it — "of N enrolled" should never
      // read >100%.
      ? Math.min(100, Math.round((u.students_reached / data.total_students) * 100))
      : null;

  const visibleStudents = sectionFilter
    ? data.students.filter((s) => (s.section_ids ?? []).includes(sectionFilter))
    : data.students;

  return (
    <div>
      {/* Breadcrumb */}
      <div style={{ marginBottom: 14 }}>
        <Link to={breadcrumb.to} className="link-btn">← {breadcrumb.label}</Link>
      </div>

      {/* ── ① Identity + health verdict ──────────────────────────── */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 20,
          flexWrap: "wrap",
          marginBottom: 28,
        }}
      >
        <div className="page-header" style={{ marginBottom: 0 }}>
          <span className="eyebrow">Teacher</span>
          <h1 style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            {t.name || t.email}
            <StatusPill {...health} />
          </h1>
          <p style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--font-mono)" }}>{t.email}</span>
            <span
              className="badge"
              style={
                isPro
                  ? { background: "var(--info-soft)", color: "var(--info)" }
                  : { background: "transparent", color: "var(--muted)" }
              }
            >
              {isPro ? "Pro" : "Free"}
            </span>
          </p>
        </div>

        {/* Headline numbers: what this teacher DID. Cost used to lead this
            row — the largest number in the largest slot on the console's
            hero page — which put spend ahead of the work on the one screen
            you open when a teacher reports a problem. It moved down beside
            the calls it describes; the calls panel header carries it now. */}
        <div style={{ display: "flex", gap: 28, alignItems: "flex-start", flexWrap: "wrap" }}>
          <HeadlineStat label="Students" value={data.total_students.toLocaleString()} />
          {/* The classroom total, not the calls billed to her user id.
              The generation split lives on the panel below. */}
          <HeadlineStat
            label="Model calls"
            value={t.call_count_30d.toLocaleString()}
            muted={t.call_count_30d === 0}
            sub={costWindowLabel(30)}
          />
          <HeadlineStat label="Generations" value={u.generations.toLocaleString()} />
        </div>
      </div>

      {/* ── ② KPI strip — rich teacher usage ─────────────────────── */}
      <div className="tile-grid">
        <StatTile
          label="Homeworks"
          value={u.homeworks_created.toLocaleString()}
          sub={
            u.homeworks_per_week !== null && u.problems_per_homework !== null
              ? `${u.problems_per_homework} problems each · ≈${u.homeworks_per_week}/week`
              : undefined
          }
        />
        {/* `homeworks_per_week` belongs to homeworks, and rendering it here
            put "≈ 1 HW/week" under a practice-set count of 0 — a number
            about a different thing entirely. Practice sets have no cadence
            of their own in the payload, so this tile carries no subline
            rather than borrowing a wrong one. */}
        <StatTile
          label="Practice sets"
          value={u.practice_sets.toLocaleString()}
        />
        <StatTile
          label="Published"
          value={u.published.toLocaleString()}
          sub="live to students"
        />
        <StatTile
          label="Submissions"
          value={u.submissions_received.toLocaleString()}
          sub="received from students"
        />
        <StatTile
          label="Graded"
          value={u.graded.toLocaleString()}
          sub={gradedPct !== null ? `${gradedPct}% of submissions` : undefined}
        />
        <StatTile
          label="Students reached"
          value={u.students_reached.toLocaleString()}
          sub={reachPct !== null ? `${reachPct}% of ${data.total_students} enrolled` : undefined}
        />
      </div>

      {/* Cadence caption — last-created recency the tiles can't carry. */}
      <p style={{ margin: "2px 0 30px", fontSize: 12.5, color: "var(--muted)" }}>
        {u.last_created_at ? (
          <>Last created something {formatRelativeDate(u.last_created_at)}.</>
        ) : (
          <>This teacher hasn't created any assignments yet.</>
        )}
      </p>

      {/* ── ③ AI generations + activity timeline (richest surface) ── */}
      <TeacherActivitySection teacherId={t.id} />

      {/* Every model call she caused, openable in place. The page already
          linked out to a pre-filtered /llm-calls, which answers "how much
          did she cost" but not the question you actually have when she
          reports something odd: what did we send, and what came back. That
          was one click into another page with the filter to re-apply. */}
      {/* ── Work handed in ───────────────────────────────────────
          Above Model calls deliberately. A complaint is about a GRADE far
          more often than about a generation, and grading/integrity calls
          are billed to the student who submitted — so they are absent
          from the panel below and reachable only through here. */}
      <section className="table-card" style={{ marginBottom: 24 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            padding: "12px 16px",
            borderBottom: "1px solid var(--rule)",
          }}
        >
          <h3 style={{ margin: 0 }}>Work handed in</h3>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted-2)" }}>
            click a row for its full trace
          </span>
        </div>
        <div style={{ padding: "12px 16px 4px" }}>
          <TeacherSubmissions key={t.id} teacherId={t.id} />
        </div>
      </section>

      <section className="table-card" style={{ marginBottom: 24 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            padding: "12px 16px",
            borderBottom: "1px solid var(--rule)",
          }}
        >
          <h3 style={{ margin: 0 }}>Content generation</h3>
          {/* Only when there is a row to click. */}
          {t.generated_call_count_30d > 0 && (
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted)" }}>
              click a row for the exchange
            </span>
          )}
        </div>
        <div style={{ padding: "12px 16px 4px" }}>
          <TeacherLLMCalls key={t.id} teacherId={t.id} />
        </div>
      </section>

      {/* ── Sections (compact, click to filter the roster) ───────── */}
      <SectionsCard
        data={data}
        selected={sectionFilter}
        onSelect={(id) => setSectionFilter((cur) => (cur === id ? null : id))}
      />

      {/* ── Students roster ──────────────────────────────────────── */}
      <StudentsCard
        students={visibleStudents}
        total={data.total_students}
        filterLabel={sectionFilter ? sectionNames[sectionFilter] : null}
        onClearFilter={() => setSectionFilter(null)}
        onDrill={(id) => navigate(`/llm-calls?user=${id}`)}
      />
    </div>
  );
}

// ── Header headline stat — a compact mono metric block ──

function HeadlineStat({
  label,
  value,
  sub,
  muted,
}: {
  label: string;
  value: string;
  sub?: string;
  muted?: boolean;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 1.4,
          color: "var(--muted)",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 22,
          letterSpacing: -0.3,
          lineHeight: 1,
          color: muted ? "var(--muted-2)" : "var(--ink)",
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{sub}</div>
      )}
    </div>
  );
}

// ── Sections card ──

function SectionsCard({
  data,
  selected,
  onSelect,
}: {
  data: TeacherStudentsData;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const cols: Column<TeacherStudentsData["sections"][number]>[] = [
    {
      key: "name",
      header: "Section",
      width: "50%",
      render: (s) => (
        <span style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--ink)" }}>
          {s.name}
        </span>
      ),
    },
    {
      key: "students",
      header: "Students",
      numeric: true,
      width: "22%",
      sortValue: (s) => s.student_count,
      render: (s) => (
        <span style={{ color: s.student_count > 0 ? "var(--ink)" : "var(--muted-2)" }}>
          {s.student_count.toLocaleString()}
        </span>
      ),
    },
    {
      key: "last",
      header: "Last activity",
      width: "28%",
      align: "right",
      sortValue: (s) => (s.last_activity_at ? new Date(s.last_activity_at).getTime() : 0),
      render: (s) =>
        s.last_activity_at ? (
          <span style={{ fontSize: 12.5 }} title={new Date(s.last_activity_at).toLocaleString()}>
            {formatRelativeDate(s.last_activity_at)}
          </span>
        ) : (
          <span style={{ color: "var(--muted-2)" }}>—</span>
        ),
    },
  ];

  return (
    <section className="table-card" style={{ marginBottom: 24 }}>
      <CardHead
        title="Sections"
        right={`${data.sections.length} ${data.sections.length === 1 ? "section" : "sections"}`}
      />
      <DataTable
        columns={cols}
        rows={data.sections}
        rowKey={(s) => s.id}
        onRowClick={(s) => onSelect(s.id)}
        rowStatus={(s) => (s.id === selected ? "var(--accent)" : undefined)}
        drill
        minWidth={480}
        empty={
          <div className="empty-state">
            <div className="empty-state-title">No sections yet</div>
            <div className="empty-state-sub">
              Roster fills in once this teacher creates a section.
            </div>
          </div>
        }
      />
    </section>
  );
}

// ── Students card ──

function StudentsCard({
  students,
  total,
  filterLabel,
  onClearFilter,
  onDrill,
}: {
  students: TeacherRosterStudent[];
  total: number;
  filterLabel: string | null;
  onClearFilter: () => void;
  onDrill: (id: string) => void;
}) {
  const cols: Column<TeacherRosterStudent>[] = [
    {
      key: "student",
      header: "Student",
      width: "44%",
      render: (s) => (
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 16,
              color: "var(--ink)",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {s.name || "—"}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis" }}>
            {s.email}
          </div>
        </div>
      ),
    },
    {
      key: "grade",
      header: "Grade",
      width: "16%",
      render: (s) => (
        <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
          {s.grade_level > 0 ? gradeLabel(s.grade_level) : "—"}
        </span>
      ),
    },
    {
      key: "joined",
      header: "Joined",
      width: "20%",
      sortValue: (s) => new Date(s.registered).getTime(),
      render: (s) => (
        <span style={{ fontSize: 12 }} title={new Date(s.registered).toLocaleString()}>
          {formatRelativeDate(s.registered)}
        </span>
      ),
    },
    {
      key: "active",
      header: "Last active",
      width: "20%",
      sortValue: (s) => (s.last_active ? new Date(s.last_active).getTime() : 0),
      render: (s) =>
        s.last_active ? (
          <span style={{ fontSize: 12 }} title={new Date(s.last_active).toLocaleString()}>
            {formatRelativeDate(s.last_active)}
          </span>
        ) : (
          <span style={{ color: "var(--muted-2)" }}>—</span>
        ),
    },
  ];

  return (
    <section className="table-card">
      <CardHead
        title="Students"
        right={
          filterLabel ? (
            <button
              type="button"
              className="filter-badge"
              onClick={onClearFilter}
              style={{ cursor: "pointer", border: "none" }}
              title="Clear section filter"
            >
              {filterLabel} · {students.length} ✕
            </button>
          ) : (
            `${total} ${total === 1 ? "student" : "students"}`
          )
        }
      />
      <DataTable
        columns={cols}
        rows={students}
        rowKey={(s) => s.id}
        onRowClick={(s) => onDrill(s.id)}
        drill
        minWidth={560}
        searchKeys={(s) => [s.name, s.email]}
        searchLabel="students"
        pageSize={25}
        empty={
          <div className="empty-state">
            <div className="empty-state-title">
              {filterLabel ? "No students in this section" : "No students enrolled"}
            </div>
            <div className="empty-state-sub">
              {filterLabel
                ? "Pick another section, or clear the filter."
                : "Once students join a section via this teacher's code, they'll appear here."}
            </div>
          </div>
        }
      />
    </section>
  );
}

function CardHead({ title, right }: { title: string; right: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "12px 16px",
        borderBottom: "1px solid var(--rule)",
      }}
    >
      <h2 style={{ margin: 0, fontSize: 14, letterSpacing: 1.4, textTransform: "uppercase", color: "var(--muted)" }}>
        {title}
      </h2>
      <span style={{ color: "var(--muted-2)", fontSize: 12 }}>{right}</span>
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
