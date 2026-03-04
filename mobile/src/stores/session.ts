import { create } from "zustand";

export type SessionStatus =
  | "idle"
  | "loading"
  | "awaiting_input"
  | "evaluating"
  | "streaming"
  | "complete"
  | "error";

export interface Exchange {
  role: "student" | "tutor";
  content: string;
  timestamp: number;
}

interface SessionState {
  sessionId: string | null;
  status: SessionStatus;
  currentStep: number;
  totalSteps: number;
  exchanges: Exchange[];
  streamingContent: string;
  error: string | null;

  // Actions
  startSession: (sessionId: string, totalSteps: number) => void;
  setStatus: (status: SessionStatus) => void;
  addExchange: (exchange: Exchange) => void;
  appendStreaming: (chunk: string) => void;
  finishStreaming: () => void;
  advanceStep: () => void;
  setError: (error: string) => void;
  reset: () => void;
}

const initialState = {
  sessionId: null,
  status: "idle" as SessionStatus,
  currentStep: 0,
  totalSteps: 0,
  exchanges: [] as Exchange[],
  streamingContent: "",
  error: null,
};

export const useSessionStore = create<SessionState>((set) => ({
  ...initialState,

  startSession: (sessionId, totalSteps) =>
    set({ ...initialState, sessionId, totalSteps, status: "awaiting_input" }),

  setStatus: (status) => set({ status }),

  addExchange: (exchange) =>
    set((state) => ({ exchanges: [...state.exchanges, exchange] })),

  appendStreaming: (chunk) =>
    set((state) => ({
      status: "streaming",
      streamingContent: state.streamingContent + chunk,
    })),

  finishStreaming: () =>
    set((state) => ({
      status: "awaiting_input",
      exchanges: [
        ...state.exchanges,
        {
          role: "tutor",
          content: state.streamingContent,
          timestamp: Date.now(),
        },
      ],
      streamingContent: "",
    })),

  advanceStep: () =>
    set((state) => ({ currentStep: state.currentStep + 1 })),

  setError: (error) => set({ status: "error", error }),

  reset: () => set(initialState),
}));
