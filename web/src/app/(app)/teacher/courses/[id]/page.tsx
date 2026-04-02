"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { teacher, type TeacherCourse, type TeacherSection, type TeacherSectionDetail, type TeacherDocument } from "@/lib/api";
import { Button, useToast } from "@/components/ui";

type Tab = "sections" | "documents" | "settings";

export default function CourseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();

  const [course, setCourse] = useState<TeacherCourse | null>(null);
  const [tab, setTab] = useState<Tab>("sections");
  const [loading, setLoading] = useState(true);

  // Sections
  const [sections, setSections] = useState<TeacherSection[]>([]);
  const [sectionDetail, setSectionDetail] = useState<TeacherSectionDetail | null>(null);
  const [newSectionName, setNewSectionName] = useState("");
  const [addStudentEmail, setAddStudentEmail] = useState("");

  // Documents
  const [documents, setDocuments] = useState<TeacherDocument[]>([]);

  // Settings
  const [editName, setEditName] = useState("");
  const [editSubject, setEditSubject] = useState("");

  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    teacher.course(id).then((c) => {
      if (cancelled) return;
      setCourse(c);
      setEditName(c.name);
      setEditSubject(c.subject);
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (tab === "sections") {
      teacher.sections(id).then((d) => setSections(d.sections)).catch(() => {});
    }
    if (tab === "documents") {
      teacher.documents(id).then((d) => setDocuments(d.documents)).catch(() => {});
    }
  }, [tab, id]);

  function reloadSections() {
    teacher.sections(id).then((d) => setSections(d.sections)).catch(() => {});
  }

  function reloadDocuments() {
    teacher.documents(id).then((d) => setDocuments(d.documents)).catch(() => {});
  }

  async function handleCreateSection(e: FormEvent) {
    e.preventDefault();
    try {
      await teacher.createSection(id, newSectionName.trim());
      setNewSectionName("");
      reloadSections();
      toast.success("Section created");
    } catch (err) { toast.error((err as Error).message); }
  }

  async function handleViewSection(sectionId: string) {
    try {
      const d = await teacher.section(id, sectionId);
      setSectionDetail(d);
    } catch (err) { toast.error((err as Error).message); }
  }

  async function handleGenerateCode(sectionId: string) {
    try {
      const res = await teacher.generateJoinCode(id, sectionId);
      toast.success(`Join code: ${res.join_code}`);
      reloadSections();
      if (sectionDetail?.id === sectionId) handleViewSection(sectionId);
    } catch (err) { toast.error((err as Error).message); }
  }

  async function handleAddStudent(e: FormEvent) {
    e.preventDefault();
    if (!sectionDetail) return;
    try {
      await teacher.addStudent(id, sectionDetail.id, addStudentEmail.trim());
      setAddStudentEmail("");
      handleViewSection(sectionDetail.id);
      toast.success("Student added");
    } catch (err) { toast.error((err as Error).message); }
  }

  async function handleRemoveStudent(studentId: string) {
    if (!sectionDetail || !confirm("Remove this student?")) return;
    try {
      await teacher.removeStudent(id, sectionDetail.id, studentId);
      handleViewSection(sectionDetail.id);
    } catch (err) { toast.error((err as Error).message); }
  }

  async function handleDeleteSection(sectionId: string) {
    if (!confirm("Delete this section? All students will be unenrolled.")) return;
    try {
      await teacher.deleteSection(id, sectionId);
      reloadSections();
      if (sectionDetail?.id === sectionId) setSectionDetail(null);
      toast.success("Section deleted");
    } catch (err) { toast.error((err as Error).message); }
  }

  async function handleUpdateCourse(e: FormEvent) {
    e.preventDefault();
    try {
      await teacher.updateCourse(id, { name: editName.trim(), subject: editSubject });
      const c = await teacher.course(id);
      setCourse(c);
      toast.success("Course updated");
    } catch (err) { toast.error((err as Error).message); }
  }

  async function handleDeleteCourse() {
    if (!confirm("Delete this course? This cannot be undone.")) return;
    try {
      await teacher.deleteCourse(id);
      router.push("/teacher/courses");
    } catch (err) { toast.error((err as Error).message); }
  }

  async function handleDeleteDocument(docId: string) {
    if (!confirm("Delete this document?")) return;
    try {
      await teacher.deleteDocument(id, docId);
      reloadDocuments();
    } catch (err) { toast.error((err as Error).message); }
  }

  function copyJoinCode(code: string) {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 1500);
  }

  if (loading) return <div className="py-12 text-center text-text-muted">Loading...</div>;
  if (!course) return <div className="py-12 text-center text-text-muted">Course not found</div>;

  const tabs: { key: Tab; label: string }[] = [
    { key: "sections", label: "Sections" },
    { key: "documents", label: "Documents" },
    { key: "settings", label: "Settings" },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.push("/teacher/courses")} className="text-text-muted hover:text-primary">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-text-primary">{course.name}</h1>
          <p className="text-sm capitalize text-text-muted">{course.subject}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-6 flex gap-1 border-b border-border-light">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setSectionDetail(null); }}
            className={`px-4 py-2.5 text-sm font-semibold transition-colors ${
              tab === t.key
                ? "border-b-2 border-primary text-primary"
                : "text-text-muted hover:text-text-secondary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {/* Sections tab */}
        {tab === "sections" && (
          <div>
            {/* Create section */}
            <form onSubmit={handleCreateSection} className="flex gap-2">
              <input
                type="text"
                value={newSectionName}
                onChange={(e) => setNewSectionName(e.target.value)}
                placeholder="New section name (e.g. Period 1)"
                required
                className="flex-1 rounded-[--radius-sm] border border-border bg-input-bg px-3.5 py-2.5 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-primary"
              />
              <Button type="submit" gradient>Add Section</Button>
            </form>

            {/* Section list */}
            <div className="mt-4 space-y-2">
              {sections.map((s) => (
                <div
                  key={s.id}
                  className={`rounded-[--radius-lg] border bg-surface p-4 transition-colors ${
                    sectionDetail?.id === s.id ? "border-primary" : "border-border-light"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <button onClick={() => handleViewSection(s.id)} className="text-left">
                      <div className="font-semibold text-text-primary">{s.name}</div>
                      <div className="text-xs text-text-muted">
                        {s.student_count} student{s.student_count !== 1 ? "s" : ""}
                        {s.join_code && ` · Code: ${s.join_code}`}
                      </div>
                    </button>
                    <div className="flex gap-1.5">
                      {s.join_code ? (
                        <button
                          onClick={() => copyJoinCode(s.join_code!)}
                          className="rounded-[--radius-sm] border border-border px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary-bg"
                        >
                          {copiedCode === s.join_code ? "Copied!" : "Copy Code"}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleGenerateCode(s.id)}
                          className="rounded-[--radius-sm] border border-border px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary-bg"
                        >
                          Generate Code
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteSection(s.id)}
                        className="rounded-[--radius-sm] border border-border px-2.5 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {/* Section detail (roster) */}
                  {sectionDetail?.id === s.id && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      className="mt-4 border-t border-border-light pt-4"
                    >
                      <form onSubmit={handleAddStudent} className="flex gap-2">
                        <input
                          type="email"
                          value={addStudentEmail}
                          onChange={(e) => setAddStudentEmail(e.target.value)}
                          placeholder="Add student by email"
                          required
                          className="flex-1 rounded-[--radius-sm] border border-border bg-input-bg px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-primary"
                        />
                        <Button type="submit" size="sm">Add</Button>
                      </form>
                      {sectionDetail.students.length > 0 ? (
                        <div className="mt-3 space-y-1">
                          {sectionDetail.students.map((st) => (
                            <div key={st.id} className="flex items-center justify-between rounded-[--radius-sm] px-2 py-1.5 text-sm hover:bg-primary-bg/30">
                              <div>
                                <span className="font-medium text-text-primary">{st.name || "—"}</span>
                                <span className="ml-2 text-text-muted">{st.email}</span>
                              </div>
                              <button
                                onClick={() => handleRemoveStudent(st.id)}
                                className="text-xs font-medium text-red-500 hover:underline"
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-sm text-text-muted">No students enrolled yet.</p>
                      )}
                    </motion.div>
                  )}
                </div>
              ))}
              {sections.length === 0 && (
                <p className="py-8 text-center text-sm text-text-muted">No sections yet. Create one above.</p>
              )}
            </div>
          </div>
        )}

        {/* Documents tab */}
        {tab === "documents" && (
          <div>
            {documents.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm text-text-muted">No documents yet.</p>
                <p className="mt-1 text-xs text-text-muted">Document upload coming soon.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {documents.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between rounded-[--radius-lg] border border-border-light bg-surface p-4">
                    <div>
                      <div className="font-medium text-text-primary">{doc.filename}</div>
                      <div className="text-xs text-text-muted">
                        {doc.file_type} · {(doc.file_size / 1024).toFixed(0)} KB
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteDocument(doc.id)}
                      className="text-xs font-semibold text-red-500 hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Settings tab */}
        {tab === "settings" && (
          <div className="space-y-8">
            <form onSubmit={handleUpdateCourse} className="space-y-4">
              <h2 className="text-lg font-bold text-text-primary">Course Details</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-[13px] font-semibold text-text-secondary">Course Name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    required
                    className="mt-1 w-full rounded-[--radius-sm] border border-border bg-input-bg px-3.5 py-2.5 text-sm text-text-primary outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="text-[13px] font-semibold text-text-secondary">Subject</label>
                  <select
                    value={editSubject}
                    onChange={(e) => setEditSubject(e.target.value)}
                    className="mt-1 w-full rounded-[--radius-sm] border border-border bg-input-bg px-3.5 py-2.5 text-sm text-text-primary outline-none focus:border-primary"
                  >
                    <option value="math">Math</option>
                    <option value="physics">Physics</option>
                    <option value="chemistry">Chemistry</option>
                  </select>
                </div>
              </div>
              <Button type="submit" gradient>Save Changes</Button>
            </form>

            <div className="border-t border-border-light pt-6">
              <h2 className="text-lg font-bold text-red-500">Danger Zone</h2>
              <p className="mt-1 text-sm text-text-muted">
                Deleting a course removes all sections, documents, and student enrollments. This cannot be undone.
              </p>
              <button
                onClick={handleDeleteCourse}
                className="mt-4 rounded-[--radius-sm] border border-red-200 px-4 py-2 text-sm font-semibold text-red-500 transition-colors hover:bg-red-50 dark:border-red-500/20 dark:hover:bg-red-500/10"
              >
                Delete Course
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
