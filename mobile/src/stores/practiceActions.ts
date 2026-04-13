import {
  completePracticeBatchSession,
  createPracticeBatchSession,
  generatePracticeProblems,
  type PracticeProblem,
} from "../services/api";
import { errorMessage } from "../utils/errorMessage";
import {
  initialState,
  type PracticeResult,
  type StoreGet,
  type StoreSet,
} from "./types";

function createBatch(
  problems: PracticeProblem[],
  sessionId: string | null,
) {
  return {
    problems,
    answers: {} as Record<number, string>,
    flags: new Array(problems.length).fill(false) as boolean[],
    currentIndex: 0,
    startedAt: Date.now(),
    submittedAt: null as number | null,
    results: null as PracticeResult[] | null,
    sessionId,
  };
}

export function createPracticeActions(set: StoreSet, get: StoreGet) {
  return {
    startPracticeBatch: async (problem: string, count: number) => {
      const { subject } = get();
      set({ ...initialState, subject, phase: "loading" });
      try {
        const [{ problems }, { id: sessionId }] = await Promise.all([
          generatePracticeProblems(problem, count, subject),
          createPracticeBatchSession(problem),
        ]);
        set({
          practiceBatch: createBatch(problems, sessionId),
          phase: "practice_active",
        });
      } catch {
        set({ phase: "error", error: "Failed to generate practice problems" });
      }
    },

    savePracticeAnswer: (index: number, answer: string) => {
      const { practiceBatch } = get();
      if (!practiceBatch) return;
      set({
        practiceBatch: {
          ...practiceBatch,
          answers: { ...practiceBatch.answers, [index]: answer },
        },
      });
    },

    setPracticeIndex: (index: number) => {
      const { practiceBatch } = get();
      if (!practiceBatch) return;
      set({ practiceBatch: { ...practiceBatch, currentIndex: index } });
    },

    submitPractice: () => {
      const { practiceBatch } = get();
      if (!practiceBatch) return;

      const results: PracticeResult[] = practiceBatch.problems.map((q, i) => {
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
        completePracticeBatchSession(practiceBatch.sessionId, results.length, correct)
          .catch(() => {});
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

    togglePracticeFlag: (index: number) => {
      const { practiceBatch } = get();
      if (!practiceBatch) return;
      const newFlags = [...practiceBatch.flags];
      newFlags[index] = !newFlags[index];
      set({ practiceBatch: { ...practiceBatch, flags: newFlags } });
    },
  };
}
