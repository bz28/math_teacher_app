"use client";

import { create } from "zustand";
import {
  session as sessionApi,
  practice as practiceApi,
  work as workApi,
  type PracticeProblem,
  type DiagnosisResult,
} from "@/lib/api";
import type { Subject } from "@/stores/learn";
import type { QuizResult } from "@/lib/utils";

// ── Types ──

export type MockTestPhase =
  | "idle"
  | "loading"
  | "mock_test_active"
  | "mock_test_summary"
  | "error";

export interface MockTest {
  questions: PracticeProblem[];
  answers: Record<number, string>;
  flags: boolean[];
  currentIndex: number;
  timeLimitSeconds: number | null;
  startedAt: number;
  submittedAt: number | null;
  results: QuizResult[] | null;
  sessionId: string | null;
  workImages: (string | null)[];
  workSubmissions: (DiagnosisResult | null)[];
  multipleChoice: boolean;
}

// ── Helpers ──

function createMockTest(
  questions: PracticeProblem[],
  sessionId: string,
  timeLimitMinutes: number | null,
  multipleChoice: boolean,
): MockTest {
  const len = questions.length;
  return {
    questions,
    answers: {},
    flags: new Array(len).fill(false),
    currentIndex: 0,
    timeLimitSeconds: timeLimitMinutes ? timeLimitMinutes * 60 : null,
    startedAt: Date.now(),
    submittedAt: null,
    results: null,
    sessionId,
    workImages: new Array(len).fill(null),
    workSubmissions: new Array(len).fill(null),
    multipleChoice,
  };
}

// ── Store ──

interface MockTestState {
  mockTest: MockTest | null;
  phase: MockTestPhase;
  error: string | null;

  startMockTest: (
    problems: string[],
    generateCount: number,
    timeLimitMinutes: number | null,
    subject: Subject,
    problemQueue: { text: string; image?: string }[],
    multipleChoice?: boolean,
  ) => Promise<void>;
  saveMockTestAnswer: (index: number, answer: string) => void;
  attachMockTestWork: (index: number, imageBase64: string) => void;
  toggleMockTestFlag: (index: number) => void;
  setMockTestIndex: (index: number) => void;
  submitMockTest: (subject: Subject) => Promise<void>;
  reset: () => void;
}

const initialState = {
  mockTest: null as MockTest | null,
  phase: "idle" as MockTestPhase,
  error: null as string | null,
};

