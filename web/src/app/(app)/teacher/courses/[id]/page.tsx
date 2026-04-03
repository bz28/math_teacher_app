"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { teacher, type TeacherCourse, type TeacherSection, type TeacherSectionDetail, type TeacherDocument } from "@/lib/api";
import { Button, useToast } from "@/components/ui";

type Tab = "overview" | "sections" | "materials" | "assignments" | "settings";

export default function CourseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();

  const [course, setCourse] = useState<TeacherCourse | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
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
    if (tab === "overview" || tab === "sections") {
      teacher.sections(id).then((d) => setSections(d.sections)).catch(() => {});
    }
    if (tab === "overview" || tab === "materials") {
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

  const totalStudents = sections.reduce((sum, s) => sum + s.student_count, 0);

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "sections", label: "Sections" },
    { key: "materials", label: "Materials" },
    { key: "assignments", label: "Assignments" },
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
        {/* Overview tab */}
        {tab === "overview" && (
          <div className="space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-[--radius-lg] border border-border-light bg-surface p-4 text-center">
                <div className="text-2xl font-extrabold text-text-primary">{sections.length}</div>
                <div className="mt-0.5 text-xs font-medium text-text-muted">Sections</div>
              </div>
              <div className="rounded-[--radius-lg] border border-border-light bg-surface p-4 text-center">
                <div className="text-2xl font-extrabold text-text-primary">{totalStudents}</div>
                <div className="mt-0.5 text-xs font-medium text-text-muted">Students</div>
              </div>
              <div className="rounded-[--radius-lg] border border-border-light bg-surface p-4 text-center">
                <div className="text-2xl font-extrabold text-text-primary">{documents.length}</div>
                <div className="mt-0.5 text-xs font-medium text-text-muted">Documents</div>
              </div>
            </div>

            {/* Sections summary */}
            {sections.length > 0 && (
              <div>
                <h2 className="text-base font-bold text-text-primary">Sections</h2>
                <div className="mt-3 space-y-2">
                  {sections.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between rounded-[--radius-lg] border border-border-light bg-surface px-4 py-3"
                    >
                      <div>
                        <span className="font-semibold text-text-primary">{s.name}</span>
                        <span className="ml-2 text-xs text-text-muted">
                          {s.student_count} student{s.student_count !== 1 ? "s" : ""}
                        </span>
                      </div>
                      {s.join_code ? (
                        <button
                          onClick={() => copyJoinCode(s.join_code!)}
                          className="rounded-[--radius-sm] border border-border px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary-bg"
                        >
                          {copiedCode === s.join_code ? "Copied!" : `Code: ${s.join_code}`}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleGenerateCode(s.id)}
                          className="rounded-[--radius-sm] border border-border px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary-bg"
                        >
                          Generate Code
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {sections.length === 0 && (
              <div className="rounded-[--radius-xl] border border-dashed border-border bg-surface p-8 text-center">
                <p className="text-sm font-semibold text-text-primary">No sections yet</p>
                <p className="mt-1 text-xs text-text-muted">
                  Go to the Sections tab to create your first class period.
                </p>
                <button
                  onClick={() => setTab("sections")}
                  className="mt-3 text-sm font-semibold text-primary hover:text-primary-dark"
                >
                  Create Section &rarr;
                </button>
              </div>
            )}

            {/* Recent documents */}
            {documents.length > 0 && (
              <div>
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-text-primary">Recent Documents</h2>
                  {documents.length > 3 && (
                    <button
                      onClick={() => setTab("materials")}
                      className="text-sm font-semibold text-primary hover:text-primary-dark"
                    >
                      View all ({documents.length})
                    </button>
                  )}
                </div>
                <div className="mt-3 space-y-2">
                  {documents.slice(0, 3).map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between rounded-[--radius-lg] border border-border-light bg-surface px-4 py-3"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-text-muted">
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                            <path d="M14 2v6h6" />
                          </svg>
                        </span>
                        <span className="text-sm font-medium text-text-primary">{doc.filename}</span>
                      </div>
                      <span className="text-xs text-text-muted">
                        {doc.file_size >= 1048576
                          ? `${(doc.file_size / 1048576).toFixed(1)} MB`
                          : `${(doc.file_size / 1024).toFixed(0)} KB`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

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

        {/* Materials tab */}
        {tab === "materials" && (
          <div className="space-y-5">
            {/* Coming soon banners */}
            <div className="rounded-[--radius-lg] border border-primary/20 bg-primary-bg/30 p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[--radius-md] bg-primary-bg text-primary">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-semibold text-text-primary">Organize by Units — Coming Soon</div>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    Group documents by chapter or topic. AI will help sort your files automatically.
                  </p>
                </div>
                <span className="ml-auto shrink-0 rounded-[--radius-pill] bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:bg-amber-500/10">
                  Soon
                </span>
              </div>
            </div>

            {/* Upload button (disabled) */}
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-text-primary">Documents</h2>
              <button
                disabled
                title="Upload coming soon"
                className="flex items-center gap-1.5 rounded-[--radius-sm] border border-border px-3 py-1.5 text-xs font-semibold text-text-muted opacity-50 cursor-not-allowed"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                </svg>
                Upload
              </button>
            </div>

            {/* Document list */}
            {documents.length === 0 ? (
              <div className="rounded-[--radius-xl] border border-dashed border-border bg-surface p-10 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary-bg/50 text-text-muted">
                  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <path d="M14 2v6h6" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-text-primary">No documents yet</p>
                <p className="mt-1 text-xs text-text-muted">Document upload and unit organization coming soon.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {documents.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between rounded-[--radius-lg] border border-border-light bg-surface p-4">
                    <div className="flex items-center gap-2.5">
                      <span className="text-text-muted">
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                          <path d="M14 2v6h6" />
                        </svg>
                      </span>
                      <div>
                        <div className="text-sm font-medium text-text-primary">{doc.filename}</div>
                        <div className="text-xs text-text-muted">
                          {doc.file_type} · {doc.file_size >= 1048576
                            ? `${(doc.file_size / 1048576).toFixed(1)} MB`
                            : `${(doc.file_size / 1024).toFixed(0)} KB`}
                        </div>
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

        {/* Assignments tab */}
        {tab === "assignments" && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary-bg text-primary">
              <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-text-primary">Assignments — Coming Soon</h3>
            <span className="mt-2 inline-flex items-center rounded-[--radius-pill] bg-amber-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-600 dark:bg-amber-500/10">
              Coming Soon
            </span>
            <p className="mt-3 max-w-sm text-sm text-text-secondary">
              Create homework and tests for your students. Upload worksheets or let AI generate problems from your course materials.
            </p>
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
