import { create } from "zustand";
import {
  checkPracticeAnswer,
  createSession,
  generatePracticeProblems,
  getSession,
  respondToStep,
  submitExplainBack,
  type PracticeProblem,
  type SessionData,
  type StepResponse,
} from "../services/api";

type SessionPhase =
  | "idle"
  | "loading"
  | "awaiting_input"
  | "thinking"
  | "explain_back"
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
  togglePracticeFlag: (index: number) => void;
  toggleLearnFlag: (index: number) => void;
  retryWrongProblems: () => void;
  learnSimilarProblem: () => Promise<void>;
  advanceLearnQueue: () => Promise<void>;
  practiceFlaggedFromLearnQueue: () => Promise<void>;
  requestHint: () => Promise<void>;
  requestShowStep: () => Promise<void>;
  submitExplanation: (explanation: string) => Promise<void>;
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
      const { problems } = await generatePracticeProblems(problem, similarCount);
      set({
        practiceBatch: {
          problems,
          currentIndex: 0,
          results: [],
          flags: new Array(problems.length).fill(false),
        },
        phase: "awaiting_input",
      });
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
      const isLast = nextIndex >= practiceBatch.problems.length;

      set({
        practiceBatch: {
          ...practiceBatch,
          results: newResults,
          currentIndex: isLast ? practiceBatch.currentIndex : nextIndex,
        },
        phase: isLast ? "practice_summary" : "awaiting_input",
      });
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

  retryWrongProblems: () => {
    const { practiceBatch } = get();
    if (!practiceBatch) return;

    const wrongProblems = practiceBatch.results
      .filter((r) => !r.isCorrect)
      .map((r): PracticeProblem => ({
        question: r.problem,
        answer: r.correctAnswer,
      }));
    if (wrongProblems.length === 0) return;

    set({
      practiceBatch: {
        problems: wrongProblems,
        currentIndex: 0,
        results: [],
        flags: new Array(wrongProblems.length).fill(false),
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
    const { lastResponse, learnQueue } = get();
    const similar = lastResponse?.similar_problem;
    if (!similar || !learnQueue) return;

    // Insert similar problem after current index
    const insertAt = learnQueue.currentIndex + 1;
    const newProblems = [...learnQueue.problems];
    newProblems.splice(insertAt, 0, similar);
    const newFlags = [...learnQueue.flags];
    newFlags.splice(insertAt, 0, false);

    set({ phase: "loading", error: null });
    try {
      const session = await createSession(similar, "learn");
      set({
        session,
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

      let nextPhase: SessionPhase = "awaiting_input";
      if (resp.action === "completed") nextPhase = "completed";
      else if (resp.action === "explain_back") nextPhase = "explain_back";

      set({ session: updated, lastResponse: resp, phase: nextPhase });
    } catch (e) {
      set({ phase: "error", error: (e as Error).message });
    }
  },

  requestHint: async () => {
    const { session } = get();
    if (!session) return;

    set({ phase: "thinking", error: null });
    try {
      const resp = await respondToStep(session.id, "", true);
      const updated = await getSession(session.id);
      set({ session: updated, lastResponse: resp, phase: "awaiting_input" });
    } catch (e) {
      set({ phase: "error", error: (e as Error).message });
    }
  },

  requestShowStep: async () => {
    const { session } = get();
    if (!session) return;

    set({ phase: "thinking", error: null });
    try {
      const resp = await respondToStep(session.id, "", false, true);
      const updated = await getSession(session.id);
      set({ session: updated, lastResponse: resp, phase: "awaiting_input" });
    } catch (e) {
      set({ phase: "error", error: (e as Error).message });
    }
  },

  submitExplanation: async (explanation) => {
    const { session } = get();
    if (!session) return;

    set({ phase: "thinking", error: null });
    try {
      const resp = await submitExplainBack(session.id, explanation);
      const updated = await getSession(session.id);

      let nextPhase: SessionPhase = "awaiting_input";
      if (resp.action === "completed") nextPhase = "completed";
      else if (resp.action === "explain_back") nextPhase = "explain_back";

      set({ session: updated, lastResponse: resp, phase: nextPhase });
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
    const { lastResponse } = get();
    const similarProblem = lastResponse?.similar_problem;
    if (!similarProblem) return;

    set({ ...initialState, phase: "loading" });
    try {
      const newSession = await createSession(similarProblem, "practice");
      set({ session: newSession, phase: "awaiting_input", lastResponse: null, error: null });
    } catch (e) {
      set({ phase: "error", error: (e as Error).message });
    }
  },

  reset: () => set(initialState),
}));
