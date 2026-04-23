import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { ONBOARDING_FLAGS_KEY as STORAGE_KEY } from "../constants/storageKeys";

interface Flags {
  completedSessionCount: number;
  hasRequestedReview: boolean;
}

interface OnboardingState extends Flags {
  loaded: boolean;
  initialize: () => Promise<void>;
  /**
   * Idempotent per-key: passing the same sessionKey twice is a no-op. Keys
   * are tracked in-memory only so SessionScreen remounts always get a fresh
   * slate without leaking entries to persistent storage. Pass null/undefined
   * to opt out (caller accepts responsibility for dedup).
   */
  incrementCompletedSessionCount: (sessionKey?: string | null) => Promise<void>;
  markRequestedReview: () => Promise<void>;
}

const DEFAULTS: Flags = {
  completedSessionCount: 0,
  hasRequestedReview: false,
};

async function persist(flags: Flags) {
  try {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(flags));
  } catch {
    // SecureStore can fail on simulator edge cases; swallow so the UI
    // keeps working even if the flag doesn't persist across launches.
  }
}

function snapshot(s: Flags): Flags {
  return {
    completedSessionCount: s.completedSessionCount,
    hasRequestedReview: s.hasRequestedReview,
  };
}

// Session keys already counted in this app launch. In-memory only so the
// set doesn't grow unbounded across reinstalls / restarts.
const countedSessions = new Set<string>();

export const useOnboardingFlags = create<OnboardingState>((set, get) => ({
  ...DEFAULTS,
  loaded: false,

  initialize: async () => {
    try {
      const raw = await SecureStore.getItemAsync(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Flags>;
        // Spread from current state (not DEFAULTS) so any mark-call that
        // landed before the disk read completes isn't clobbered by the
        // on-disk snapshot. On-disk values still win for keys they define.
        set({ ...get(), ...parsed, loaded: true });
        return;
      }
    } catch {
      // fall through to defaults
    }
    set({ loaded: true });
  },

  incrementCompletedSessionCount: async (sessionKey) => {
    if (sessionKey) {
      if (countedSessions.has(sessionKey)) return;
      countedSessions.add(sessionKey);
    }
    set({ completedSessionCount: get().completedSessionCount + 1 });
    await persist(snapshot(get()));
  },

  markRequestedReview: async () => {
    if (get().hasRequestedReview) return;
    set({ hasRequestedReview: true });
    await persist(snapshot(get()));
  },
}));
