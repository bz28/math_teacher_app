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
  results: MockTestResult[] | null;
  sessionId: string | null;
  workImages: (string | null)[];
  workSubmissions: (DiagnosisResult | null)[];
  multipleChoice: boolean;
}

export interface MockTestResult {
  question: string;
  userAnswer: string | null;
  correctAnswer: string;
  isCorrect: boolean | null;
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

export const useMockTestStore = create<MockTestState>((set, get) => ({
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
        set({
          mockTest: createMockTest(placeholders, id, timeLimitMinutes, multipleChoice),
          phase: "mock_test_active",
        });

        // Resolve correct answers in background
        Promise.allSettled(
          problems.map((p) => {
            const image = imageMap.get(p);
            return practiceApi.generate({
              problem: p, count: 0, subject,
              ...(image && { image_base64: image }),
            });
          }),
        ).then((results) => {
          const { mockTest: mt } = get();
          if (!mt) return;
          const updated = [...mt.questions];
          for (let i = 0; i < results.length; i++) {
            const r = results[i];
            if (r.status === "fulfilled" && r.value.problems.length > 0) {
              updated[i] = r.value.problems[0];
            }
          }
          set({ mockTest: { ...mt, questions: updated } });
        });
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
      const results: MockTestResult[] = await Promise.all(
        mockTest.questions.map(async (q, i) => {
          const userAnswer = mockTest.answers[i] ?? null;
          if (!userAnswer) {
            return {
              question: q.question,
              userAnswer: null,
              correctAnswer: q.answer,
              isCorrect: null,
            };
          }
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

      if (mockTest.sessionId) {
        const correctCount = results.filter((r) => r.isCorrect === true).length;
        await sessionApi.completeMockTest(mockTest.sessionId, {
          total_questions: results.length,
          correct_count: correctCount,
        });
      }

      const newFlags = [...mockTest.flags];
      results.forEach((r, i) => {
        if (r.isCorrect !== true) newFlags[i] = true;
      });

      const images = mockTest.workImages;
      const pending = images
        .map((img, i) => (img ? { img, i } : null))
        .filter(Boolean) as { img: string; i: number }[];

      const updatedMockTest = {
        ...mockTest,
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
              const q = mockTest.questions[i];
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
