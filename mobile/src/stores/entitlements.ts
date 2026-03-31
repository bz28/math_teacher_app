import { create } from "zustand";
import { getEntitlements, type EntitlementsData } from "../services/api";

interface EntitlementState {
  isPro: boolean;
  tier: string;
  status: string;
  expiresAt: string | null;
  dailySessionsUsed: number;
  dailySessionsLimit: number;
  gatedFeatures: string[];
  loaded: boolean;

  fetchEntitlements: () => Promise<void>;
  canUseFeature: (feature: string) => boolean;
  canCreateSession: () => boolean;
  sessionsRemaining: () => number;
}

export const useEntitlementStore = create<EntitlementState>((set, get) => ({
  isPro: false,
  tier: "free",
  status: "none",
  expiresAt: null,
  dailySessionsUsed: 0,
  dailySessionsLimit: 5,
  gatedFeatures: [],
  loaded: false,

  fetchEntitlements: async () => {
    const data: EntitlementsData = await getEntitlements();
    set({
      isPro: data.is_pro,
      tier: data.subscription_tier,
      status: data.subscription_status,
      expiresAt: data.subscription_expires_at,
      dailySessionsUsed: data.limits.daily_sessions_used,
      dailySessionsLimit: data.limits.daily_sessions_limit,
      gatedFeatures: data.gated_features,
      loaded: true,
    });
  },

  canUseFeature: (feature: string) => {
    const { gatedFeatures, isPro } = get();
    // Pro users can access everything; free users are blocked from gated features
    return isPro || !gatedFeatures.includes(feature);
  },

  canCreateSession: () => {
    const { isPro, dailySessionsUsed, dailySessionsLimit } = get();
    return isPro || dailySessionsUsed < dailySessionsLimit;
  },

  sessionsRemaining: () => {
    const { isPro, dailySessionsUsed, dailySessionsLimit } = get();
    if (isPro) return Infinity;
    return Math.max(0, dailySessionsLimit - dailySessionsUsed);
  },
}));
