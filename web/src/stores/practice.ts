"use client";

import { create } from "zustand";
import {
  session as sessionApi,
  practice as practiceApi,
  work as workApi,
  type PracticeProblem,
  type PracticeCheckResponse,
  type DiagnosisResult,
} from "@/lib/api";
import { pollForState } from "@/lib/poll";
import type { Subject } from "@/stores/learn";

// ── Types ──

export type PracticePhase =
  | "idle"
  | "loading"
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

  startPracticeBatch: (problem: string, count: number, subject: Subject) => Promise<void>;
  startPracticeQueue: (problems: string[], subject: Subject) => Promise<void>;
  practiceFlaggedProblems: (flaggedProblems: string[], subject: Subject) => Promise<void>;
  submitPracticeAnswer: (answer: string, subject: Subject) => Promise<void>;
  skipPracticeProblem: () => void;
  submitPracticeWork: (index: number, imageBase64: string, userAnswer: string, subject: Subject) => void;
  nextPracticeProblem: () => void;
  togglePracticeFlag: (index: number) => void;
  retryFlaggedProblems: (subject: Subject) => Promise<void>;
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

  async retryFlaggedProblems(subject) {
    const { practiceBatch } = get();
    if (!practiceBatch) return;
    const flaggedProblems = practiceBatch.problems.filter((_, i) => practiceBatch.flags[i]);
    if (flaggedProblems.length === 0) return;

    set({ ...initialState, phase: "loading" as PracticePhase });
    try {
      const allProblems: PracticeProblem[] = [];
      for (const problem of flaggedProblems) {
        const { problems } = await practiceApi.generate({ problem: problem.question, count: 1, subject });
        allProblems.push(...problems);
      }
      const { id: sessionId } = await sessionApi.createPracticeBatch(flaggedProblems[0].question);
      set({
        practiceBatch: createPracticeBatch(allProblems, sessionId),
        phase: "awaiting_input" as PracticePhase,
      });
    } catch (err) {
      set({ phase: "error", error: (err as Error).message });
    }
  },

  async practiceFlaggedProblems(flaggedProblems, subject) {
    if (flaggedProblems.length === 0) return;

    set({ ...initialState, phase: "loading" as PracticePhase });
    try {
      const allProblems: PracticeProblem[] = [];
      for (const problem of flaggedProblems) {
        const { problems } = await practiceApi.generate({ problem, count: 1, subject });
        allProblems.push(...problems);
      }
      const { id: sessionId } = await sessionApi.createPracticeBatch(flaggedProblems[0]);
      set({
        practiceBatch: createPracticeBatch(allProblems, sessionId),
        phase: "awaiting_input" as PracticePhase,
      });
    } catch (err) {
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
        practiceBatch: createPracticeBatch(problems, sessionId),
        phase: "awaiting_input",
      });
    } catch (err) {
      set({ phase: "error", error: (err as Error).message });
    }
  },

  async startPracticeQueue(problems, subject) {
    if (problems.length === 0) return;

    const placeholders: PracticeProblem[] = problems.map((p) => ({
      question: p,
      answer: "",
    }));
    const sessionId = await sessionApi.createPracticeBatch(problems[0])
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

  async submitPracticeAnswer(answer, subject) {
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

      const { is_correct }: PracticeCheckResponse = await practiceApi.check({
        question: current.question,
        correct_answer: correctAnswer,
        user_answer: answer,
        subject,
      });

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
