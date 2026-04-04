"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { teacher } from "@/lib/api";

type AssignmentType = "homework" | "quiz" | "test";
type ContentSource = "ai_generate" | "library";
type Step = 1 | 2 | 3;

interface CreateAssignmentModalProps {
  onClose: () => void;
  onCreated: () => void;
  preselectedCourseId?: string;
}

interface UnitWithFiles {
  id: string;
  name: string;
  files: { id: string; name: string }[];
}

export function CreateAssignmentModal({ onClose, onCreated, preselectedCourseId }: CreateAssignmentModalProps) {
  const [step, setStep] = useState<Step>(1);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Course picker
  const [courses, setCourses] = useState<{ id: string; name: string }[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState(preselectedCourseId ?? "");
  const [courseSections, setCourseSections] = useState<{ id: string; name: string; student_count: number }[]>([]);
  const [courseUnits, setCourseUnits] = useState<UnitWithFiles[]>([]);

  // Step 1
  const [type, setType] = useState<AssignmentType | null>(null);
  const [title, setTitle] = useState("");

  // Step 2
  const [source, setSource] = useState<ContentSource | null>(null);
  const [aiUnit, setAiUnit] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [aiDifficulty, setAiDifficulty] = useState("medium");
  const [aiQuestionCount, setAiQuestionCount] = useState("10");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiPhase, setAiPhase] = useState<"config" | "questions" | "generating_solutions" | "solutions">("config");
  const [questions, setQuestions] = useState<{ id: number; text: string; difficulty: string }[]>([]);
  const [solutions, setSolutions] = useState<{ questionId: number; text: string }[]>([]);
  const [editingQ, setEditingQ] = useState<number | null>(null);
  const [editingS, setEditingS] = useState<number | null>(null);

  // Step 3
  const [selectedSections, setSelectedSections] = useState<Set<string>>(new Set());
  const [dueDate, setDueDate] = useState("");
  const [latePolicy, setLatePolicy] = useState("none");

  // Fetch courses on mount
  useEffect(() => {
    teacher.courses().then((d) => setCourses(d.courses.map((c) => ({ id: c.id, name: c.name }))));
  }, []);

  // Fetch sections + units when course changes
  useEffect(() => {
    if (!selectedCourseId) return;
    let cancelled = false;
    teacher.sections(selectedCourseId).then((d) => { if (!cancelled) setCourseSections(d.sections); });
    Promise.all([
      teacher.units(selectedCourseId),
      teacher.documents(selectedCourseId),
    ]).then(([unitsRes, docsRes]) => {
      if (cancelled) return;
      setCourseUnits(unitsRes.units.map((u) => ({
        id: u.id, name: u.name,
        files: docsRes.documents.filter((d) => d.unit_id === u.id).map((d) => ({ id: d.id, name: d.filename })),
      })));
    });
    return () => { cancelled = true; };
  }, [selectedCourseId]);

  const selectedUnitData = courseUnits.find((u) => u.name === aiUnit);

  function toggleFile(id: string) {
    setSelectedFiles((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleSection(id: string) {
    setSelectedSections((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  // AI Generate (still fake)
  const SAMPLE_Q = ["Solve: 2x + 5 = 13","Factor: x² - 9","Simplify: 3(2x - 4) + 7","Find x: 4x/3 = 8","Graph: y = 2x + 1","Solve: x + y = 7, x - y = 3","Expand: (x + 3)²","Slope through (2,5) and (4,11)","Solve: |2x - 1| = 5","Simplify: √48 + √27"];
  const SAMPLE_S = ["2x=8 → x=4","(x+3)(x-3)","6x - 5","x = 6","slope=2, y-int=1","x=5, y=2","x²+6x+9","slope=3","x=3 or x=-2","7√3"];

  function handleGenerate() {
    setAiGenerating(true);
    setTimeout(() => {
      const count = Math.min(Number(aiQuestionCount), 10);
      setQuestions(Array.from({ length: count }, (_, i) => ({ id: i, text: SAMPLE_Q[i % 10], difficulty: aiDifficulty === "mixed" ? ["easy","medium","hard"][i%3] : aiDifficulty })));
      setAiGenerating(false);
      setAiPhase("questions");
    }, 2000);
  }

  function handleConfirmQuestions() {
    setAiPhase("generating_solutions");
    setTimeout(() => {
      setSolutions(questions.map((q) => ({ questionId: q.id, text: SAMPLE_S[q.id % 10] })));
      setAiPhase("solutions");
    }, 1500);
  }

  // Real API create
  async function handleCreate() {
    if (!selectedCourseId || !type || !title.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const content = questions.length > 0 ? { questions: questions.map((q) => ({ text: q.text, difficulty: q.difficulty })) } : undefined;
      const answerKey = solutions.length > 0 ? { solutions: solutions.map((s) => ({ question_id: s.questionId, text: s.text })) } : undefined;
      const documentIds = source === "library" && selectedFiles.size > 0 ? Array.from(selectedFiles) : undefined;

      const res = await teacher.createAssignment(selectedCourseId, {
        title: title.trim(), type, source_type: source ?? undefined,
        due_at: dueDate || undefined, late_policy: latePolicy,
        content, answer_key: answerKey, document_ids: documentIds,
      });

      const sectionIds = Array.from(selectedSections);
      if (sectionIds.length > 0) await teacher.assignToSections(res.id, sectionIds);

      onCreated();
    } catch (err) {
      setError((err as Error).message || "Failed to create assignment");
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="mx-4 w-full max-w-lg rounded-[--radius-xl] border border-border-light bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-light px-6 py-4">
          <div>
            <h3 className="text-lg font-bold text-text-primary">New Assignment</h3>
            <div className="mt-1 flex items-center gap-2">
              {[1,2,3].map((s) => (
                <div key={s} className="flex items-center gap-1.5">
                  <div className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${step >= s ? "bg-primary text-white" : "bg-border text-text-muted"}`}>{s}</div>
                  <span className={`text-[11px] font-medium ${step >= s ? "text-text-primary" : "text-text-muted"}`}>{s === 1 ? "Type" : s === 2 ? "Content" : "Assign"}</span>
                  {s < 3 && <div className={`h-px w-4 ${step > s ? "bg-primary" : "bg-border"}`} />}
                </div>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-4 rounded-[--radius-md] border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">{error}</div>
        )}

        <div className="max-h-[60vh] overflow-y-auto px-6 py-5">
          {/* Step 1 */}
          {step === 1 && (
            <div className="space-y-4">
              {!preselectedCourseId && (
                <div>
                  <label className="text-[13px] font-semibold text-text-secondary">Course</label>
                  <select value={selectedCourseId} onChange={(e) => { setSelectedCourseId(e.target.value); setCourseSections([]); setCourseUnits([]); setSelectedSections(new Set()); }}
                    className="mt-1 w-full rounded-[--radius-sm] border border-border bg-input-bg px-3.5 py-2.5 text-sm text-text-primary outline-none focus:border-primary">
                    <option value="">Select a course...</option>
                    {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="text-[13px] font-semibold text-text-secondary">Title</label>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. HW #5 — Quadratic Equations"
                  className="mt-1 w-full rounded-[--radius-sm] border border-border bg-input-bg px-3.5 py-2.5 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-primary" />
              </div>
              <div>
                <label className="text-[13px] font-semibold text-text-secondary">Type</label>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(["homework","quiz","test"] as const).map((t) => (
                    <button key={t} onClick={() => setType(t)}
                      className={`flex flex-col items-center gap-1.5 rounded-[--radius-lg] border-2 p-4 transition-colors ${type === t ? "border-primary bg-primary-bg/30" : "border-border-light hover:border-primary/30"}`}>
                      <span className="text-xl">{t === "homework" ? "📝" : "📋"}</span>
                      <span className="text-xs font-semibold capitalize text-text-primary">{t}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <div className="space-y-4">
              {!source ? (
                <div className="grid gap-2">
                  {([
                    { id: "ai_generate" as const, icon: "🤖", title: "AI Generate", desc: "AI creates problems from your materials" },
                    { id: "library" as const, icon: "📚", title: "From Library", desc: "Pick from uploaded docs" },
                  ]).map((opt) => (
                    <button key={opt.id} onClick={() => setSource(opt.id)}
                      className="flex items-center gap-3 rounded-[--radius-lg] border-2 border-border-light p-4 text-left hover:border-primary/30">
                      <span className="text-2xl">{opt.icon}</span>
                      <div><div className="text-sm font-semibold text-text-primary">{opt.title}</div><div className="text-xs text-text-muted">{opt.desc}</div></div>
                    </button>
                  ))}
                </div>
              ) : source === "ai_generate" ? (
                <div>
                  <button onClick={() => { setSource(null); setAiPhase("config"); setQuestions([]); setSolutions([]); }} className="mb-3 text-xs font-semibold text-primary hover:underline">← Back</button>
                  {aiPhase === "config" && (
                    <div className="space-y-3">
                      <div>
                        <label className="text-[13px] font-semibold text-text-secondary">Based on unit</label>
                        <select value={aiUnit} onChange={(e) => { setAiUnit(e.target.value); setSelectedFiles(new Set()); }}
                          className="mt-1 w-full rounded-[--radius-sm] border border-border bg-input-bg px-3 py-2 text-sm text-text-primary outline-none focus:border-primary">
                          <option value="">Select a unit...</option>
                          {courseUnits.map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
                        </select>
                      </div>
                      {selectedUnitData && selectedUnitData.files.length > 0 && (
                        <div>
                          <label className="text-[13px] font-semibold text-text-secondary">Use these files</label>
                          <div className="mt-1.5 space-y-1">
                            {selectedUnitData.files.map((f) => (
                              <button key={f.id} onClick={() => toggleFile(f.id)}
                                className={`flex w-full items-center gap-2 rounded-[--radius-sm] border px-3 py-2 text-left text-xs ${selectedFiles.has(f.id) ? "border-primary bg-primary-bg/20 text-text-primary" : "border-border-light text-text-muted hover:border-primary/30"}`}>
                                <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border ${selectedFiles.has(f.id) ? "border-primary bg-primary" : "border-border"}`}>
                                  {selectedFiles.has(f.id) && <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>}
                                </div>
                                📄 {f.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[13px] font-semibold text-text-secondary">Difficulty</label>
                          <select value={aiDifficulty} onChange={(e) => setAiDifficulty(e.target.value)} className="mt-1 w-full rounded-[--radius-sm] border border-border bg-input-bg px-3 py-2 text-sm text-text-primary outline-none focus:border-primary">
                            <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option><option value="mixed">Mixed</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[13px] font-semibold text-text-secondary">Questions</label>
                          <input type="number" value={aiQuestionCount} onChange={(e) => setAiQuestionCount(e.target.value)} min={1} max={50} className="mt-1 w-full rounded-[--radius-sm] border border-border bg-input-bg px-3 py-2 text-sm text-text-primary outline-none focus:border-primary" />
                        </div>
                      </div>
                      <button onClick={handleGenerate} disabled={!aiUnit || aiGenerating} className="w-full rounded-[--radius-sm] bg-primary px-4 py-2.5 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed">
                        {aiGenerating ? "Generating..." : "Generate Questions"}
                      </button>
                    </div>
                  )}
                  {aiPhase === "questions" && (
                    <div className="space-y-3">
                      <div className="max-h-64 space-y-2 overflow-y-auto">
                        {questions.map((q) => (
                          <div key={q.id} className="rounded-[--radius-sm] border border-border-light bg-surface p-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-text-primary">Q{q.id+1}</span>
                              <button onClick={() => setEditingQ(editingQ === q.id ? null : q.id)} className="text-[10px] font-semibold text-primary hover:underline">{editingQ === q.id ? "Done" : "Edit"}</button>
                            </div>
                            {editingQ === q.id ? <textarea value={q.text} onChange={(e) => setQuestions(questions.map((qq) => qq.id === q.id ? {...qq,text:e.target.value} : qq))} className="mt-1 w-full rounded-[--radius-sm] border border-primary bg-input-bg px-2 py-1.5 text-xs text-text-primary outline-none" rows={2} autoFocus /> : <p className="mt-1 text-xs text-text-secondary">{q.text}</p>}
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center justify-between">
                        <button onClick={() => { setAiPhase("config"); setQuestions([]); }} className="text-xs font-semibold text-primary hover:underline">Regenerate</button>
                        <button onClick={handleConfirmQuestions} className="rounded-[--radius-sm] bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-dark">Confirm & Generate Solutions</button>
                      </div>
                    </div>
                  )}
                  {aiPhase === "generating_solutions" && <div className="py-10 text-center text-sm text-text-muted">Generating answer key...</div>}
                  {aiPhase === "solutions" && (
                    <div className="space-y-3">
                      <div className="max-h-64 space-y-2 overflow-y-auto">
                        {questions.map((q) => {
                          const sol = solutions.find((s) => s.questionId === q.id);
                          return (
                            <div key={q.id} className="rounded-[--radius-sm] border border-border-light bg-surface p-3">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-text-primary">Q{q.id+1}: {q.text}</span>
                                <button onClick={() => setEditingS(editingS === q.id ? null : q.id)} className="text-[10px] font-semibold text-primary hover:underline">{editingS === q.id ? "Done" : "Edit"}</button>
                              </div>
                              {editingS === q.id ? <textarea value={sol?.text ?? ""} onChange={(e) => setSolutions(solutions.map((s) => s.questionId === q.id ? {...s,text:e.target.value} : s))} className="mt-2 w-full rounded-[--radius-sm] border border-primary bg-input-bg px-2 py-1.5 text-xs text-text-primary outline-none" rows={2} autoFocus /> : <div className="mt-2 rounded-[--radius-sm] bg-green-50/50 px-2 py-1.5 text-xs text-green-700 dark:bg-green-500/5 dark:text-green-400"><b>Solution:</b> {sol?.text}</div>}
                            </div>
                          );
                        })}
                      </div>
                      <button onClick={() => setAiPhase("questions")} className="text-xs font-semibold text-primary hover:underline">← Back to questions</button>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <button onClick={() => setSource(null)} className="mb-3 text-xs font-semibold text-primary hover:underline">← Back</button>
                  {courseUnits.filter((u) => u.files.length > 0).length === 0 ? (
                    <div className="flex flex-col items-center rounded-[--radius-lg] border-2 border-dashed border-border py-10">
                      <span className="text-2xl">📚</span>
                      <p className="mt-2 text-sm text-text-secondary">No documents yet</p>
                      <p className="mt-1 text-xs text-text-muted">Upload files in the Materials tab first.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {courseUnits.filter((u) => u.files.length > 0).map((u) => (
                        <div key={u.id} className="rounded-[--radius-md] border border-border-light bg-surface p-3">
                          <div className="text-xs font-semibold text-text-primary">{u.name}</div>
                          <div className="mt-2 space-y-1">
                            {u.files.map((f) => (
                              <button key={f.id} onClick={() => toggleFile(f.id)}
                                className={`flex w-full items-center gap-2 rounded-[--radius-sm] px-2 py-1.5 text-left text-xs ${selectedFiles.has(f.id) ? "bg-primary-bg/30 text-text-primary" : "text-text-muted hover:bg-primary-bg/20"}`}>
                                <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border ${selectedFiles.has(f.id) ? "border-primary bg-primary" : "border-border"}`}>
                                  {selectedFiles.has(f.id) && <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>}
                                </div>
                                📄 {f.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 3 */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label className="text-[13px] font-semibold text-text-secondary">Assign to sections</label>
                {courseSections.length === 0 ? (
                  <p className="mt-2 text-xs text-text-muted">No sections in this course yet.</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {courseSections.map((sec) => (
                      <button key={sec.id} onClick={() => toggleSection(sec.id)}
                        className={`flex w-full items-center justify-between rounded-[--radius-md] border-2 p-3 ${selectedSections.has(sec.id) ? "border-primary bg-primary-bg/20" : "border-border-light hover:border-primary/30"}`}>
                        <div className="flex items-center gap-2">
                          <div className={`flex h-5 w-5 items-center justify-center rounded-[--radius-sm] border-2 ${selectedSections.has(sec.id) ? "border-primary bg-primary" : "border-border"}`}>
                            {selectedSections.has(sec.id) && <svg className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>}
                          </div>
                          <span className="text-sm font-medium text-text-primary">{sec.name}</span>
                        </div>
                        <span className="text-xs text-text-muted">{sec.student_count} students</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[13px] font-semibold text-text-secondary">Due date</label>
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1 w-full rounded-[--radius-sm] border border-border bg-input-bg px-3 py-2 text-sm text-text-primary outline-none focus:border-primary" />
                </div>
                <div>
                  <label className="text-[13px] font-semibold text-text-secondary">Late policy</label>
                  <select value={latePolicy} onChange={(e) => setLatePolicy(e.target.value)} className="mt-1 w-full rounded-[--radius-sm] border border-border bg-input-bg px-3 py-2 text-sm text-text-primary outline-none focus:border-primary">
                    <option value="none">No late submissions</option><option value="deduct_10_per_day">-10% per day</option><option value="no_late">Accept late</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border-light px-6 py-4">
          <button onClick={() => step > 1 ? setStep((step-1) as Step) : onClose()} className="rounded-[--radius-sm] border border-border px-4 py-2 text-xs font-semibold text-text-muted hover:bg-primary-bg/50">
            {step === 1 ? "Cancel" : "Back"}
          </button>
          {step < 3 ? (
            <button onClick={() => setStep((step+1) as Step)} disabled={step === 1 ? (!selectedCourseId || !type || !title.trim()) : !source || (source === "ai_generate" && aiPhase !== "solutions") || (source === "library" && selectedFiles.size === 0)}
              className="rounded-[--radius-sm] bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed">Next</button>
          ) : (
            <button onClick={handleCreate} disabled={creating || selectedSections.size === 0}
              className="rounded-[--radius-sm] bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed">
              {creating ? "Creating..." : "Create Assignment"}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
