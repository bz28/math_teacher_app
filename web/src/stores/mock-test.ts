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
import type { Subject } from "@/stores/learn";
import type { Difficulty } from "@/components/shared/difficulty-picker";
import type { QuizResult } from "@/lib/utils";

// ── Types ──

export type MockTestPhase =
  | "idle"
  | "loading"
  | "mock_test_preview"
  | "mock_test_active"
  | "mock_test_summary"
  | "error";

export interface MockTest {
  questions: PracticeProblem[];
  answers: Record<number, string>;
  flags: boolean[];
  currentIndex: number;
  timeLimitSeconds: number | null;
  startedAt: number | null;
  submittedAt: number | null;
  results: QuizResult[] | null;
  sessionId: string | null;
  workImages: (string | null)[];
  workSubmissions: (DiagnosisResult | null)[];
  multipleChoice: boolean;
  /** True once all background solve requests have settled (succeeded
   *  or rejected). Lets the preview screen unblock the Begin button
   *  when some answers permanently failed — without this, the student
   *  would stare at "Preparing answers…" forever. */
  solveSettled: boolean;
  /** Number of solve requests that rejected. The preview surfaces a
   *  warning when > 0 so the student knows missing-answer questions
   *  will be ungraded at submit time. */
  solveErrorCount: number;
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
    startedAt: null,
    submittedAt: null,
    results: null,
    sessionId,
    workImages: new Array(len).fill(null),
    workSubmissions: new Array(len).fill(null),
    multipleChoice,
    solveSettled: false,
    solveErrorCount: 0,
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
    difficulty?: Difficulty,
  ) => Promise<void>;
  beginMockTest: () => void;
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

  async startMockTest(problems, generateCount, timeLimitMinutes, subject, problemQueue, multipleChoice = true, difficulty: Difficulty = "same") {
    const imageMap = new Map(problemQueue.map((p) => [p.text, p.image]));
    set({ phase: "loading", error: null });
    try {
      if (generateCount > 0) {
        // Phase 1: batch generate similar question texts (1 Claude call)
        const generated = await practiceApi.generate({ problems, subject, difficulty });
        const questionTexts = generated.problems.map((p) => p.question);

        // Phase 2: show exam immediately with placeholders, solve in parallel
        const placeholders: PracticeProblem[] = questionTexts.map((q) => ({
          question: q,
          answer: "",
        }));
        const { id } = await sessionApi.createMockTest(problems[0], questionTexts);
        const newMockTest = createMockTest(placeholders, id, timeLimitMinutes, multipleChoice);
        set({ mockTest: newMockTest });

        // Show preview screen immediately (questions visible, no answers yet)
        set({ phase: "mock_test_preview" });

        // Fire solve calls for all generated questions in parallel
        const batchSessionId = id;
        const solvePromises = questionTexts.map((q, i) =>
          practiceApi.solve({ problem: q, subject }).then((solveResult) => {
            const { mockTest: current } = get();
            if (!current || current.sessionId !== batchSessionId) return;
            const updated = [...current.questions];
            updated[i] = solveResult.problem;
            set({ mockTest: { ...current, questions: updated } });
          }),
        );

        // Solve in background — count failures off the actual results
        // array (not the post-write batch) so we can distinguish
        // total vs partial failure. Total failure → phase: error.
        // Partial failure → set solveErrorCount + solveSettled so the
        // preview screen can unblock Begin and warn the student that
        // missing-answer questions will be ungraded.
        Promise.allSettled(solvePromises).then((results) => {
          const { mockTest: current } = get();
          if (!current || current.sessionId !== batchSessionId) return;
          const failedCount = results.filter(
            (r) => r.status === "rejected",
          ).length;
          if (failedCount === results.length) {
            set({
              phase: "error",
              error: "Failed to generate answers. Please try again.",
            });
            return;
          }
          set({
            mockTest: {
              ...current,
              solveSettled: true,
              solveErrorCount: failedCount,
            },
          });
        });
      } else {
        const placeholders: PracticeProblem[] = problems.map((p) => ({
          question: p,
          answer: "",
        }));
        const { id } = await sessionApi.createMockTest(problems[0], problems);

        // Set mockTest with placeholders first so .then() handlers can find it
        const newMockTest = createMockTest(placeholders, id, timeLimitMinutes, multipleChoice);
        set({ mockTest: newMockTest, phase: "mock_test_preview" });

        // Fire all API calls in parallel, update each question as it resolves
        const batchSessionId = id;
        const promises = problems.map((p, i) => {
          const image = imageMap.get(p);
          return practiceApi.solve({
            problem: p, subject,
            ...(image && { image_base64: image }),
          }).then((solveResult) => {
            const { mockTest: current } = get();
            if (!current || current.sessionId !== batchSessionId) return;
            const updated = [...current.questions];
            updated[i] = solveResult.problem;
            set({ mockTest: { ...current, questions: updated } });
          });
        });

        // Same partial-failure handling as the generate branch above.
        Promise.allSettled(promises).then((results) => {
          const { mockTest: current } = get();
          if (!current || current.sessionId !== batchSessionId) return;
          const failedCount = results.filter(
            (r) => r.status === "rejected",
          ).length;
          if (failedCount === results.length) {
            set({
              phase: "error",
              error: "Failed to generate answers. Please try again.",
            });
            return;
          }
          set({
            mockTest: {
              ...current,
              solveSettled: true,
              solveErrorCount: failedCount,
            },
          });
        });
      }
    } catch (err) {
      if (err instanceof EntitlementError) throw err;
      set({ phase: "error", error: (err as Error).message });
    }
  },

  beginMockTest() {
    const { mockTest } = get();
    set({
      phase: "mock_test_active",
      mockTest: mockTest ? { ...mockTest, startedAt: Date.now() } : null,
    });
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
      // Wait for all answers to be resolved before grading. Short-
      // circuit when the solve batch has already settled with at
      // least one permanent failure — those questions' answers will
      // never arrive, and waiting 30s for the timeout fallback would
      // just delay grading the answers we DO have.
      const answersResolved = mockTest.questions.every((q) => q.answer !== "");
      if (!answersResolved && !mockTest.solveSettled) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => { unsub(); resolve(); }, 30_000);
          const unsub = store.subscribe((state) => {
            if (!state.mockTest) { clearTimeout(timeout); unsub(); resolve(); return; }
            // Resolve as soon as either every answer arrives OR the
            // solve batch settles (so a late partial-failure also
            // unblocks submit instead of riding the 30s timeout).
            if (
              state.mockTest.solveSettled ||
              state.mockTest.questions.every((q) => q.answer !== "")
            ) {
              clearTimeout(timeout);
              unsub();
              resolve();
            }
          });
        });
      }

      // Re-read after potential wait
      const currentMockTest = get().mockTest;
      if (!currentMockTest) return;

      const results: QuizResult[] = await Promise.all(
        currentMockTest.questions.map(async (q, i) => {
          const userAnswer = currentMockTest.answers[i] ?? null;
          if (!userAnswer) {
            return {
              question: q.question,
              userAnswer: null,
              correctAnswer: q.answer,
              isCorrect: null,
            };
          }

          // Permanently-failed solve (q.answer === "" after solveSettled).
          // Treat as ungraded — matches the preview-screen warning so the
          // student isn't told something graded when nothing could grade
          // it. Skips the API check too: practiceApi.check with an empty
          // correct_answer would either return a meaningless verdict or
          // 4xx, neither helpful.
          if (q.answer === "") {
            return {
              question: q.question,
              userAnswer,
              correctAnswer: "",
              isCorrect: null,
            };
          }

          // MC mode: student selected an exact option, no API call needed
          if (currentMockTest.multipleChoice) {
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

      if (currentMockTest.sessionId) {
        const correctCount = results.filter((r) => r.isCorrect === true).length;
        await sessionApi.completeMockTest(currentMockTest.sessionId, {
          total_questions: results.length,
          correct_count: correctCount,
        });
      }

      const newFlags = [...currentMockTest.flags];
      results.forEach((r, i) => {
        if (r.isCorrect !== true) newFlags[i] = true;
      });

      const images = currentMockTest.workImages;
      const pending = images
        .map((img, i) => (img ? { img, i } : null))
        .filter(Boolean) as { img: string; i: number }[];

      const updatedMockTest = {
        ...currentMockTest,
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
              const q = currentMockTest.questions[i];
              const r = results[i];
              const workSubmitResult = await workApi.submit({
                image_base64: img,
                problem_text: q.question,
                user_answer: r?.userAnswer ?? "",
                user_was_correct: r?.isCorrect === true,
                subject,
              });
              if (!workSubmitResult.diagnosis) return;
              const { mockTest: current } = get();
              if (!current) return;
              const newSubs = [...current.workSubmissions];
              newSubs[i] = workSubmitResult.diagnosis;
              const updatedFlags = [...current.flags];
              if (workSubmitResult.diagnosis.has_issues && !updatedFlags[i]) {
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
