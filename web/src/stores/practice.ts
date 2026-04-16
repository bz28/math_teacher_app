"use client";

import { create } from "zustand";
import {
  session as sessionApi,
  practice as practiceApi,
  work as workApi,
  EntitlementError,
  type PracticeProblem,
  type DiagnosisResult,
} from "@/lib/api";
import { pollForState } from "@/lib/poll";
import type { Subject } from "@/stores/learn";
import type { Difficulty } from "@/components/shared/difficulty-picker";

// ── Types ──

export type PracticePhase =
  | "idle"
  | "loading"
  | "practice_preview"
  | "awaiting_input"
  | "thinking"
  | "practice_summary"
  | "error";

export interface PracticeBatch {
  problems: PracticeProblem[];
  currentIndex: number;
  results: PracticeResult[];
  flags: boolean[];
  workSubmissions: (DiagnosisResult | null)[];
  firstAttemptCorrect: (boolean | null)[];
  currentFeedback: "correct" | "wrong" | null;
  sessionId: string | null;
  loadingMore: boolean;
  totalCount: number;
  skippedProblems: string[];
}

export interface PracticeResult {
  problem: string;
  userAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
}

// ── Helpers ──

function createPracticeBatch(
  problems: PracticeProblem[],
  sessionId: string | null,
  overrides?: Partial<PracticeBatch>,
): PracticeBatch {
  const len = problems.length;
  return {
    problems,
    currentIndex: 0,
    results: [],
    flags: new Array(len).fill(false),
    workSubmissions: new Array(len).fill(null),
    firstAttemptCorrect: new Array(len).fill(null),
    currentFeedback: null,
    sessionId,
    loadingMore: false,
    totalCount: 0,
    skippedProblems: [],
    ...overrides,
  };
}

// ── Store ──

interface PracticeState {
  practiceBatch: PracticeBatch | null;
  phase: PracticePhase;
  error: string | null;

  startPracticeBatch: (problem: string, subject: Subject, difficulty?: Difficulty) => Promise<void>;
  beginPractice: () => void;
  startPracticeQueue: (problems: string[], subject: Subject) => Promise<void>;
  practiceFlaggedProblems: (flaggedProblems: string[], subject: Subject, difficulty?: Difficulty) => Promise<void>;
  submitPracticeAnswer: (answer: string, subject: Subject) => Promise<void>;
  skipPracticeProblem: () => void;
  submitPracticeWork: (index: number, imageBase64: string, userAnswer: string, subject: Subject) => void;
  nextPracticeProblem: () => void;
  togglePracticeFlag: (index: number) => void;
  reset: () => void;
}

const initialState = {
  practiceBatch: null as PracticeBatch | null,
  phase: "idle" as PracticePhase,
  error: null as string | null,
};

