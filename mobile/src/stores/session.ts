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
}

interface SessionState {
  // Learn mode state
  session: SessionData | null;
  phase: SessionPhase;
  lastResponse: StepResponse | null;
  error: string | null;

  // Practice batch state
  practiceBatch: PracticeBatch | null;

  // Actions
  startSession: (problem: string, mode?: string) => Promise<void>;
  startPracticeBatch: (problem: string, similarCount: number) => Promise<void>;
  submitAnswer: (answer: string) => Promise<void>;
  submitPracticeAnswer: (answer: string) => Promise<void>;
  retryWrongProblems: () => void;
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
      },
      phase: "awaiting_input",
      error: null,
    });
  },

  // --- Learn mode actions (unchanged) ---

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