export const useMockTestStore = create<MockTestState>((set, get, store) => ({
  ...initialState,

  async startMockTest(problems, generateCount, timeLimitMinutes, subject, problemQueue, multipleChoice = true) {
    const imageMap = new Map(problemQueue.map((p) => [p.text, p.image]));
    set({ phase: "loading", error: null });
    try {
      if (generateCount > 0) {
        const image = imageMap.get(problems[0]);
        const { problems: generated } = await practiceApi.generate({
          problem: problems[0],
          count: generateCount,
          subject,
          ...(image && { image_base64: image }),
        });
        const allQuestionTexts = generated.map((g) => g.question);
        const { id } = await sessionApi.createMockTest(problems[0], allQuestionTexts);
        set({
          mockTest: createMockTest(generated, id, timeLimitMinutes, multipleChoice),
          phase: "mock_test_active",
        });
      } else {
        const placeholders: PracticeProblem[] = problems.map((p) => ({
          question: p,
          answer: "",
        }));
        const { id } = await sessionApi.createMockTest(problems[0], problems);

        // Set mockTest with placeholders first so .then() handlers can find it
        const mt = createMockTest(placeholders, id, timeLimitMinutes, multipleChoice);
        set({ mockTest: mt });

        // Fire all API calls in parallel, update each question as it resolves
        const promises = problems.map((p, i) => {
          const image = imageMap.get(p);
          return practiceApi.generate({
            problem: p, count: 0, subject,
            ...(image && { image_base64: image }),
          }).then((res) => {
            if (res.problems.length > 0) {
              const { mockTest: current } = get();
              if (!current) return;
              const updated = [...current.questions];
              updated[i] = res.problems[0];
              set({ mockTest: { ...current, questions: updated } });
            }
          });
        });

        // Wait for the first question before showing the exam
        try { await promises[0]; } catch { /* first question failed, continue */ }
        set({ phase: "mock_test_active" });

        // Remaining questions continue resolving in background
        Promise.allSettled(promises.slice(1));
      }
    } catch (err) {
      set({ phase: "error", error: (err as Error).message });
    }
  },

  saveMockTestAnswer(index, answer) {
    set((state) => {
      if (!state.mockTest) return {};
      return {
        mockTest: {
          ...state.mockTest,
          answers: { ...state.mockTest.answers, [index]: answer },
        },
      };
    });
  },

  attachMockTestWork(index, imageBase64) {
    set((state) => {
      if (!state.mockTest) return {};
      const workImages = [...state.mockTest.workImages];
      workImages[index] = imageBase64;
      return { mockTest: { ...state.mockTest, workImages } };
    });
  },

  toggleMockTestFlag(index) {
    set((state) => {
      if (!state.mockTest) return {};
      const flags = [...state.mockTest.flags];
      flags[index] = !flags[index];
      return { mockTest: { ...state.mockTest, flags } };
    });
  },

  setMockTestIndex(index) {
    set((state) => {
      if (!state.mockTest) return {};
      return { mockTest: { ...state.mockTest, currentIndex: index } };
    });
  },

  async submitMockTest(subject) {
    const { mockTest } = get();
    if (!mockTest) return;
    set({ phase: "loading" });

    try {
      // Wait for all answers to be resolved before grading
      const answersResolved = mockTest.questions.every((q) => q.answer !== "");
      if (!answersResolved) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => { unsub(); resolve(); }, 30_000);
          const unsub = store.subscribe((state) => {
            if (!state.mockTest) { clearTimeout(timeout); unsub(); resolve(); return; }
            if (state.mockTest.questions.every((q) => q.answer !== "")) {
              clearTimeout(timeout);
              unsub();
              resolve();
            }
          });
        });
      }

      // Re-read after potential wait
      const mt = get().mockTest;
      if (!mt) return;

      const results: QuizResult[] = await Promise.all(
        mt.questions.map(async (q, i) => {
          const userAnswer = mt.answers[i] ?? null;
          if (!userAnswer) {
            return {
              question: q.question,
              userAnswer: null,
              correctAnswer: q.answer,
              isCorrect: null,
            };
          }

          // MC mode: student selected an exact option, no API call needed
          if (mt.multipleChoice) {
            return {
              question: q.question,
              userAnswer,
              correctAnswer: q.answer,
              isCorrect: userAnswer.trim() === q.answer.trim(),
            };
          }

          // Free response: try exact match first to skip API call
          if (userAnswer.trim() === q.answer.trim()) {
            return {
              question: q.question,
              userAnswer,
              correctAnswer: q.answer,
              isCorrect: true,
            };
          }

          // Fall back to API for semantic equivalence check
          const { is_correct } = await practiceApi.check({
            question: q.question,
            correct_answer: q.answer,
            user_answer: userAnswer,
            subject,
          });
          return {
            question: q.question,
            userAnswer,
            correctAnswer: q.answer,
            isCorrect: is_correct,
          };
        }),
      );

      if (mt.sessionId) {
        const correctCount = results.filter((r) => r.isCorrect === true).length;
        await sessionApi.completeMockTest(mt.sessionId, {
          total_questions: results.length,
          correct_count: correctCount,
        });
      }

      const newFlags = [...mt.flags];
      results.forEach((r, i) => {
        if (r.isCorrect !== true) newFlags[i] = true;
      });

      const images = mt.workImages;
      const pending = images
        .map((img, i) => (img ? { img, i } : null))
        .filter(Boolean) as { img: string; i: number }[];

      const updatedMockTest = {
        ...mt,
        results,
        flags: newFlags,
        submittedAt: Date.now(),
      };

      if (pending.length === 0) {
        set({ mockTest: updatedMockTest, phase: "mock_test_summary" });
      } else {
        set({ mockTest: updatedMockTest });

        for (let b = 0; b < pending.length; b += 3) {
          const batch = pending.slice(b, b + 3);
          await Promise.allSettled(
            batch.map(async ({ img, i }) => {
              const q = mt.questions[i];
              const r = results[i];
              const res = await workApi.submit({
                image_base64: img,
                problem_text: q.question,
                user_answer: r?.userAnswer ?? "",
                user_was_correct: r?.isCorrect === true,
                subject,
              });
              if (!res.diagnosis) return;
              const { mockTest: current } = get();
              if (!current) return;
              const newSubs = [...current.workSubmissions];
              newSubs[i] = res.diagnosis;
              const updatedFlags = [...current.flags];
              if (res.diagnosis.has_issues && !updatedFlags[i]) {
                updatedFlags[i] = true;
              }
              set({ mockTest: { ...current, workSubmissions: newSubs, flags: updatedFlags } });
            }),
          );
        }

        set({ phase: "mock_test_summary" });
      }
    } catch (err) {
      set({ phase: "error", error: (err as Error).message });
    }
  },

  reset() {
    set(initialState);
  },
}));
