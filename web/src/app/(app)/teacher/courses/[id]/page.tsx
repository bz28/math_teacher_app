"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { teacher, type TeacherCourse, type TeacherSection, type TeacherSectionDetail, type TeacherDocument } from "@/lib/api";
import { Button, useToast } from "@/components/ui";
import { MaterialsTab } from "@/components/teacher/materials-tab";
import { SectionMaterials, type VisibilityState } from "@/components/teacher/section-materials";
import { MOCK_ASSIGNMENTS, type MockAssignment } from "@/components/teacher/assignments-data";
import { GradingView } from "@/components/teacher/grading-view";

// Mock units/docs for visibility (same seed as materials-tab — shared reference)
const MOCK_UNITS = [
  { id: "u1", name: "Unit 1: Linear Equations", position: 0 },
  { id: "u2", name: "Unit 2: Systems of Equations", position: 1 },
  { id: "u3", name: "Unit 3: Quadratic Equations", position: 2 },
];
const MOCK_DOCS = [
  { id: "d1", filename: "Chapter 1 Notes.pdf", file_type: "application/pdf", file_size: 2_350_000, unit_id: "u1" },
  { id: "d2", filename: "Practice Problems Set A.pdf", file_type: "application/pdf", file_size: 1_100_000, unit_id: "u1" },
  { id: "d3", filename: "Answer Key.pdf", file_type: "application/pdf", file_size: 820_000, unit_id: "u1" },
  { id: "d4", filename: "Systems Overview.pdf", file_type: "application/pdf", file_size: 1_500_000, unit_id: "u2" },
  { id: "d5", filename: "Substitution Method HW.pdf", file_type: "application/pdf", file_size: 670_000, unit_id: "u2" },
  { id: "d6", filename: "Syllabus.pdf", file_type: "application/pdf", file_size: 120_000, unit_id: null },
  { id: "d7", filename: "Grading Rubric.pdf", file_type: "application/pdf", file_size: 85_000, unit_id: null },
];

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
  const [editGradeLevel, setEditGradeLevel] = useState<number | "">("");

  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [sectionSubTab, setSectionSubTab] = useState<"students" | "materials">("students");
  const [gradingAssignment, setGradingAssignment] = useState<MockAssignment | null>(null);

  // Visibility state (mock — shared between Sections and Materials tabs)
  const [visibility, setVisibility] = useState<VisibilityState>({
    hiddenUnits: {},
    hiddenDocs: {},
  });

  function handleToggleUnit(sectionId: string, unitId: string) {
    setVisibility((prev) => {
      const next = { ...prev, hiddenUnits: { ...prev.hiddenUnits } };
      const set = new Set(next.hiddenUnits[sectionId] ?? []);
      if (set.has(unitId)) set.delete(unitId);
      else set.add(unitId);
      next.hiddenUnits[sectionId] = set;
      return next;
    });
  }

  function handleToggleDoc(sectionId: string, docId: string) {
    setVisibility((prev) => {
      const next = { ...prev, hiddenDocs: { ...prev.hiddenDocs } };
      const set = new Set(next.hiddenDocs[sectionId] ?? []);
      if (set.has(docId)) set.delete(docId);
      else set.add(docId);
      next.hiddenDocs[sectionId] = set;
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;
    teacher.course(id).then((c) => {
      if (cancelled) return;
      setCourse(c);
      setEditName(c.name);
      setEditSubject(c.subject);
      setEditGradeLevel(c.grade_level ?? "");
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
      await teacher.updateCourse(id, {
        name: editName.trim(),
        subject: editSubject,
        ...(editGradeLevel !== "" && { grade_level: Number(editGradeLevel) }),
      });
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
          <p className="text-sm text-text-muted">
            <span className="capitalize">{course.subject}</span>
            {course.grade_level && <span> · Grade {course.grade_level}</span>}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-6 flex gap-1 overflow-x-auto border-b border-border-light">
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

                  {/* Section detail (roster + materials visibility) */}
                  {sectionDetail?.id === s.id && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      className="mt-4 border-t border-border-light pt-4"
                    >
                      {/* Sub-tabs: Students | Materials */}
                      <div className="mb-4 flex gap-1 border-b border-border-light">
                        <button
                          onClick={() => setSectionSubTab("students")}
                          className={`px-3 py-2 text-xs font-semibold transition-colors ${
                            sectionSubTab === "students"
                              ? "border-b-2 border-primary text-primary"
                              : "text-text-muted hover:text-text-secondary"
                          }`}
                        >
                          Students
                        </button>
                        <button
                          onClick={() => setSectionSubTab("materials")}
                          className={`px-3 py-2 text-xs font-semibold transition-colors ${
                            sectionSubTab === "materials"
                              ? "border-b-2 border-primary text-primary"
                              : "text-text-muted hover:text-text-secondary"
                          }`}
                        >
                          Materials
                        </button>
                      </div>

                      {sectionSubTab === "students" && (
                        <>
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
                        </>
                      )}

                      {sectionSubTab === "materials" && (
                        <SectionMaterials
                          sectionId={s.id}
                          sectionName={s.name}
                          units={MOCK_UNITS}
                          documents={MOCK_DOCS}
                          visibility={visibility}
                          onToggleUnit={handleToggleUnit}
                          onToggleDoc={handleToggleDoc}
                        />
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
          <MaterialsTab
            courseId={id}
            sections={sections.map((s) => ({ id: s.id, name: s.name }))}
            visibility={visibility}
            onToggleUnit={handleToggleUnit}
            onToggleDoc={handleToggleDoc}
          />
        )}

        {/* Assignments tab */}
        {tab === "assignments" && (
          gradingAssignment ? (
            <GradingView assignment={gradingAssignment} onBack={() => setGradingAssignment(null)} />
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-text-primary">Assignments</h2>
              </div>
              <div className="rounded-[--radius-md] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400">
                Preview mode — showing sample assignments for this course.
              </div>
              {(() => {
                // Mock: show Algebra I assignments for any course (real backend would filter by actual course ID)
                const courseAssignments = MOCK_ASSIGNMENTS.filter((a) => a.courseName === course?.name || a.courseId === "c1");
                if (courseAssignments.length === 0) {
                  return (
                    <div className="rounded-[--radius-xl] border border-dashed border-border bg-surface p-10 text-center">
                      <p className="text-sm font-semibold text-text-primary">No assignments yet</p>
                      <p className="mt-1 text-xs text-text-muted">Create assignments from the Assignments page.</p>
                    </div>
                  );
                }
                return courseAssignments.map((a) => {
                  const progressPct = a.totalStudents > 0 ? Math.round((a.submitted / a.totalStudents) * 100) : 0;
                  const pending = a.submitted - a.graded;
                  const typeIcon = a.type === "test" || a.type === "quiz" ? "📋" : "📝";
                  const statusColors: Record<string, string> = {
                    draft: "bg-gray-100 text-gray-600 dark:bg-gray-500/10",
                    published: "bg-blue-50 text-blue-600 dark:bg-blue-500/10",
                    grading: "bg-amber-50 text-amber-600 dark:bg-amber-500/10",
                    completed: "bg-green-50 text-green-600 dark:bg-green-500/10",
                    scheduled: "bg-purple-50 text-purple-600 dark:bg-purple-500/10",
                  };
                  return (
                    <div
                      key={a.id}
                      onClick={() => setGradingAssignment(a)}
                      className="cursor-pointer rounded-[--radius-lg] border border-border-light bg-surface p-4 transition-colors hover:border-primary/30"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span>{typeIcon}</span>
                          <span className="text-sm font-bold text-text-primary">{a.title}</span>
                        </div>
                        <span className={`rounded-[--radius-pill] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusColors[a.status] ?? ""}`}>
                          {a.status}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-text-muted">
                        {a.sectionNames.join(", ")} · {a.type}{a.dueAt ? ` · Due ${a.dueAt}` : ""}
                      </div>
                      {a.status !== "scheduled" && a.status !== "draft" && (
                        <div className="mt-2">
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${progressPct}%` }} />
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-text-muted">
                            <span>{a.submitted}/{a.totalStudents} submitted</span>
                            <span>{a.graded} graded</span>
                            {pending > 0 && <span className="font-semibold text-amber-600">{pending} pending</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          )
        )}

        {/* Settings tab */}
        {tab === "settings" && (
          <div className="space-y-8">
            <form onSubmit={handleUpdateCourse} className="space-y-4">
              <h2 className="text-lg font-bold text-text-primary">Course Details</h2>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="sm:col-span-1">
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
                <div>
                  <label className="text-[13px] font-semibold text-text-secondary">Grade Level</label>
                  <select
                    value={editGradeLevel}
                    onChange={(e) => setEditGradeLevel(e.target.value === "" ? "" : Number(e.target.value))}
                    className="mt-1 w-full rounded-[--radius-sm] border border-border bg-input-bg px-3.5 py-2.5 text-sm text-text-primary outline-none focus:border-primary"
                  >
                    <option value="">Not set</option>
                    {[6, 7, 8, 9, 10, 11, 12].map((g) => (
                      <option key={g} value={g}>Grade {g}</option>
                    ))}
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
