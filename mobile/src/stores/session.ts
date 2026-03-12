import { create } from "zustand";
import {
  checkPracticeAnswer,
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
}

interface LearnQueue {
  problems: string[];
  currentIndex: number;
  flags: boolean[];
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

  // Actions
  startSession: (problem: string, mode?: string) => Promise<void>;
  startPracticeBatch: (problem: string, similarCount: number) => Promise<void>;
  startLearnQueue: (problems: string[]) => Promise<void>;
  submitAnswer: (answer: string) => Promise<void>;
  submitPracticeAnswer: (answer: string) => Promise<void>;
  advanceStep: () => Promise<void>;
  askAboutStep: (question: string) => Promise<void>;
  togglePracticeFlag: (index: number) => void;
  toggleLearnFlag: (index: number) => void;
  retryFlaggedProblems: () => void;
  learnSimilarProblem: () => Promise<void>;
  advanceLearnQueue: () => Promise<void>;
  practiceFlaggedFromLearnQueue: () => Promise<void>;
  switchToLearnMode: () => Promise<void>;
  continueAsking: () => void;
  tryPracticeProblem: () => Promise<void>;
  reset: () => void;
}

const initialState = {
  session: null as SessionData | null,
  phase: "idle" as SessionPhase,
  lastResponse: null as StepResponse | null,
  error: null as string | null,
  practiceBatch: null as PracticeBatch | null,
  learnQueue: null as LearnQueue | null,
};

export const useSessionStore = create<SessionState>((set, get) => ({
  ...initialState,

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
      // Generate just 1 problem first so the student can start immediately
      const { problems: firstBatch } = await generatePracticeProblems(problem, 0);
      const firstProblem = firstBatch[0];
      if (!firstProblem) throw new Error("Failed to generate practice problem");

      const needsMore = similarCount > 0;
      set({
        practiceBatch: {
          problems: [firstProblem],
          currentIndex: 0,
          results: [],
          flags: [false],
          loadingMore: needsMore,
          totalCount: 1 + similarCount,
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

  submitPracticeAnswer: async (answer) => {
    const { practiceBatch } = get();
    if (!practiceBatch) return;

    const current = practiceBatch.problems[practiceBatch.currentIndex];
    set({ phase: "thinking", error: null });

    try {
      const { is_correct } = await checkPracticeAnswer(
        current.question, current.answer, answer,
      );

      const result: PracticeResult = {
        problem: current.question,
        userAnswer: answer,
        correctAnswer: current.answer,
        isCorrect: is_correct,
      };
      const newResults = [...practiceBatch.results, result];
      const nextIndex = practiceBatch.currentIndex + 1;
      const hasMoreProblems = nextIndex < practiceBatch.problems.length;
      const isLast = !hasMoreProblems && !practiceBatch.loadingMore;

      // Auto-flag wrong answers
      const newFlags = [...practiceBatch.flags];
      if (!is_correct) {
        newFlags[practiceBatch.currentIndex] = true;
      }

      if (isLast) {
        // All problems done, no more loading — show summary
        set({
          practiceBatch: { ...practiceBatch, results: newResults, flags: newFlags },
          phase: "practice_summary",
        });
      } else if (hasMoreProblems) {
        // Next problem is ready — advance
        set({
          practiceBatch: {
            ...practiceBatch,
            results: newResults,
            flags: newFlags,
            currentIndex: nextIndex,
          },
          phase: "awaiting_input",
        });
      } else {
        // Still loading more problems — wait for them
        set({
          practiceBatch: { ...practiceBatch, results: newResults, flags: newFlags },
          phase: "loading",
        });
        const waitForMore = () => {
          const { practiceBatch: batch } = get();
          if (!batch) return;
          if (batch.problems.length > nextIndex) {
            // New problems arrived — advance
            set({
              practiceBatch: { ...batch, currentIndex: nextIndex },
              phase: "awaiting_input",
            });
          } else if (!batch.loadingMore) {
            // Loading finished but no new problems — show summary
            set({ phase: "practice_summary" });
          } else {
            // Still loading — check again shortly
            setTimeout(waitForMore, 200);
          }
        };
        setTimeout(waitForMore, 200);
      }
    } catch (e) {
      set({ phase: "error", error: (e as Error).message });
    }
  },

  togglePracticeFlag: (index) => {
    const { practiceBatch } = get();
    if (!practiceBatch) return;

    const newFlags = [...practiceBatch.flags];
    newFlags[index] = !newFlags[index];
    set({ practiceBatch: { ...practiceBatch, flags: newFlags } });
  },

  retryFlaggedProblems: () => {
    const { practiceBatch } = get();
    if (!practiceBatch) return;

    const flaggedProblems = practiceBatch.problems
      .filter((_, i) => practiceBatch.flags[i])
      .map((p): PracticeProblem => ({
        question: p.question,
        answer: p.answer,
      }));
    if (flaggedProblems.length === 0) return;

    set({
      practiceBatch: {
        problems: flaggedProblems,
        currentIndex: 0,
        results: [],
        flags: new Array(flaggedProblems.length).fill(false),
        loadingMore: false,
        totalCount: flaggedProblems.length,
      },
      phase: "awaiting_input",
      error: null,
    });
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

  learnSimilarProblem: async () => {
    const { session, learnQueue } = get();
    if (!session || !learnQueue) return;

    set({ phase: "loading", error: null });
    try {
      const { similar_problem: similar } = await getSimilarProblem(session.id);

      // Insert similar problem after current index
      const insertAt = learnQueue.currentIndex + 1;
      const newProblems = [...learnQueue.problems];
      newProblems.splice(insertAt, 0, similar);
      const newFlags = [...learnQueue.flags];
      newFlags.splice(insertAt, 0, false);

      const newSession = await createSession(similar, "learn");
      set({
        session: newSession,
        phase: "awaiting_input",
        lastResponse: null,
        learnQueue: {
          problems: newProblems,
          currentIndex: insertAt,
          flags: newFlags,
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
      // Solve each flagged problem to get answers (parallel calls)
      const results = await Promise.all(
        flaggedProblems.map((p) => generatePracticeProblems(p, 0)),
      );
      const practiceProblemsList: PracticeProblem[] = results.map((r, i) => ({
        question: flaggedProblems[i],
        answer: r.problems[0]?.answer ?? "unknown",
      }));

      set({
        practiceBatch: {
          problems: practiceProblemsList,
          currentIndex: 0,
          results: [],
          flags: new Array(practiceProblemsList.length).fill(false),
          loadingMore: false,
          totalCount: practiceProblemsList.length,
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
      const resp = await respondToStep(session.id, "", false, false, true);
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
