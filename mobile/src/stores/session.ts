import { create } from "zustand";
import {
  checkPracticeAnswer,
  completeMockTestSession,
  createMockTestSession,
  createSession,
  generatePracticeProblems,
  getSession,
  getSimilarProblem,
  respondToStep,
  type PracticeProblem,
  type SessionData,
  type StepResponse,
} from "../services/api";

type SessionPhase =
  | "idle"
  | "loading"
  | "awaiting_input"
  | "thinking"
  | "completed"
  | "practice_summary"
  | "learn_summary"
  | "mock_test_active"
  | "mock_test_summary"
  | "error";

export interface PracticeResult {
  problem: string;
  userAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
}

interface PracticeBatch {
  problems: PracticeProblem[];
  currentIndex: number;
  results: PracticeResult[];
  flags: boolean[];
  /** True while remaining problems are being generated in the background */
  loadingMore: boolean;
  /** Total number of problems requested (original + similar) */
  totalCount: number;
  /** Problems that failed to process and were skipped */
  skippedProblems: string[];
  /** Number of answer checks still in flight */
  pendingChecks: number;
}

interface LearnQueue {
  problems: string[];
  currentIndex: number;
  flags: boolean[];
}

export interface MockTestResult {
  question: string;
  userAnswer: string | null;
  correctAnswer: string;
  isCorrect: boolean | null;
}

export interface MockTest {
  sessionId: string | null;
  questions: PracticeProblem[];
  answers: Record<number, string>;
  flags: boolean[];
  currentIndex: number;
  timeLimitSeconds: number | null;
  startedAt: number;
  submittedAt: number | null;
  results: MockTestResult[] | null;
}

interface SessionState {
  // Learn mode state
  session: SessionData | null;
  phase: SessionPhase;
  lastResponse: StepResponse | null;
  error: string | null;

  // Practice batch state
  practiceBatch: PracticeBatch | null;

  // Learn queue state
  learnQueue: LearnQueue | null;

  // Mock test state
  mockTest: MockTest | null;

  // Problem input state (shared between App and InputScreen)
  problemQueue: string[];
  practiceCount: number;

  // Actions
  setProblemQueue: (queue: string[]) => void;
  setPracticeCount: (count: number) => void;
  startSession: (problem: string, mode?: string) => Promise<void>;
  startPracticeBatch: (problem: string, similarCount: number) => Promise<void>;
  startPracticeQueue: (problems: string[]) => Promise<void>;
  startLearnQueue: (problems: string[]) => Promise<void>;
  submitAnswer: (answer: string) => Promise<void>;
  submitPracticeAnswer: (answer: string) => Promise<void>;
  advanceStep: () => Promise<void>;
  askAboutStep: (question: string) => Promise<void>;
  togglePracticeFlag: (index: number) => void;
  toggleLearnFlag: (index: number) => void;
  retryFlaggedProblems: () => Promise<void>;
  advanceLearnQueue: () => Promise<void>;
  practiceFlaggedFromLearnQueue: () => Promise<void>;
  switchToLearnMode: () => Promise<void>;
  continueAsking: () => void;
  finishAsking: () => void;
  tryPracticeProblem: () => Promise<void>;
  startMockTest: (problems: string[], generateCount: number, timeLimitMinutes: number | null) => Promise<void>;
  saveMockTestAnswer: (index: number, answer: string) => void;
  navigateMockQuestion: (index: number) => void;
  toggleMockTestFlag: (index: number) => void;
  submitMockTest: () => Promise<void>;
  reset: () => void;
}

const initialState = {
  session: null as SessionData | null,
  phase: "idle" as SessionPhase,
  lastResponse: null as StepResponse | null,
  error: null as string | null,
  practiceBatch: null as PracticeBatch | null,
  learnQueue: null as LearnQueue | null,
  mockTest: null as MockTest | null,
  problemQueue: [] as string[],
  practiceCount: 3,
};

