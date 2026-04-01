import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, type TeacherCourseData, type TeacherSectionsData, type TeacherSectionDetailData, type TeacherDocumentsData } from "../../lib/api";

type Tab = "sections" | "documents" | "settings";

export default function CourseDetail() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const [course, setCourse] = useState<TeacherCourseData | null>(null);
  const [tab, setTab] = useState<Tab>("sections");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!courseId) return;
    api.teacherCourse(courseId).then(setCourse).finally(() => setLoading(false));
  }, [courseId]);

  if (loading) return <p>Loading...</p>;
  if (!course || !courseId) return <p>Not found.</p>;

  return (
    <div>
      <div className="page-header">
        <p style={{ cursor: "pointer", color: "#6366f1", marginBottom: 8 }} onClick={() => navigate("/courses")}>&larr; Courses</p>
        <h1>{course.name}</h1>
        <p>{course.subject} {course.grade_level ? `· Grade ${course.grade_level}` : ""}</p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, marginBottom: 24, borderBottom: "2px solid #e2e8f0" }}>
        {(["sections", "documents", "settings"] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "10px 20px", fontSize: 14, fontWeight: tab === t ? 600 : 400,
            color: tab === t ? "#6366f1" : "#64748b", background: "none", border: "none",
            borderBottom: tab === t ? "2px solid #6366f1" : "2px solid transparent",
            marginBottom: -2, cursor: "pointer",
          }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "sections" && <SectionsTab courseId={courseId} />}
      {tab === "documents" && <DocumentsTab courseId={courseId} />}
      {tab === "settings" && <SettingsTab course={course} courseId={courseId} onUpdate={setCourse} navigate={navigate} />}
    </div>
  );
}

// --- Sections Tab ---

