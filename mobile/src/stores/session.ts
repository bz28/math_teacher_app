import { create } from "zustand";
import {
  createSession,
  getSession,
  respondToStep,
  submitExplainBack,
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
  | "error";

interface SessionState {
  session: SessionData | null;
  phase: SessionPhase;
  lastResponse: StepResponse | null;
  error: string | null;

  startSession: (problem: string, mode?: string) => Promise<void>;
  submitAnswer: (answer: string) => Promise<void>;
  requestHint: () => Promise<void>;
  requestShowStep: () => Promise<void>;
  skipExplainBack: () => Promise<void>;
  submitExplanation: (explanation: string) => Promise<void>;
  switchToLearnMode: () => Promise<void>;
  reset: () => void;
}

const initialState = {
  session: null as SessionData | null,
  phase: "idle" as SessionPhase,
  lastResponse: null as StepResponse | null,
  error: null as string | null,
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
      // "conversation" and "show_step" stay on awaiting_input

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

  skipExplainBack: async () => {
    const { session } = get();
    if (!session) return;

    set({ phase: "thinking", error: null });
    try {
      const resp = await submitExplainBack(session.id, "", true);
      const updated = await getSession(session.id);

      let nextPhase: SessionPhase = "awaiting_input";
      if (resp.action === "completed") nextPhase = "completed";

      set({ session: updated, lastResponse: resp, phase: nextPhase });
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

  reset: () => set(initialState),
}));
