import { create } from "zustand";
import { createLearnActions } from "./learnActions";
import { createMockTestActions } from "./mockTestActions";
import { createPracticeActions } from "./practiceActions";
import { initialState, type SessionState } from "./types";

// Re-export types so consumers don't need to change imports
export type { PracticeResult, MockTestResult, MockTest } from "./types";

export const useSessionStore = create<SessionState>((set, get, store) => ({
  ...initialState,

  // Shared actions
  setSubject: (subject) => set({ subject }),
  setProblemQueue: (queue) => set({ problemQueue: queue }),
  setPracticeCount: (count) => set({ practiceCount: count }),
  reset: () => set(initialState),

  // Compose domain-specific actions
  ...createLearnActions(set, get),
  ...createPracticeActions(set, get),
  ...createMockTestActions(set, get, store.subscribe),
}));
