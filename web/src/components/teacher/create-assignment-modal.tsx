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

const MOCK_UNITS = [
  "Unit 1: Linear Equations",
  "Unit 2: Systems of Equations",
  "Unit 3: Quadratic Equations",
];

export function CreateAssignmentModal({ onClose, onCreated }: CreateAssignmentModalProps) {
  const [step, setStep] = useState<Step>(1);

  // Step 1
  const [type, setType] = useState<AssignmentType | null>(null);
  const [title, setTitle] = useState("");

  // Step 2
  const [source, setSource] = useState<ContentSource | null>(null);
  const [aiUnit, setAiUnit] = useState("");
  const [aiDifficulty, setAiDifficulty] = useState("medium");
  const [aiQuestionCount, setAiQuestionCount] = useState("10");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiGenerated, setAiGenerated] = useState(false);

  // Step 3
  const [selectedSections, setSelectedSections] = useState<Set<string>>(new Set());
  const [dueDate, setDueDate] = useState("");
  const [latePolicy, setLatePolicy] = useState("deduct_10");

  function toggleSection(id: string) {
    setSelectedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleGenerate() {
    setAiGenerating(true);
    setTimeout(() => {
      setAiGenerating(false);
      setAiGenerated(true);
    }, 2000);
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
                  <button onClick={() => { setSource(null); setAiGenerated(false); }} className="mb-3 text-xs font-semibold text-primary hover:underline">← Back to options</button>
                  {!aiGenerated ? (
                    <div className="space-y-3">
                      <div>
                        <label className="text-[13px] font-semibold text-text-secondary">Based on unit</label>
                        <select
                          value={aiUnit}
                          onChange={(e) => setAiUnit(e.target.value)}
                          className="mt-1 w-full rounded-[--radius-sm] border border-border bg-input-bg px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
                        >
                          <option value="">Select a unit...</option>
                          {MOCK_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[13px] font-semibold text-text-secondary">Difficulty</label>
                          <select
                            value={aiDifficulty}
                            onChange={(e) => setAiDifficulty(e.target.value)}
                            className="mt-1 w-full rounded-[--radius-sm] border border-border bg-input-bg px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
                          >
                            <option value="easy">Easy</option>
                            <option value="medium">Medium</option>
                            <option value="hard">Hard</option>
                            <option value="mixed">Mixed</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[13px] font-semibold text-text-secondary">Questions</label>
                          <input
                            type="number"
                            value={aiQuestionCount}
                            onChange={(e) => setAiQuestionCount(e.target.value)}
                            min={1}
                            max={50}
                            className="mt-1 w-full rounded-[--radius-sm] border border-border bg-input-bg px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
                          />
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
                            <motion.div
                              className="h-3 w-3 rounded-full border-2 border-white/30 border-t-white"
                              animate={{ rotate: 360 }}
                              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                            />
                            Generating...
                          </span>
                        ) : "Generate Preview"}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="rounded-[--radius-md] border border-green-200 bg-green-50 p-3 text-xs text-green-700 dark:border-green-500/20 dark:bg-green-500/10 dark:text-green-400">
                        Generated {aiQuestionCount} questions from {aiUnit}
                      </div>
                      <div className="space-y-2">
                        {Array.from({ length: Math.min(Number(aiQuestionCount), 5) }, (_, i) => (
                          <div key={i} className="rounded-[--radius-sm] border border-border-light bg-surface p-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-text-primary">Q{i + 1}</span>
                              <span className="text-[10px] text-text-muted capitalize">{aiDifficulty}</span>
                            </div>
                            <p className="mt-1 text-xs text-text-secondary">
                              {["Solve: 2x + 5 = 13", "Factor: x² - 9", "Simplify: 3(2x - 4) + 7", "Find x: 4x/3 = 8", "Graph: y = 2x + 1"][i % 5]}
                            </p>
                          </div>
                        ))}
                        {Number(aiQuestionCount) > 5 && (
                          <p className="text-center text-xs text-text-muted">+ {Number(aiQuestionCount) - 5} more questions</p>
                        )}
                      </div>
                      <button onClick={() => setAiGenerated(false)} className="text-xs font-semibold text-primary hover:underline">
                        Regenerate
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <button onClick={() => setSource(null)} className="mb-3 text-xs font-semibold text-primary hover:underline">← Back to options</button>
                  <p className="text-sm text-text-secondary">Select problems from your uploaded documents.</p>
                  <div className="mt-3 space-y-2">
                    {MOCK_UNITS.map((u) => (
                      <div key={u} className="rounded-[--radius-md] border border-border-light bg-surface p-3">
                        <div className="text-xs font-semibold text-text-primary">{u}</div>
                        <div className="mt-1 text-[11px] text-text-muted">3 documents · ~15 problems extracted</div>
                      </div>
                    ))}
                  </div>
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
              disabled={step === 1 ? (!type || !title.trim()) : !source}
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
