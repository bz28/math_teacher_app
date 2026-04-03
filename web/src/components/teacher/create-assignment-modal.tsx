"use client";

import { useState } from "react";
import { motion } from "framer-motion";

type AssignmentType = "homework" | "quiz" | "test";
type ContentSource = "upload" | "ai_generate" | "library";
type Step = 1 | 2 | 3;

interface CreateAssignmentModalProps {
  onClose: () => void;
  onCreated: (assignment: { title: string; type: AssignmentType; source: ContentSource; sections: string[]; dueDate: string }) => void;
}

const MOCK_SECTIONS = [
  { id: "s1", name: "Period 3", studentCount: 32 },
  { id: "s2", name: "Period 5", studentCount: 18 },
  { id: "s3", name: "Block A", studentCount: 25 },
];

const MOCK_UNITS_WITH_FILES = [
  {
    name: "Unit 1: Linear Equations",
    files: [
      { id: "f1", name: "Chapter 1 Notes.pdf" },
      { id: "f2", name: "Practice Problems Set A.pdf" },
      { id: "f3", name: "Answer Key.pdf" },
    ],
  },
  {
    name: "Unit 2: Systems of Equations",
    files: [
      { id: "f4", name: "Systems Overview.pdf" },
      { id: "f5", name: "Substitution Method HW.pdf" },
    ],
  },
  {
    name: "Unit 3: Quadratic Equations",
    files: [],
  },
];

