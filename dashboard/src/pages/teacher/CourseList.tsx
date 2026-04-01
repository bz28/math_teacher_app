import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type TeacherCoursesData } from "../../lib/api";

type CourseItem = TeacherCoursesData["courses"][number];

export default function CourseList() {
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("math");
  const navigate = useNavigate();

  useEffect(() => { load(); }, []);

  async function load() {
    try { setCourses((await api.teacherCourses()).courses); }
    finally { setLoading(false); }
  }

  async function handleCreate() {
    if (!name.trim()) return;
    try {
      const res = await api.teacherCreateCourse({ name: name.trim(), subject });
      setName(""); setShowCreate(false);
      navigate(`/courses/${res.id}`);
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  }

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      <div className="page-header">
        <h1>Courses</h1>
        <p>Manage your courses, sections, and materials</p>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Courses</div>
          <div className="stat-value">{courses.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Sections</div>
          <div className="stat-value">{courses.reduce((s, c) => s + c.section_count, 0)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Documents</div>
          <div className="stat-value">{courses.reduce((s, c) => s + c.doc_count, 0)}</div>
        </div>
      </div>

      {showCreate ? (
        <div className="table-card" style={{ maxWidth: 480, padding: 20, marginBottom: 20 }}>
          <h3>Create Course</h3>
          <input type="text" placeholder="Course name (e.g. Algebra II)"
            value={name} onChange={e => setName(e.target.value)}
            style={{ width: "100%", padding: "8px 12px", marginBottom: 8, border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14 }} />
          <select value={subject} onChange={e => setSubject(e.target.value)}
            style={{ padding: "8px 12px", marginBottom: 12, border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14 }}>
            <option value="math">Math</option>
            <option value="chemistry">Chemistry</option>
          </select>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-primary" onClick={handleCreate}>Create</button>
            <button className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="btn-primary" onClick={() => setShowCreate(true)} style={{ marginBottom: 20 }}>+ New Course</button>
      )}

      {courses.length === 0 ? (
        <div className="table-card" style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>
          No courses yet. Create one to get started.
        </div>
      ) : (
        <div className="table-card">
          <table>
            <thead><tr><th>Course</th><th>Subject</th><th>Sections</th><th>Documents</th><th>Status</th></tr></thead>
            <tbody>
              {courses.map(c => (
                <tr key={c.id} className="clickable" onClick={() => navigate(`/courses/${c.id}`)}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td><span className="badge badge-active">{c.subject}</span></td>
                  <td>{c.section_count}</td>
                  <td>{c.doc_count}</td>
                  <td><span className={`badge ${c.status === "active" ? "badge-completed" : "badge-abandoned"}`}>{c.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
