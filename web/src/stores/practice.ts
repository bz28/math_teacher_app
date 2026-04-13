"use client";

import { create } from "zustand";
import {
  session as sessionApi,
  practice as practiceApi,
  EntitlementError,
  type PracticeProblem,
} from "@/lib/api";
import type { Subject } from "@/stores/learn";
import type { QuizResult } from "@/lib/utils";

// ── Types ──

export type PracticePhase =
  | "idle"
  | "loading"
  | "practice_active"
  | "practice_summary"
  | "error";

export interface PracticeBatch {
  problems: PracticeProblem[];
  answers: Record<number, string>;
  flags: boolean[];
  currentIndex: number;
  startedAt: number;
  submittedAt: number | null;
  results: QuizResult[] | null;
  sessionId: string | null;
}

// ── Helpers ──

function createBatch(
  problems: PracticeProblem[],
  sessionId: string | null,
): PracticeBatch {
  return {
    problems,
    answers: {},
    flags: new Array(problems.length).fill(false),
    currentIndex: 0,
    startedAt: Date.now(),
    submittedAt: null,
    results: null,
    sessionId,
  };
}

// ── Store ──

interface PracticeState {
  practiceBatch: PracticeBatch | null;
  phase: PracticePhase;
  error: string | null;

  startPracticeBatch: (problem: string, count: number, subject: Subject) => Promise<void>;
  practiceFlaggedProblems: (flaggedProblems: string[], subject: Subject) => Promise<void>;
  savePracticeAnswer: (index: number, answer: string) => void;
  togglePracticeFlag: (index: number) => void;
  setPracticeIndex: (index: number) => void;
  submitPractice: () => void;
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

  savePracticeAnswer(index, answer) {
    set((state) => {
      if (!state.practiceBatch) return {};
      return {
        practiceBatch: {
          ...state.practiceBatch,
          answers: { ...state.practiceBatch.answers, [index]: answer },
        },
      };
    });
  },

  setPracticeIndex(index) {
    set((state) => {
      if (!state.practiceBatch) return {};
      return { practiceBatch: { ...state.practiceBatch, currentIndex: index } };
    });
  },

  submitPractice() {
    const { practiceBatch } = get();
    if (!practiceBatch) return;

    const results: QuizResult[] = practiceBatch.problems.map((q, i) => {
      const userAnswer = practiceBatch.answers[i] ?? null;
      if (!userAnswer) {
        return { question: q.question, userAnswer: null, correctAnswer: q.answer, isCorrect: null };
      }
      // MCQ: exact string match
      return {
        question: q.question,
        userAnswer,
        correctAnswer: q.answer,
        isCorrect: userAnswer.trim() === q.answer.trim(),
      };
    });

    // Auto-flag incorrect and unanswered
    const newFlags = [...practiceBatch.flags];
    results.forEach((r, i) => {
      if (r.isCorrect !== true) newFlags[i] = true;
    });

    // Record in history (fire-and-forget)
    if (practiceBatch.sessionId) {
      const correct = results.filter((r) => r.isCorrect === true).length;
      sessionApi.completePracticeBatch(practiceBatch.sessionId, {
        total_questions: results.length,
        correct_count: correct,
      }).catch(console.error);
    }

    set({
      practiceBatch: {
        ...practiceBatch,
        results,
        flags: newFlags,
        submittedAt: Date.now(),
      },
      phase: "practice_summary",
    });
  },

  async practiceFlaggedProblems(flaggedProblems, subject) {
    if (flaggedProblems.length === 0) return;

    set({ ...initialState, phase: "loading" as PracticePhase });
    try {
      const [results, { id: sessionId }] = await Promise.all([
        Promise.all(flaggedProblems.map((p) => practiceApi.generate({ problem: p, count: 1, subject }))),
        sessionApi.createPracticeBatch(flaggedProblems[0]),
      ]);
      const allProblems = results.map((r) => r.problems[0]);
      set({
        practiceBatch: createBatch(allProblems, sessionId),
        phase: "practice_active" as PracticePhase,
      });
    } catch (err) {
      if (err instanceof EntitlementError) throw err;
      set({ phase: "error", error: (err as Error).message });
    }
  },

  async startPracticeBatch(problem, count, subject) {
    set({ phase: "loading", error: null });
    try {
      const [{ problems }, { id: sessionId }] = await Promise.all([
        practiceApi.generate({ problem, count, subject }),
        sessionApi.createPracticeBatch(problem),
      ]);
      set({
        practiceBatch: createBatch(problems, sessionId),
        phase: "practice_active",
      });
    } catch (err) {
      if (err instanceof EntitlementError) throw err;
      set({ phase: "error", error: (err as Error).message });
    }
  },

  reset() {
    set(initialState);
  },
}));