export function CreateAssignmentModal({ onClose, onCreated }: CreateAssignmentModalProps) {
  const [step, setStep] = useState<Step>(1);

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
  const [latePolicy, setLatePolicy] = useState("deduct_10");

  function toggleFile(id: string) {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedUnit = MOCK_UNITS_WITH_FILES.find((u) => u.name === aiUnit);

  function toggleSection(id: string) {
    setSelectedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const SAMPLE_QUESTIONS = [
    "Solve: 2x + 5 = 13",
    "Factor: x² - 9",
    "Simplify: 3(2x - 4) + 7",
    "Find x: 4x/3 = 8",
    "Graph: y = 2x + 1",
    "Solve the system: x + y = 7, x - y = 3",
    "Expand: (x + 3)²",
    "Find the slope of the line through (2,5) and (4,11)",
    "Solve: |2x - 1| = 5",
    "Simplify: √(48) + √(27)",
  ];

  const SAMPLE_SOLUTIONS = [
    "2x + 5 = 13 → 2x = 8 → x = 4",
    "x² - 9 = (x + 3)(x - 3)",
    "3(2x - 4) + 7 = 6x - 12 + 7 = 6x - 5",
    "4x/3 = 8 → 4x = 24 → x = 6",
    "y-intercept at (0,1), slope = 2, passes through (1,3)",
    "Adding equations: 2x = 10 → x = 5, y = 2",
    "(x + 3)² = x² + 6x + 9",
    "Slope = (11 - 5)/(4 - 2) = 6/2 = 3",
    "2x - 1 = 5 → x = 3, or 2x - 1 = -5 → x = -2",
    "√48 = 4√3, √27 = 3√3 → 4√3 + 3√3 = 7√3",
  ];

  function handleGenerate() {
    setAiGenerating(true);
    setTimeout(() => {
      const count = Math.min(Number(aiQuestionCount), 10);
      const qs = Array.from({ length: count }, (_, i) => ({
        id: i,
        text: SAMPLE_QUESTIONS[i % SAMPLE_QUESTIONS.length],
        difficulty: aiDifficulty === "mixed" ? ["easy", "medium", "hard"][i % 3] : aiDifficulty,
      }));
      setQuestions(qs);
      setAiGenerating(false);
      setAiPhase("questions");
    }, 2000);
  }

  function handleConfirmQuestions() {
    setAiPhase("generating_solutions");
    setTimeout(() => {
      const sols = questions.map((q) => ({
        questionId: q.id,
        text: SAMPLE_SOLUTIONS[q.id % SAMPLE_SOLUTIONS.length],
      }));
      setSolutions(sols);
      setAiPhase("solutions");
    }, 1500);
  }

  function handleCreate() {
    onCreated({
      title,
      type: type!,
      source: source!,
      sections: Array.from(selectedSections),
      dueDate,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="mx-4 w-full max-w-lg rounded-[--radius-xl] border border-border-light bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-light px-6 py-4">
          <div>
            <h3 className="text-lg font-bold text-text-primary">New Assignment</h3>
            <div className="mt-1 flex items-center gap-2">
              {[1, 2, 3].map((s) => (
                <div key={s} className="flex items-center gap-1.5">
                  <div className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                    step >= s ? "bg-primary text-white" : "bg-border text-text-muted"
                  }`}>
                    {s}
                  </div>
                  <span className={`text-[11px] font-medium ${step >= s ? "text-text-primary" : "text-text-muted"}`}>
                    {s === 1 ? "Type" : s === 2 ? "Content" : "Assign"}
                  </span>
                  {s < 3 && <div className={`h-px w-4 ${step > s ? "bg-primary" : "bg-border"}`} />}
                </div>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Step content */}
        <div className="px-6 py-5">
          {/* Step 1: Type */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="text-[13px] font-semibold text-text-secondary">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. HW #5 — Quadratic Equations"
                  className="mt-1 w-full rounded-[--radius-sm] border border-border bg-input-bg px-3.5 py-2.5 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-primary"
                />
              </div>
              <div>
                <label className="text-[13px] font-semibold text-text-secondary">Type</label>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {(["homework", "quiz", "test"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setType(t)}
                      className={`flex flex-col items-center gap-1.5 rounded-[--radius-lg] border-2 p-4 transition-colors ${
                        type === t
                          ? "border-primary bg-primary-bg/30"
                          : "border-border-light hover:border-primary/30"
                      }`}
                    >
                      <span className="text-xl">{t === "homework" ? "📝" : t === "quiz" ? "📋" : "📋"}</span>
                      <span className="text-xs font-semibold capitalize text-text-primary">{t}</span>
                      <span className="text-[10px] text-text-muted">
                        {t === "homework" ? "Students submit work" : t === "quiz" ? "Quick check" : "AI generates + variants"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Content */}
          {step === 2 && (
            <div className="space-y-4">
              {!source ? (
                <>
                  <label className="text-[13px] font-semibold text-text-secondary">How do you want to create this?</label>
                  <div className="grid gap-2">
                    {([
                      { id: "upload" as const, icon: "📷", title: "Upload worksheet", desc: "Upload a photo or PDF of your assignment" },
                      { id: "ai_generate" as const, icon: "🤖", title: "AI Generate", desc: "AI creates problems from your course materials" },
                      { id: "library" as const, icon: "📚", title: "From Library", desc: "Pick problems from uploaded documents" },
                    ]).map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => setSource(opt.id)}
                        className="flex items-center gap-3 rounded-[--radius-lg] border-2 border-border-light p-4 text-left transition-colors hover:border-primary/30"
                      >
                        <span className="text-2xl">{opt.icon}</span>
                        <div>
                          <div className="text-sm font-semibold text-text-primary">{opt.title}</div>
                          <div className="text-xs text-text-muted">{opt.desc}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              ) : source === "upload" ? (
                <div>
                  <button onClick={() => setSource(null)} className="mb-3 text-xs font-semibold text-primary hover:underline">← Back to options</button>
                  <div className="flex cursor-pointer flex-col items-center justify-center rounded-[--radius-lg] border-2 border-dashed border-border py-10 transition-colors hover:border-primary hover:bg-primary-bg/20">
                    <span className="text-2xl">📷</span>
                    <p className="mt-2 text-sm font-medium text-text-secondary">Drop files here or click to browse</p>
                    <p className="mt-1 text-xs text-text-muted">PDF, images, or documents</p>
                  </div>
                  <p className="mt-3 text-xs text-text-muted">Upload simulated — files won&apos;t actually upload in preview mode.</p>
                </div>
              ) : source === "ai_generate" ? (
                <div>
                  <button onClick={() => { setSource(null); setAiPhase("config"); setQuestions([]); setSolutions([]); }} className="mb-3 text-xs font-semibold text-primary hover:underline">← Back to options</button>

                  {/* Phase: Config */}
                  {aiPhase === "config" && (
                    <div className="space-y-3">
                      <div>
                        <label className="text-[13px] font-semibold text-text-secondary">Based on unit</label>
                        <select
                          value={aiUnit}
                          onChange={(e) => { setAiUnit(e.target.value); setSelectedFiles(new Set()); }}
                          className="mt-1 w-full rounded-[--radius-sm] border border-border bg-input-bg px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
                        >
                          <option value="">Select a unit...</option>
                          {MOCK_UNITS_WITH_FILES.map((u) => <option key={u.name} value={u.name}>{u.name}</option>)}
                        </select>
                      </div>
                      {selectedUnit && selectedUnit.files.length > 0 && (
                        <div>
                          <label className="text-[13px] font-semibold text-text-secondary">Use these files</label>
                          <div className="mt-1.5 space-y-1">
                            {selectedUnit.files.map((f) => (
                              <button
                                key={f.id}
                                onClick={() => toggleFile(f.id)}
                                className={`flex w-full items-center gap-2 rounded-[--radius-sm] border px-3 py-2 text-left text-xs transition-colors ${
                                  selectedFiles.has(f.id) ? "border-primary bg-primary-bg/20 text-text-primary" : "border-border-light text-text-muted hover:border-primary/30"
                                }`}
                              >
                                <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border ${selectedFiles.has(f.id) ? "border-primary bg-primary" : "border-border"}`}>
                                  {selectedFiles.has(f.id) && <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>}
                                </div>
                                <span>📄 {f.name}</span>
                              </button>
                            ))}
                          </div>
                          <p className="mt-1.5 text-[11px] text-text-muted">
                            {selectedFiles.size === 0 ? "Select files or leave empty to use all." : `${selectedFiles.size} file${selectedFiles.size !== 1 ? "s" : ""} selected`}
                          </p>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[13px] font-semibold text-text-secondary">Difficulty</label>
                          <select value={aiDifficulty} onChange={(e) => setAiDifficulty(e.target.value)} className="mt-1 w-full rounded-[--radius-sm] border border-border bg-input-bg px-3 py-2 text-sm text-text-primary outline-none focus:border-primary">
                            <option value="easy">Easy</option>
                            <option value="medium">Medium</option>
                            <option value="hard">Hard</option>
                            <option value="mixed">Mixed</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[13px] font-semibold text-text-secondary">Questions</label>
                          <input type="number" value={aiQuestionCount} onChange={(e) => setAiQuestionCount(e.target.value)} min={1} max={50} className="mt-1 w-full rounded-[--radius-sm] border border-border bg-input-bg px-3 py-2 text-sm text-text-primary outline-none focus:border-primary" />
                        </div>
                      </div>
                      {type === "test" && (
                        <div className="flex items-center gap-2 text-xs text-text-secondary">
                          <input type="checkbox" defaultChecked className="rounded" />
                          <span>Generate 3 variants (anti-cheating)</span>
                        </div>
                      )}
                      <button
                        onClick={handleGenerate}
                        disabled={!aiUnit || aiGenerating}
                        className="w-full rounded-[--radius-sm] bg-primary px-4 py-2.5 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {aiGenerating ? (
                          <span className="flex items-center justify-center gap-2">
                            <motion.div className="h-3 w-3 rounded-full border-2 border-white/30 border-t-white" animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} />
                            Generating questions...
                          </span>
                        ) : "Generate Questions"}
                      </button>
                    </div>
                  )}

                  {/* Phase: Review questions (editable) */}
                  {aiPhase === "questions" && (
                    <div className="space-y-3">
                      <div className="rounded-[--radius-md] border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-400">
                        Review and edit questions. Click any question to edit it.
                      </div>
                      <div className="max-h-64 space-y-2 overflow-y-auto">
                        {questions.map((q) => (
                          <div key={q.id} className="rounded-[--radius-sm] border border-border-light bg-surface p-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-text-primary">Q{q.id + 1}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] capitalize text-text-muted">{q.difficulty}</span>
                                <button
                                  onClick={() => setEditingQ(editingQ === q.id ? null : q.id)}
                                  className="text-[10px] font-semibold text-primary hover:underline"
                                >
                                  {editingQ === q.id ? "Done" : "Edit"}
                                </button>
                              </div>
                            </div>
                            {editingQ === q.id ? (
                              <textarea
                                value={q.text}
                                onChange={(e) => setQuestions(questions.map((qq) => qq.id === q.id ? { ...qq, text: e.target.value } : qq))}
                                className="mt-1 w-full rounded-[--radius-sm] border border-primary bg-input-bg px-2 py-1.5 text-xs text-text-primary outline-none"
                                rows={2}
                                autoFocus
                              />
                            ) : (
                              <p className="mt-1 text-xs text-text-secondary">{q.text}</p>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center justify-between">
                        <button onClick={() => { setAiPhase("config"); setQuestions([]); }} className="text-xs font-semibold text-primary hover:underline">
                          Regenerate
                        </button>
                        <button
                          onClick={handleConfirmQuestions}
                          className="rounded-[--radius-sm] bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-dark"
                        >
                          Confirm Questions & Generate Solutions
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Phase: Generating solutions */}
                  {aiPhase === "generating_solutions" && (
                    <div className="flex flex-col items-center py-10">
                      <motion.div className="h-4 w-4 rounded-full border-2 border-primary/30 border-t-primary" animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} />
                      <p className="mt-3 text-sm font-medium text-text-secondary">Generating answer key...</p>
                      <p className="mt-1 text-xs text-text-muted">AI is solving each question step-by-step</p>
                    </div>
                  )}

                  {/* Phase: Review solutions (editable) */}
                  {aiPhase === "solutions" && (
                    <div className="space-y-3">
                      <div className="rounded-[--radius-md] border border-green-200 bg-green-50 p-3 text-xs text-green-700 dark:border-green-500/20 dark:bg-green-500/10 dark:text-green-400">
                        Answer key generated. Review and edit solutions before assigning.
                      </div>
                      <div className="max-h-64 space-y-2 overflow-y-auto">
                        {questions.map((q) => {
                          const sol = solutions.find((s) => s.questionId === q.id);
                          return (
                            <div key={q.id} className="rounded-[--radius-sm] border border-border-light bg-surface p-3">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-text-primary">Q{q.id + 1}: {q.text}</span>
                                <button
                                  onClick={() => setEditingS(editingS === q.id ? null : q.id)}
                                  className="text-[10px] font-semibold text-primary hover:underline"
                                >
                                  {editingS === q.id ? "Done" : "Edit"}
                                </button>
                              </div>
                              {editingS === q.id ? (
                                <textarea
                                  value={sol?.text ?? ""}
                                  onChange={(e) => setSolutions(solutions.map((s) => s.questionId === q.id ? { ...s, text: e.target.value } : s))}
                                  className="mt-2 w-full rounded-[--radius-sm] border border-primary bg-input-bg px-2 py-1.5 text-xs text-text-primary outline-none"
                                  rows={2}
                                  autoFocus
                                />
                              ) : (
                                <div className="mt-2 rounded-[--radius-sm] bg-green-50/50 px-2 py-1.5 text-xs text-green-700 dark:bg-green-500/5 dark:text-green-400">
                                  <span className="font-semibold">Solution: </span>{sol?.text}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex items-center justify-between">
                        <button onClick={() => setAiPhase("questions")} className="text-xs font-semibold text-primary hover:underline">
                          ← Back to questions
                        </button>
                        <span className="text-[11px] text-text-muted">{questions.length} questions with solutions ready</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <button onClick={() => { setSource(null); setSelectedFiles(new Set()); }} className="mb-3 text-xs font-semibold text-primary hover:underline">← Back to options</button>
                  <p className="text-sm text-text-secondary">Select files to pull problems from.</p>
                  <div className="mt-3 space-y-2">
                    {MOCK_UNITS_WITH_FILES.filter((u) => u.files.length > 0).map((u) => (
                      <div key={u.name} className="rounded-[--radius-md] border border-border-light bg-surface p-3">
                        <div className="text-xs font-semibold text-text-primary">{u.name}</div>
                        <div className="mt-2 space-y-1">
                          {u.files.map((f) => (
                            <button
                              key={f.id}
                              onClick={() => toggleFile(f.id)}
                              className={`flex w-full items-center gap-2 rounded-[--radius-sm] px-2 py-1.5 text-left text-xs transition-colors ${
                                selectedFiles.has(f.id)
                                  ? "bg-primary-bg/30 text-text-primary"
                                  : "text-text-muted hover:bg-primary-bg/20"
                              }`}
                            >
                              <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border ${
                                selectedFiles.has(f.id) ? "border-primary bg-primary" : "border-border"
                              }`}>
                                {selectedFiles.has(f.id) && (
                                  <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
                                )}
                              </div>
                              📄 {f.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  {selectedFiles.size > 0 && (
                    <p className="mt-2 text-xs font-semibold text-primary">{selectedFiles.size} file{selectedFiles.size !== 1 ? "s" : ""} selected</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Assign */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label className="text-[13px] font-semibold text-text-secondary">Assign to sections</label>
                <div className="mt-2 space-y-2">
                  {MOCK_SECTIONS.map((sec) => (
                    <button
                      key={sec.id}
                      onClick={() => toggleSection(sec.id)}
                      className={`flex w-full items-center justify-between rounded-[--radius-md] border-2 p-3 transition-colors ${
                        selectedSections.has(sec.id)
                          ? "border-primary bg-primary-bg/20"
                          : "border-border-light hover:border-primary/30"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`flex h-5 w-5 items-center justify-center rounded-[--radius-sm] border-2 ${
                          selectedSections.has(sec.id) ? "border-primary bg-primary" : "border-border"
                        }`}>
                          {selectedSections.has(sec.id) && (
                            <svg className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
                          )}
                        </div>
                        <span className="text-sm font-medium text-text-primary">{sec.name}</span>
                      </div>
                      <span className="text-xs text-text-muted">{sec.studentCount} students</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[13px] font-semibold text-text-secondary">Due date</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="mt-1 w-full rounded-[--radius-sm] border border-border bg-input-bg px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="text-[13px] font-semibold text-text-secondary">Late policy</label>
                  <select
                    value={latePolicy}
                    onChange={(e) => setLatePolicy(e.target.value)}
                    className="mt-1 w-full rounded-[--radius-sm] border border-border bg-input-bg px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
                  >
                    <option value="none">No late submissions</option>
                    <option value="deduct_10">-10% per day</option>
                    <option value="accept">Accept late, no penalty</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border-light px-6 py-4">
          <button
            onClick={() => step > 1 ? setStep((step - 1) as Step) : onClose()}
            className="rounded-[--radius-sm] border border-border px-4 py-2 text-xs font-semibold text-text-muted hover:bg-primary-bg/50"
          >
            {step === 1 ? "Cancel" : "Back"}
          </button>
          {step < 3 ? (
            <button
              onClick={() => setStep((step + 1) as Step)}
              disabled={step === 1 ? (!type || !title.trim()) : !source || (source === "ai_generate" && aiPhase !== "solutions")}
              className="rounded-[--radius-sm] bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleCreate}
              disabled={selectedSections.size === 0}
              className="rounded-[--radius-sm] bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create Assignment
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