function SectionsTab({ courseId }: { courseId: string }) {
  const [sections, setSections] = useState<TeacherSectionsData["sections"]>([]);
  const [selected, setSelected] = useState<TeacherSectionDetailData | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addError, setAddError] = useState("");
  const [joinCode, setJoinCode] = useState<string | null>(null);

  useEffect(() => { load(); }, [courseId]);

  async function load() {
    setSections((await api.teacherSections(courseId)).sections);
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    await api.teacherCreateSection(courseId, newName.trim());
    setNewName(""); setShowCreate(false); load();
  }

  async function handleSelect(sectionId: string) {
    setSelected(await api.teacherSection(courseId, sectionId));
    setJoinCode(null); setAddEmail(""); setAddError("");
  }

  async function handleAddStudent() {
    if (!selected || !addEmail.trim()) return;
    setAddError("");
    try {
      await api.teacherAddStudent(courseId, selected.id, addEmail.trim());
      setAddEmail("");
      handleSelect(selected.id);
    } catch (e) { setAddError(e instanceof Error ? e.message : "Failed"); }
  }

  async function handleRemove(studentId: string) {
    if (!selected || !confirm("Remove student?")) return;
    await api.teacherRemoveStudent(courseId, selected.id, studentId);
    handleSelect(selected.id);
  }

  async function handleJoinCode() {
    if (!selected) return;
    const res = await api.teacherGenerateJoinCode(courseId, selected.id);
    setJoinCode(res.join_code);
  }

  async function handleDelete(sectionId: string) {
    if (!confirm("Delete this section?")) return;
    await api.teacherDeleteSection(courseId, sectionId);
    if (selected?.id === sectionId) setSelected(null);
    load();
  }

  return (
    <div>
      {showCreate ? (
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input type="text" placeholder="Section name (e.g. Period 1)" value={newName}
            onChange={e => setNewName(e.target.value)}
            style={{ padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14, width: 240 }} />
          <button className="btn-primary" onClick={handleCreate}>Add</button>
          <button className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
        </div>
      ) : (
        <button className="btn-primary" onClick={() => setShowCreate(true)} style={{ marginBottom: 16 }}>+ Add Section</button>
      )}

      <div style={{ display: "flex", gap: 16 }}>
        {/* Section list */}
        <div style={{ width: 240 }}>
          {sections.length === 0 ? (
            <p style={{ color: "#94a3b8", fontSize: 13 }}>No sections yet.</p>
          ) : sections.map(s => (
            <div key={s.id} onClick={() => handleSelect(s.id)} style={{
              padding: "10px 14px", borderRadius: 8, marginBottom: 4, cursor: "pointer",
              background: selected?.id === s.id ? "#ede9fe" : "#fff",
              border: `1px solid ${selected?.id === s.id ? "#6366f1" : "#e2e8f0"}`,
            }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</div>
              <div style={{ fontSize: 12, color: "#64748b" }}>{s.student_count} students</div>
            </div>
          ))}
        </div>

        {/* Section detail */}
        {selected && (
          <div style={{ flex: 1 }}>
            <div className="table-card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h3 style={{ margin: 0 }}>{selected.name}</h3>
                <button className="btn-danger-sm" onClick={() => handleDelete(selected.id)}>Delete Section</button>
              </div>

              {/* Join code */}
              <div style={{ marginBottom: 16, padding: 12, background: "#f8fafc", borderRadius: 8 }}>
                {joinCode || selected.join_code ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: 4, color: "#6366f1" }}>
                      {joinCode || selected.join_code}
                    </span>
                    <button className="btn-secondary" onClick={() => navigator.clipboard.writeText(joinCode || selected.join_code || "")}>
                      Copy
                    </button>
                  </div>
                ) : (
                  <button className="btn-secondary" onClick={handleJoinCode}>Generate Join Code</button>
                )}
                <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>Students enter this code to join.</p>
              </div>

              {/* Add student */}
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <input type="email" placeholder="Add student by email" value={addEmail}
                  onChange={e => setAddEmail(e.target.value)}
                  style={{ flex: 1, padding: "8px 12px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14 }} />
                <button className="btn-primary" onClick={handleAddStudent}>Add</button>
              </div>
              {addError && <p className="error" style={{ marginBottom: 8 }}>{addError}</p>}

              {/* Student list */}
              {selected.students.length === 0 ? (
                <p style={{ color: "#94a3b8", fontSize: 13 }}>No students yet.</p>
              ) : (
                <table>
                  <thead><tr><th>Name</th><th>Email</th><th></th></tr></thead>
                  <tbody>
                    {selected.students.map(s => (
                      <tr key={s.id}>
                        <td style={{ fontWeight: 500 }}>{s.name}</td>
                        <td style={{ color: "#64748b" }}>{s.email}</td>
                        <td><button className="btn-danger-sm" onClick={() => handleRemove(s.id)}>Remove</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Documents Tab ---

function DocumentsTab({ courseId }: { courseId: string }) {
  const [docs, setDocs] = useState<TeacherDocumentsData["documents"]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { load(); }, [courseId]);

  async function load() {
    setDocs((await api.teacherDocuments(courseId)).documents);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const base64 = await fileToBase64(file);
      await api.teacherUploadDocument(courseId, { image_base64: base64, filename: file.name });
      load();
    } catch (err) { alert(err instanceof Error ? err.message : "Upload failed"); }
    finally { setUploading(false); e.target.value = ""; }
  }

  async function handleDelete(docId: string) {
    if (!confirm("Delete this document?")) return;
    await api.teacherDeleteDocument(courseId, docId);
    load();
  }

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div>
      <label className="btn-primary" style={{ cursor: "pointer", marginBottom: 16, display: "inline-block" }}>
        {uploading ? "Uploading..." : "Upload Document"}
        <input type="file" accept="image/*,.pdf" onChange={handleUpload} style={{ display: "none" }} disabled={uploading} />
      </label>

      {docs.length === 0 ? (
        <div className="table-card" style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>
          No documents yet. Upload worksheets, textbook pages, or handouts.
        </div>
      ) : (
        <div className="table-card">
          <table>
            <thead><tr><th>Filename</th><th>Type</th><th>Size</th><th>Uploaded</th><th></th></tr></thead>
            <tbody>
              {docs.map(d => (
                <tr key={d.id}>
                  <td style={{ fontWeight: 500 }}>{d.filename}</td>
                  <td><span className="badge badge-active">{d.file_type.split("/")[1]}</span></td>
                  <td>{formatSize(d.file_size)}</td>
                  <td style={{ fontSize: 12, color: "#64748b" }}>{new Date(d.created_at).toLocaleDateString()}</td>
                  <td><button className="btn-danger-sm" onClick={() => handleDelete(d.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Settings Tab ---

function SettingsTab({ course, courseId, onUpdate, navigate }: {
  course: TeacherCourseData; courseId: string;
  onUpdate: (c: TeacherCourseData) => void; navigate: (path: string) => void;
}) {
  const [name, setName] = useState(course.name);
  const [description, setDescription] = useState(course.description || "");

  async function handleSave() {
    await api.teacherUpdateCourse(courseId, { name: name.trim(), description: description.trim() || null });
    onUpdate({ ...course, name: name.trim(), description: description.trim() || null });
  }

  async function handleDelete() {
    if (!confirm("Delete this course and all its sections, documents, and data?")) return;
    await api.teacherDeleteCourse(courseId);
    navigate("/courses");
  }

  return (
    <div className="table-card" style={{ maxWidth: 480 }}>
      <h3>Course Settings</h3>
      <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 }}>Name</label>
      <input type="text" value={name} onChange={e => setName(e.target.value)}
        style={{ width: "100%", padding: "8px 12px", marginBottom: 12, border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14 }} />
      <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b", display: "block", marginBottom: 4 }}>Description</label>
      <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
        style={{ width: "100%", padding: "8px 12px", marginBottom: 16, border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 14, resize: "vertical" }} />
      <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
        <button className="btn-primary" onClick={handleSave}>Save</button>
        <button className="btn-danger-sm" onClick={handleDelete} style={{ padding: "8px 16px" }}>Delete Course</button>
      </div>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
