import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type TeacherStudentsData } from "../lib/api";
import { formatRelativeDate } from "../lib/format";

// Per-teacher drill-in. Lives at /teachers/:teacherId. Reachable from
// the Independent Teachers list (and, once the SchoolDetail teacher
// rows link here in PR 4, from any institutional school's roster).
// The endpoint resolves teacher metadata + section list + student
// roster in one call so we render the page from a single fetch.

export default function TeacherDetail() {
  const { teacherId } = useParams<{ teacherId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<TeacherStudentsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!teacherId) return;
    // Reset every per-teacher piece of state — mid-page nav from
    // teacher A to teacher B shouldn't leave A's roster mounted under
    // B's header. The reset-in-effect lint exception mirrors what
    // SchoolDetail does for the same reason.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    setError(null);
    api
      .teacherStudents(teacherId)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [teacherId]);

  if (error) {
    return (
      <div className="page-header">
        <h1>Teacher not found</h1>
        <p>{error}</p>
        <Link to="/teachers/independent">← Back to Independent teachers</Link>
      </div>
    );
  }
  if (!data) return <p className="loading">Loading…</p>;

  const t = data.teacher;
  const isPro = t.subscription_tier === "pro";

  return (
    <div>
      <div className="page-header">
        <span className="eyebrow">
          <Link
            to="/teachers/independent"
            style={{ color: "var(--muted-2)", textDecoration: "none" }}
          >
            ← Independent teachers
          </Link>
        </span>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
          <h1>{t.name || t.email}</h1>
        </div>
        <p>
          <span style={{ fontFamily: "var(--font-mono)" }}>{t.email}</span>
          {"  ·  "}
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
          <h2 style={{ margin: 0, fontSize: 14, letterSpacing: 1.4, textTransform: "uppercase", color: "var(--muted)" }}>
            Sections
          </h2>
          <span style={{ color: "var(--muted-2)", fontSize: 12 }}>
            {data.sections.length} {data.sections.length === 1 ? "section" : "sections"}
          </span>
        </div>
        {data.sections.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">No sections yet</div>
            <div className="empty-state-sub">
              This teacher hasn't created any sections. Roster will fill in once they do.
            </div>
          </div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {data.sections.map((s) => (
              <li
                key={s.id}
                style={{
                  padding: "10px 16px",
                  borderBottom: "1px solid var(--rule)",
                  display: "flex",
                  justifyContent: "space-between",
                  fontFamily: "var(--font-sans)",
                  fontSize: 14,
                }}
              >
                <span>{s.name}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="table-card">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            padding: "12px 16px",
            borderBottom: "1px solid var(--rule)",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 14, letterSpacing: 1.4, textTransform: "uppercase", color: "var(--muted)" }}>
            Students
          </h2>
          <span style={{ color: "var(--muted-2)", fontSize: 12 }}>
            {data.total_students} {data.total_students === 1 ? "student" : "students"}
          </span>
        </div>

        {data.students.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">No students enrolled</div>
            <div className="empty-state-sub">
              Once students join a section via this teacher's code, they'll appear here.
            </div>
          </div>
        ) : (
          <div className="table-scroll">
            <table>
              <colgroup>
                <col style={{ width: "32%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "6%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Plan</th>
                  <th>Grade</th>
                  <th>Joined</th>
                  <th>Last active</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.students.map((s) => (
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
                    <td>
                      <button
                        className="action-toggle"
                        onClick={() => navigate(`/llm-calls?user=${s.id}`)}
                        title="View this student's LLM calls"
                      >
                        →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
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