type StoreGet = () => SessionState;
type StoreSet = (partial: Partial<SessionState>) => void;

/** Show summary if all problems answered and all checks done */
function _maybeShowSummary(get: StoreGet, set: StoreSet) {
  const { practiceBatch, phase } = get();
  if (!practiceBatch) return;
  const allAnswered = practiceBatch.results.length >= practiceBatch.problems.length && !practiceBatch.loadingMore;
  if (allAnswered && practiceBatch.pendingChecks <= 0 && phase !== "awaiting_input") {
    set({ phase: "practice_summary" });
  }
}

/** Subscribe to store changes and show summary when all checks complete */
function _waitForChecksAndShowSummary(get: StoreGet, set: StoreSet) {
  const { practiceBatch } = get();
  if (!practiceBatch) return;
  if (practiceBatch.pendingChecks <= 0) {
    set({ phase: "practice_summary" });
    return;
  }
  // Subscribe to state changes instead of polling
  const unsub = useSessionStore.subscribe((state) => {
    if (!state.practiceBatch) { unsub(); return; }
    if (state.practiceBatch.pendingChecks <= 0) {
      unsub();
      set({ phase: "practice_summary" });
    }
  });
}

export const useSessionStore = create<SessionState>((set, get) => ({
  ...initialState,

  setProblemQueue: (queue) => set({ problemQueue: queue }),
  setPracticeCount: (count) => set({ practiceCount: count }),

  startSession: async (problem, mode = "learn") => {
    set({ phase: "loading", error: null });
    try {
      const session = await createSession(problem, mode);
      set({ session, phase: "awaiting_input", lastResponse: null });
    } catch (e) {
      set({ phase: "error", error: (e as Error).message });
    }
  },

  startPracticeBatch: async (problem, similarCount) => {
    set({ ...initialState, phase: "loading" });
    try {
      // Solve the original problem to get the correct answer
      const { problems: firstBatch } = await generatePracticeProblems(problem, 0);
      const firstProblem = firstBatch[0];
      if (!firstProblem) throw new Error("Failed to generate practice problem");

      const needsMore = similarCount > 0;
      set({
        practiceBatch: {
          problems: [{ question: problem, answer: firstProblem.answer }],
          currentIndex: 0,
          results: [],
          flags: [false],
          loadingMore: needsMore,
          totalCount: 1 + similarCount,
          skippedProblems: [],
          pendingChecks: 0,
        },
        phase: "awaiting_input",
      });

      // Generate remaining problems in the background
      if (needsMore) {
        generatePracticeProblems(problem, similarCount)
          .then(({ problems: remaining }) => {
            const { practiceBatch } = get();
            if (!practiceBatch) return;
            // Append new problems (skip duplicates of the first)
            const newProblems = [
              ...practiceBatch.problems,
              ...remaining.filter(
                (p) => p.question !== firstProblem.question,
              ),
            ];
            set({
              practiceBatch: {
                ...practiceBatch,
                problems: newProblems,
                flags: [
                  ...practiceBatch.flags,
                  ...new Array(newProblems.length - practiceBatch.problems.length).fill(false),
                ],
                loadingMore: false,
              },
            });
          })
          .catch(() => {
            // Background generation failed — continue with what we have
            const { practiceBatch } = get();
            if (practiceBatch) {
              set({ practiceBatch: { ...practiceBatch, loadingMore: false } });
            }
          });
      }
    } catch (e) {
      set({ phase: "error", error: (e as Error).message });
    }
  },

  startPracticeQueue: async (problems) => {
    if (problems.length === 0) return;
    set({ ...initialState, phase: "loading" });
    try {
      // Solve first problem immediately so the student can start
      const { problems: first } = await generatePracticeProblems(problems[0], 0);
      const firstProblem = first[0];
      if (!firstProblem) throw new Error("Failed to generate practice problem");

      const needsMore = problems.length > 1;
      set({
        practiceBatch: {
          problems: [{ question: problems[0], answer: firstProblem.answer }],
          currentIndex: 0,
          results: [],
          flags: [false],
          loadingMore: needsMore,
          totalCount: problems.length,
          skippedProblems: [],
          pendingChecks: 0,
        },
        phase: "awaiting_input",
      });

      // Solve remaining problems in the background
      if (needsMore) {
        Promise.allSettled(
          problems.slice(1).map((p) => generatePracticeProblems(p, 0)),
        )
          .then((outcomes) => {
            const { practiceBatch } = get();
            if (!practiceBatch) return;
            const remaining: PracticeProblem[] = [];
            const skipped: string[] = [];
            for (let i = 0; i < outcomes.length; i++) {
              const outcome = outcomes[i];
              if (outcome.status === "rejected") {
                skipped.push(problems[i + 1]);
                continue;
              }
              const solved = outcome.value.problems[0];
              if (!solved) {
                skipped.push(problems[i + 1]);
                continue;
              }
              remaining.push({
                question: problems[i + 1],
                answer: solved.answer,
              });
            }
            set({
              practiceBatch: {
                ...practiceBatch,
                problems: [...practiceBatch.problems, ...remaining],
                flags: [
                  ...practiceBatch.flags,
                  ...new Array(remaining.length).fill(false),
                ],
                totalCount: practiceBatch.problems.length + remaining.length,
                skippedProblems: skipped,
                loadingMore: false,
              },
            });
          });
      }
    } catch (e) {
      set({ phase: "error", error: (e as Error).message });
    }
  },

  submitPracticeAnswer: async (answer) => {
    const { practiceBatch } = get();
    if (!practiceBatch) return;

    const current = practiceBatch.problems[practiceBatch.currentIndex];
    const answerIndex = practiceBatch.currentIndex;
    const nextIndex = answerIndex + 1;
    const hasMoreProblems = nextIndex < practiceBatch.problems.length;

    // Store a placeholder result and advance immediately
    const placeholder: PracticeResult = {
      problem: current.question,
      userAnswer: answer,
      correctAnswer: current.answer,
      isCorrect: false, // will be updated by background check
    };
    const newResults = [...practiceBatch.results, placeholder];

    if (hasMoreProblems) {
      // Advance to next problem immediately
      set({
        practiceBatch: {
          ...practiceBatch,
          results: newResults,
          currentIndex: nextIndex,
          pendingChecks: practiceBatch.pendingChecks + 1,
        },
        phase: "awaiting_input",
        error: null,
      });
    } else if (practiceBatch.loadingMore) {
      // Waiting for more problems to be generated
      set({
        practiceBatch: {
          ...practiceBatch,
          results: newResults,
          pendingChecks: practiceBatch.pendingChecks + 1,
        },
        phase: "loading",
      });
      // Subscribe to state changes instead of polling
      const unsub = useSessionStore.subscribe((state) => {
        if (!state.practiceBatch) { unsub(); return; }
        if (state.practiceBatch.problems.length > nextIndex) {
          unsub();
          set({
            practiceBatch: { ...state.practiceBatch, currentIndex: nextIndex },
            phase: "awaiting_input",
          });
        } else if (!state.practiceBatch.loadingMore) {
          unsub();
          _waitForChecksAndShowSummary(get, set);
        }
      });
    } else {
      // Last problem answered — wait for all checks to finish
      set({
        practiceBatch: {
          ...practiceBatch,
          results: newResults,
          pendingChecks: practiceBatch.pendingChecks + 1,
        },
        phase: "loading",
      });
      // Will transition to summary once all checks complete
    }

    // Fire answer check in background
    checkPracticeAnswer(current.question, current.answer, answer)
      .then(({ is_correct }) => {
        const { practiceBatch: batch } = get();
        if (!batch) return;

        // Update the result at the correct index
        const updatedResults = [...batch.results];
        updatedResults[answerIndex] = { ...updatedResults[answerIndex], isCorrect: is_correct };

        // Auto-flag wrong answers
        const updatedFlags = [...batch.flags];
        if (!is_correct) {
          updatedFlags[answerIndex] = true;
        }

        const remaining = batch.pendingChecks - 1;
        set({
          practiceBatch: {
            ...batch,
            results: updatedResults,
            flags: updatedFlags,
            pendingChecks: remaining,
          },
        });

        // If all problems answered and all checks done, show summary
        _maybeShowSummary(get, set);
      })
      .catch(() => {
        // On error, keep the placeholder (isCorrect: false) and decrement
        const { practiceBatch: batch } = get();
        if (!batch) return;
        set({
          practiceBatch: {
            ...batch,
            pendingChecks: batch.pendingChecks - 1,
          },
        });
        _maybeShowSummary(get, set);
      });
  },

  togglePracticeFlag: (index) => {
    const { practiceBatch } = get();
    if (!practiceBatch) return;

    const newFlags = [...practiceBatch.flags];
    newFlags[index] = !newFlags[index];
    set({ practiceBatch: { ...practiceBatch, flags: newFlags } });
  },

  retryFlaggedProblems: async () => {
    const { practiceBatch } = get();
    if (!practiceBatch) return;

    const flaggedQuestions = practiceBatch.problems
      .filter((_, i) => practiceBatch.flags[i])
      .map((p) => p.question);
    if (flaggedQuestions.length === 0) return;

    set({ ...initialState, phase: "loading" });
    try {
      // Generate 1 similar problem per flagged question
      const results = await Promise.all(
        flaggedQuestions.map((q) => generatePracticeProblems(q, 1)),
      );
      const similarProblems: PracticeProblem[] = results.map((r) => {
        const similar = r.problems[1] ?? r.problems[0];
        return { question: similar.question, answer: similar.answer };
      });

      set({
        practiceBatch: {
          problems: similarProblems,
          currentIndex: 0,
          results: [],
          flags: new Array(similarProblems.length).fill(false),
          loadingMore: false,
          totalCount: similarProblems.length,
          skippedProblems: [],
          pendingChecks: 0,
        },
        phase: "awaiting_input",
        error: null,
      });
    } catch (e) {
      set({ phase: "error", error: (e as Error).message });
    }
  },

  // --- Learn queue actions ---

  startLearnQueue: async (problems) => {
    if (problems.length === 0) return;
    set({ ...initialState, phase: "loading" });
    try {
      const session = await createSession(problems[0], "learn");
      set({
        session,
        phase: "awaiting_input",
        lastResponse: null,
        learnQueue: {
          problems,
          currentIndex: 0,
          flags: new Array(problems.length).fill(false),
        },
      });
    } catch (e) {
      set({ phase: "error", error: (e as Error).message });
    }
  },

  advanceLearnQueue: async () => {
    const { learnQueue } = get();
    if (!learnQueue) return;

    const nextIndex = learnQueue.currentIndex + 1;
    if (nextIndex >= learnQueue.problems.length) {
      set({ phase: "learn_summary", session: null, lastResponse: null });
      return;
    }

    set({ phase: "loading", error: null });
    try {
      const session = await createSession(learnQueue.problems[nextIndex], "learn");
      set({
        session,
        phase: "awaiting_input",
        lastResponse: null,
        learnQueue: { ...learnQueue, currentIndex: nextIndex },
      });
    } catch (e) {
      set({ phase: "error", error: (e as Error).message });
    }
  },

  toggleLearnFlag: (index) => {
    const { learnQueue } = get();
    if (!learnQueue) return;

    const newFlags = [...learnQueue.flags];
    newFlags[index] = !newFlags[index];
    set({ learnQueue: { ...learnQueue, flags: newFlags } });
  },

  practiceFlaggedFromLearnQueue: async () => {
    const { learnQueue } = get();
    if (!learnQueue) return;

    const flaggedProblems = learnQueue.problems.filter((_, i) => learnQueue.flags[i]);
    if (flaggedProblems.length === 0) return;

    set({ ...initialState, phase: "loading" });
    try {
      // Generate 1 similar problem per flagged topic
      const results = await Promise.all(
        flaggedProblems.map((p) => generatePracticeProblems(p, 1)),
      );
      const practiceProblemsList: PracticeProblem[] = results.map((r) => {
        // Use the generated similar problem (index 1), fall back to original (index 0)
        const similar = r.problems[1] ?? r.problems[0];
        return { question: similar.question, answer: similar.answer };
      });

      set({
        practiceBatch: {
          problems: practiceProblemsList,
          currentIndex: 0,
          results: [],
          flags: new Array(practiceProblemsList.length).fill(false),
          loadingMore: false,
          totalCount: practiceProblemsList.length,
          skippedProblems: [],
          pendingChecks: 0,
        },
        phase: "awaiting_input",
      });
    } catch (e) {
      set({ phase: "error", error: (e as Error).message });
    }
  },

  // --- Learn mode actions ---

  submitAnswer: async (answer) => {
    const { session } = get();
    if (!session) return;

    set({ phase: "thinking", error: null });
    try {
      const resp = await respondToStep(session.id, answer);
      const updated = await getSession(session.id);

      const nextPhase: SessionPhase = resp.action === "completed" ? "completed" : "awaiting_input";

      set({ session: updated, lastResponse: resp, phase: nextPhase });
    } catch (e) {
      set({ phase: "error", error: (e as Error).message });
    }
  },

  advanceStep: async () => {
    const { session } = get();
    if (!session) return;

    set({ phase: "thinking", error: null });
    try {
      const resp = await respondToStep(session.id, "", true);
      const updated = await getSession(session.id);
      set({ session: updated, lastResponse: null, phase: "awaiting_input" });
    } catch (e) {
      set({ phase: "error", error: (e as Error).message });
    }
  },

  askAboutStep: async (question) => {
    const { session } = get();
    if (!session) return;

    set({ phase: "thinking", error: null });
    try {
      const resp = await respondToStep(session.id, question);
      const updated = await getSession(session.id);
      set({ session: updated, lastResponse: resp, phase: "awaiting_input" });
    } catch (e) {
      set({ phase: "error", error: (e as Error).message });
    }
  },

  switchToLearnMode: async () => {
    const { session } = get();
    if (!session) return;

    const problem = session.problem;
    set({ ...initialState, phase: "loading" });
    try {
      const newSession = await createSession(problem, "learn");
      set({ session: newSession, phase: "awaiting_input", lastResponse: null, error: null });
    } catch (e) {
      set({ phase: "error", error: (e as Error).message });
    }
  },

  continueAsking: () => {
    set({ phase: "awaiting_input", lastResponse: null });
  },

  finishAsking: () => {
    set({ phase: "completed" });
  },

  startMockTest: async (problems, generateCount, timeLimitMinutes) => {
    set({ ...initialState, phase: "loading" });
    try {
      let questions: PracticeProblem[];
      const errors: string[] = [];

      if (generateCount > 0) {
        // "Generate similar" mode — generate new questions from seeds
        const seedText = problems.map((p, i) => `Problem ${i + 1}: ${p}`).join("\n");
        const { problems: generated } = await generatePracticeProblems(seedText, generateCount);
        questions = generated;
      } else {
        // "Use as exam" mode — solve each problem to get correct answers
        const outcomes = await Promise.allSettled(
          problems.map((p) => generatePracticeProblems(p, 0)),
        );
        questions = [];
        for (let i = 0; i < outcomes.length; i++) {
          const outcome = outcomes[i];
          if (outcome.status === "fulfilled" && outcome.value.problems[0]) {
            questions.push({
              question: problems[i],
              answer: outcome.value.problems[0].answer,
            });
          } else if (outcome.status === "rejected") {
            errors.push(`Q${i + 1}: ${(outcome.reason as Error).message ?? "Unknown error"}`);
          }
        }
      }

      if (questions.length === 0) {
        throw new Error(
          errors.length > 0
            ? `Failed to generate exam: ${errors.join("; ")}`
            : "Failed to generate exam questions",
        );
      }

      set({
        mockTest: {
          sessionId: null,
          questions,
          answers: {},
          flags: new Array(questions.length).fill(false),
          currentIndex: 0,
          timeLimitSeconds: timeLimitMinutes != null ? timeLimitMinutes * 60 : null,
          startedAt: Date.now(),
          submittedAt: null,
          results: null,
        },
        phase: "mock_test_active",
      });

      // Fire-and-forget: track session for analytics without blocking exam start
      const problemText = questions.map((q) => q.question).join("\n");
      createMockTestSession(problemText)
        .then(({ id }) => {
          const current = get().mockTest;
          if (current) set({ mockTest: { ...current, sessionId: id } });
        })
        .catch(() => {});
    } catch (e) {
      set({ phase: "error", error: (e as Error).message });
    }
  },

  saveMockTestAnswer: (index, answer) => {
    const { mockTest } = get();
    if (!mockTest) return;
    set({
      mockTest: {
        ...mockTest,
        answers: { ...mockTest.answers, [index]: answer },
      },
    });
  },

  navigateMockQuestion: (index) => {
    const { mockTest } = get();
    if (!mockTest) return;
    set({ mockTest: { ...mockTest, currentIndex: index } });
  },

  toggleMockTestFlag: (index) => {
    const { mockTest } = get();
    if (!mockTest) return;
    const newFlags = [...mockTest.flags];
    newFlags[index] = !newFlags[index];
    set({ mockTest: { ...mockTest, flags: newFlags } });
  },

  submitMockTest: async () => {
    const { mockTest } = get();
    if (!mockTest) return;

    set({ phase: "loading" });
    try {
      // Batch check all answered questions
      const checkPromises = mockTest.questions.map(async (q, i) => {
        const userAnswer = mockTest.answers[i];
        if (!userAnswer) {
          return { question: q.question, userAnswer: null, correctAnswer: q.answer, isCorrect: null };
        }
        try {
          const { is_correct } = await checkPracticeAnswer(q.question, q.answer, userAnswer);
          return { question: q.question, userAnswer, correctAnswer: q.answer, isCorrect: is_correct };
        } catch {
          return { question: q.question, userAnswer, correctAnswer: q.answer, isCorrect: false };
        }
      });

      const results: MockTestResult[] = await Promise.all(checkPromises);
      const currentMockTest = get().mockTest;
      if (!currentMockTest) return;

      // Auto-flag incorrect and skipped questions
      const newFlags = [...currentMockTest.flags];
      results.forEach((r, i) => {
        if (r.isCorrect !== true) newFlags[i] = true;
      });

      // Record completion for analytics (fire-and-forget)
      const correctCount = results.filter((r) => r.isCorrect === true).length;
      if (currentMockTest.sessionId) {
        completeMockTestSession(currentMockTest.sessionId, results.length, correctCount).catch(() => {});
      }

      set({
        mockTest: { ...currentMockTest, results, flags: newFlags, submittedAt: Date.now() },
        phase: "mock_test_summary",
      });
    } catch (e) {
      set({ phase: "error", error: (e as Error).message });
    }
  },

  tryPracticeProblem: async () => {
    const { session } = get();
    if (!session) return;

    set({ ...initialState, phase: "loading" });
    try {
      const { similar_problem: similarProblem } = await getSimilarProblem(session.id);
      const newSession = await createSession(similarProblem, "practice");
      set({ session: newSession, phase: "awaiting_input", lastResponse: null, error: null });
    } catch (e) {
      set({ phase: "error", error: (e as Error).message });
    }
  },

  reset: () => set(initialState),
}));