export const usePracticeStore = create<PracticeState>((set, get) => ({
  ...initialState,

  togglePracticeFlag(index) {
    const { practiceBatch } = get();
    if (!practiceBatch) return;
    const newFlags = [...practiceBatch.flags];
    newFlags[index] = !newFlags[index];
    set({ practiceBatch: { ...practiceBatch, flags: newFlags } });
  },

  async practiceFlaggedProblems(flaggedProblems, subject, difficulty: Difficulty = "same") {
    if (flaggedProblems.length === 0) return;

    set({ ...initialState, phase: "loading" as PracticePhase });
    try {
      // Phase 1: batch generate similar question texts for all flagged problems
      const [{ problems: generated }, { id: sessionId }] = await Promise.all([
        practiceApi.generate({ problems: flaggedProblems, subject, difficulty }),
        sessionApi.createPracticeBatch(flaggedProblems[0], subject),
      ]);
      const similarQuestions = generated.map((p) => p.question);

      // Show intermission screen with placeholders
      const placeholders: PracticeProblem[] = similarQuestions.map((q) => ({ question: q, answer: "" }));
      set({
        practiceBatch: createPracticeBatch(placeholders, sessionId, { totalCount: flaggedProblems.length }),
        phase: "practice_preview" as PracticePhase,
      });

      // Phase 2: solve each in parallel — user clicks Begin when ready
      const batchId = sessionId;
      Promise.allSettled(
        similarQuestions.map((q, i) =>
          practiceApi.generate({ problem: q, count: 0, subject }).then((res) => {
            if (!res.problems[0]) return;
            const { practiceBatch: current } = get();
            if (!current || current.sessionId !== batchId) return;
            const updated = [...current.problems];
            updated[i] = res.problems[0];
            set({ practiceBatch: { ...current, problems: updated } });
          }),
        ),
      ).then(() => {
        const { practiceBatch: current } = get();
        if (!current || current.sessionId !== batchId) return;
        if (current.problems.every((p) => p.answer === "")) {
          set({ phase: "error", error: "Failed to generate answers. Please try again." });
        }
      });
    } catch (err) {
      if (err instanceof EntitlementError) throw err;
      set({ phase: "error", error: (err as Error).message });
    }
  },

  async startPracticeBatch(problem, subject, difficulty: Difficulty = "same") {
    set({ phase: "loading", error: null });
    try {
      // Phase 1: generate a similar question text (not the original)
      const { problems: generated } = await practiceApi.generate({ problems: [problem], subject, difficulty });
      const similarQuestion = generated[0]?.question ?? problem;

      // Show intermission screen immediately with placeholder
      const placeholder: PracticeProblem = { question: similarQuestion, answer: "" };
      const { id: sessionId } = await sessionApi.createPracticeBatch(problem, subject);
      set({
        practiceBatch: createPracticeBatch([placeholder], sessionId, { totalCount: 1 }),
        phase: "practice_preview",
      });

      // Phase 2: solve in background — user clicks Begin when ready
      const batchId = sessionId;
      practiceApi.generate({ problem: similarQuestion, count: 0, subject }).then((res) => {
        const { practiceBatch: current } = get();
        if (!current || current.sessionId !== batchId) return;
        if (!res.problems[0]) {
          set({ phase: "error", error: "Failed to generate answer. Please try again." });
          return;
        }
        const updated = [...current.problems];
        updated[0] = res.problems[0];
        set({ practiceBatch: { ...current, problems: updated } });
      }).catch((err) => {
        const { practiceBatch: current } = get();
        if (!current || current.sessionId !== batchId) return;
        set({ phase: "error", error: (err as Error).message });
      });
    } catch (err) {
      if (err instanceof EntitlementError) throw err;
      set({ phase: "error", error: (err as Error).message });
    }
  },

  beginPractice() {
    set({ phase: "awaiting_input" });
  },

  async startPracticeQueue(problems, subject) {
    if (problems.length === 0) return;

    const placeholders: PracticeProblem[] = problems.map((p) => ({
      question: p,
      answer: "",
    }));
    const sessionId = await sessionApi.createPracticeBatch(problems[0], subject)
      .then((r) => r.id)
      .catch(() => null);

    set({
      practiceBatch: createPracticeBatch(placeholders, sessionId, {
        loadingMore: true,
        totalCount: problems.length,
      }),
      phase: "awaiting_input",
    });

    // Resolve correct answers in background
    Promise.allSettled(
      problems.map((p) => practiceApi.generate({ problem: p, count: 0, subject })),
    ).then((results) => {
      const { practiceBatch: batch } = get();
      if (!batch) return;
      const updated = [...batch.problems];
      const skipped: string[] = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === "fulfilled" && r.value.problems[0]) {
          updated[i] = { question: problems[i], answer: r.value.problems[0].answer };
        } else {
          skipped.push(problems[i]);
        }
      }
      set({
        practiceBatch: {
          ...batch,
          problems: updated,
          loadingMore: false,
          skippedProblems: skipped,
        },
      });
    });
  },

  async submitPracticeAnswer(answer, _subject) {
    const { practiceBatch } = get();
    if (!practiceBatch) return;
    const idx = practiceBatch.currentIndex;
    const current = practiceBatch.problems[idx];
    set({ phase: "thinking" });
    try {
      let correctAnswer = current.answer;
      if (!correctAnswer) {
        const resolved = await pollForState(
          () => get().practiceBatch?.problems[idx]?.answer,
          30_000,
        );
        if (!resolved) throw new Error("Timed out waiting for answer");
        correctAnswer = resolved;
      }

      // MC: direct string comparison (no LLM call needed)
      const is_correct = answer.trim() === correctAnswer.trim();

      const newFirstAttempt = [...practiceBatch.firstAttemptCorrect];
      if (newFirstAttempt[idx] === null) newFirstAttempt[idx] = is_correct;

      if (is_correct) {
        const result: PracticeResult = {
          problem: current.question,
          userAnswer: answer,
          correctAnswer: "",
          isCorrect: true,
        };
        const newFlags = [...practiceBatch.flags];
        newFlags[idx] = false;
        set({
          practiceBatch: {
            ...practiceBatch,
            results: [...practiceBatch.results, result],
            flags: newFlags,
            firstAttemptCorrect: newFirstAttempt,
            currentFeedback: "correct",
          },
          phase: "awaiting_input",
        });
      } else {
        const newFlags = [...practiceBatch.flags];
        newFlags[idx] = true;
        set({
          practiceBatch: {
            ...practiceBatch,
            flags: newFlags,
            firstAttemptCorrect: newFirstAttempt,
            currentFeedback: "wrong",
          },
          phase: "awaiting_input",
        });
      }
    } catch (err) {
      set({ phase: "error", error: (err as Error).message });
    }
  },

  skipPracticeProblem() {
    const { practiceBatch } = get();
    if (!practiceBatch) return;
    const idx = practiceBatch.currentIndex;
    const current = practiceBatch.problems[idx];

    const newFlags = [...practiceBatch.flags];
    newFlags[idx] = true;
    const newFirstAttempt = [...practiceBatch.firstAttemptCorrect];
    if (newFirstAttempt[idx] === null) newFirstAttempt[idx] = false;

    const result: PracticeResult = {
      problem: current.question,
      userAnswer: "(skipped)",
      correctAnswer: "",
      isCorrect: false,
    };

    const next = idx + 1;
    if (next >= practiceBatch.problems.length) {
      set({
        practiceBatch: {
          ...practiceBatch,
          results: [...practiceBatch.results, result],
          flags: newFlags,
          firstAttemptCorrect: newFirstAttempt,
          currentFeedback: null,
        },
        phase: "practice_summary",
      });
    } else {
      set({
        practiceBatch: {
          ...practiceBatch,
          results: [...practiceBatch.results, result],
          flags: newFlags,
          firstAttemptCorrect: newFirstAttempt,
          currentFeedback: null,
          currentIndex: next,
        },
        phase: "awaiting_input",
      });
    }
  },

  submitPracticeWork(index, imageBase64, userAnswer, subject) {
    const { practiceBatch } = get();
    if (!practiceBatch) return;
    const problem = practiceBatch.problems[index];

    workApi
      .submit({
        image_base64: imageBase64,
        problem_text: problem.question,
        user_answer: userAnswer,
        user_was_correct: false,
        subject,
      })
      .then((res) => {
        if (!res.diagnosis) return;
        const { practiceBatch: current } = get();
        if (!current) return;
        const newSubmissions = [...current.workSubmissions];
        newSubmissions[index] = res.diagnosis;
        const newFlags = [...current.flags];
        if (res.diagnosis.has_issues && !newFlags[index]) {
          newFlags[index] = true;
        }
        set({ practiceBatch: { ...current, workSubmissions: newSubmissions, flags: newFlags } });
      })
      .catch(console.error);
  },

  nextPracticeProblem() {
    const { practiceBatch } = get();
    if (!practiceBatch) return;
    const next = practiceBatch.currentIndex + 1;
    if (next >= practiceBatch.problems.length) {
      set({ phase: "practice_summary" });
    } else {
      set({
        practiceBatch: { ...practiceBatch, currentIndex: next, currentFeedback: null },
        phase: "awaiting_input",
      });
    }
  },

  reset() {
    set(initialState);
  },
}));
