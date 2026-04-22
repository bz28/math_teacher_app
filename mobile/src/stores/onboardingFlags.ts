import { create } from "zustand";
import * as SecureStore from "expo-secure-store";

const STORAGE_KEY = "veradic_onboarding_flags_v1";

interface Flags {
  hasCompletedFirstProblem: boolean;
  hasSeenChatCoachmark: boolean;
}

interface OnboardingState extends Flags {
  loaded: boolean;
  initialize: () => Promise<void>;
  markCompletedFirstProblem: () => Promise<void>;
  markSeenChatCoachmark: () => Promise<void>;
}

const DEFAULTS: Flags = {
  hasCompletedFirstProblem: false,
  hasSeenChatCoachmark: false,
};

async function persist(flags: Flags) {
  try {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(flags));
  } catch {
    // SecureStore can fail on simulator edge cases; swallow so the UI
    // keeps working even if the flag doesn't persist across launches.
  }
}

export const useOnboardingFlags = create<OnboardingState>((set, get) => ({
  ...DEFAULTS,
  loaded: false,

  initialize: async () => {
    try {
      const raw = await SecureStore.getItemAsync(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Flags>;
        set({ ...DEFAULTS, ...parsed, loaded: true });
        return;
      }
    } catch {
      // fall through to defaults
    }
    set({ loaded: true });
  },

  markCompletedFirstProblem: async () => {
    if (get().hasCompletedFirstProblem) return;
    const next = { ...get(), hasCompletedFirstProblem: true };
    set({ hasCompletedFirstProblem: true });
    await persist({
      hasCompletedFirstProblem: next.hasCompletedFirstProblem,
      hasSeenChatCoachmark: next.hasSeenChatCoachmark,
    });
  },

  markSeenChatCoachmark: async () => {
    if (get().hasSeenChatCoachmark) return;
    const next = { ...get(), hasSeenChatCoachmark: true };
    set({ hasSeenChatCoachmark: true });
    await persist({
      hasCompletedFirstProblem: next.hasCompletedFirstProblem,
      hasSeenChatCoachmark: next.hasSeenChatCoachmark,
    });
  },
}));
